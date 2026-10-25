import { useEffect, useState } from "react";
import type { BankRow, Ledger, SplitPreset } from "../../domain/ledger";
import { matchesRule, type EntryRule } from "../../domain/rules";
import { formatMoney } from "../../domain/value";

interface RulesViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  initialDescription?: string;
  onClearInitialDescription: () => void;
}

function createRule(description: string, rules: readonly EntryRule[]): EntryRule {
  return {
    id: crypto.randomUUID(),
    name: description.trim(),
    order: Math.max(0, ...rules.map((rule) => rule.order)) + 1,
    enabled: true,
    match: {
      text: description,
      mode: "contains",
      accountId: null,
      sign: "any",
      minCents: null,
      maxCents: null,
    },
    action: { displayName: null, categoryId: null, split: null, tags: [] },
    autoConfirm: false,
    updatedAt: new Date().toISOString(),
  };
}

function splitKind(split: SplitPreset | null): SplitPreset["kind"] | "none" {
  return split?.kind ?? "none";
}

export function RulesView({ ledger, update, initialDescription = "", onClearInitialDescription }: RulesViewProps) {
  const rules = [...(ledger.rules ?? [])].sort((first, second) => first.order - second.order || first.id.localeCompare(second.id));
  const [draft, setDraft] = useState<EntryRule>(() => createRule(initialDescription, rules));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(Boolean(initialDescription));
  const [tagsText, setTagsText] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!initialDescription) return;
    setDraft(createRule(initialDescription, rules));
    setEditingId(null);
    setTagsText("");
    setFormError("");
    setShowEditor(true);
  }, [initialDescription]);

  const reviewRows = (ledger.bankRows ?? []).filter((row) => !row.entryId && !row.settlementId && !row.skipped);
  const previewRows = reviewRows.filter((row) => matchesRule(
    { ...draft, enabled: true },
    row,
    ledger.accounts.find((account) => account.id === row.accountId),
  ));

  function updateMatch<K extends keyof EntryRule["match"]>(key: K, value: EntryRule["match"][K]) {
    setDraft((current) => ({ ...current, match: { ...current.match, [key]: value } }));
  }

  function updateAction<K extends keyof EntryRule["action"]>(key: K, value: EntryRule["action"][K]) {
    setDraft((current) => ({ ...current, action: { ...current.action, [key]: value } }));
  }

  function startNew() {
    setDraft(createRule("", rules));
    setEditingId(null);
    setTagsText("");
    setFormError("");
    setShowEditor(true);
    onClearInitialDescription();
  }

  function editRule(rule: EntryRule) {
    setDraft(rule);
    setEditingId(rule.id);
    setTagsText(rule.action.tags.join(", "));
    setFormError("");
    setShowEditor(true);
  }

  function saveRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setFormError("Enter a rule name.");
      return;
    }
    const saved = {
      ...draft,
      name: draft.name.trim(),
      match: {
        ...draft.match,
        text: draft.match.text.trim(),
      },
      action: {
        ...draft.action,
        displayName: draft.action.displayName?.trim() || null,
        tags: tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
      },
      updatedAt: new Date().toISOString(),
    };
    update({
      ...ledger,
      rules: editingId
        ? rules.map((rule) => rule.id === editingId ? saved : rule)
        : [...rules, { ...saved, order: Math.max(0, ...rules.map((rule) => rule.order)) + 1 }],
    });
    setShowEditor(false);
    setEditingId(null);
    setFormError("");
    onClearInitialDescription();
  }

  function moveRule(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rules.length) return;
    const reordered = [...rules];
    const first = reordered[index];
    const second = reordered[targetIndex];
    const updatedAt = new Date().toISOString();
    reordered[index] = { ...second, order: first.order, updatedAt };
    reordered[targetIndex] = { ...first, order: second.order, updatedAt };
    update({ ...ledger, rules: reordered });
  }

  function toggleRule(rule: EntryRule) {
    update({ ...ledger, rules: rules.map((candidate) => candidate.id === rule.id
      ? { ...candidate, enabled: !candidate.enabled, updatedAt: new Date().toISOString() }
      : candidate) });
  }

  function deleteRule(rule: EntryRule) {
    if (!window.confirm(`Delete rule “${rule.name}”?`)) return;
    update({ ...ledger, rules: rules.filter((candidate) => candidate.id !== rule.id) });
    if (editingId === rule.id) setShowEditor(false);
  }

  function undoRuleEntries(rule: EntryRule) {
    const entryIds = new Set(ledger.entries.filter((entry) => entry.ruleId === rule.id).map((entry) => entry.id));
    if (!entryIds.size || !window.confirm(`Remove ${entryIds.size} entries created by “${rule.name}”?`)) return;
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.filter((entry) => !entryIds.has(entry.id)),
      bankRows: (ledger.bankRows ?? []).map((row) => entryIds.has(row.entryId ?? "")
        ? { ...row, entryId: null, updatedAt: now }
        : row),
    });
  }

  function setSplitKind(kind: string) {
    if (kind === "none") {
      updateAction("split", null);
      return;
    }
    if (kind === "entity") {
      updateAction("split", { kind, entityId: ledger.entities.find((entity) => !entity.archived)?.id ?? "self" });
      return;
    }
    if (kind === "equal") {
      updateAction("split", { kind, entityIds: [ledger.entities.find((entity) => !entity.archived)?.id ?? "self"] });
      return;
    }
    updateAction("split", { kind } as SplitPreset);
  }

  return (
    <>
      <header className="page-heading">
        <h1>Rules</h1>
        <button className="primary" onClick={startNew} type="button">New rule</button>
      </header>
      {showEditor && (
        <form className="form-grid" onSubmit={saveRule}>
          <h2>{editingId ? "Edit rule" : "New rule"}</h2>
          <label>Rule name<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
          <label>Description contains or starts with<input value={draft.match.text} onChange={(event) => updateMatch("text", event.target.value)} /></label>
          <label>Text mode<select value={draft.match.mode} onChange={(event) => updateMatch("mode", event.target.value as EntryRule["match"]["mode"])}><option value="contains">Contains</option><option value="startsWith">Starts with</option></select></label>
          <label>Account<select value={draft.match.accountId ?? ""} onChange={(event) => updateMatch("accountId", event.target.value || null)}><option value="">Any account</option>{ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>Direction<select value={draft.match.sign} onChange={(event) => updateMatch("sign", event.target.value as EntryRule["match"]["sign"])}><option value="any">Any</option><option value="out">Money out</option><option value="in">Money in</option></select></label>
          <label>Minimum amount (cents)<input min="0" step="1" type="number" value={draft.match.minCents ?? ""} onChange={(event) => updateMatch("minCents", event.target.value === "" ? null : Number(event.target.value))} /></label>
          <label>Maximum amount (cents)<input min="0" step="1" type="number" value={draft.match.maxCents ?? ""} onChange={(event) => updateMatch("maxCents", event.target.value === "" ? null : Number(event.target.value))} /></label>
          <label>Display name<input value={draft.action.displayName ?? ""} onChange={(event) => updateAction("displayName", event.target.value || null)} /></label>
          <label>Category<select value={draft.action.categoryId ?? ""} onChange={(event) => updateAction("categoryId", event.target.value || null)}><option value="">No category</option>{(ledger.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Split<select value={splitKind(draft.action.split)} onChange={(event) => setSplitKind(event.target.value)}><option value="none">No split</option><option value="payer">Payer</option><option value="halfHouse">Half House</option><option value="allHouse">All House</option><option value="entity">One entity</option><option value="equal">Equal entities</option></select></label>
          {draft.action.split?.kind === "entity" && <label>Split entity<select value={draft.action.split.entityId} onChange={(event) => updateAction("split", { kind: "entity", entityId: event.target.value })}>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>}
          {draft.action.split?.kind === "equal" && <label>Equal split entities<select multiple size={Math.min(4, Math.max(2, ledger.entities.length))} value={draft.action.split.entityIds} onChange={(event) => {
            const entityIds = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
            if (entityIds.length) updateAction("split", { kind: "equal", entityIds });
          }}>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>}
          <label>Tags (comma-separated)<input value={tagsText} onChange={(event) => setTagsText(event.target.value)} /></label>
          <label className="checkbox-label"><input checked={draft.autoConfirm} onChange={(event) => setDraft((current) => ({ ...current, autoConfirm: event.target.checked }))} type="checkbox" />Auto-confirm when a split is set</label>
          <section>
            <h3>Review preview: {previewRows.length} matching rows</h3>
            {previewRows.length > 0 && <ul>{previewRows.slice(0, 10).map((row: BankRow) => <li key={row.id}>{row.date} | {row.description} | {formatMoney(Math.abs(row.amountCents))}</li>)}</ul>}
          </section>
          {formError && <p className="banner error" role="alert">{formError}</p>}
          <div className="dialog-actions">
            <button className="primary" type="submit">Save rule</button>
            <button className="secondary" onClick={() => { setShowEditor(false); onClearInitialDescription(); }} type="button">Cancel</button>
          </div>
        </form>
      )}
      {rules.length === 0 ? <p className="empty-state compact">No rules yet.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Order</th><th>Rule</th><th>Match</th><th>Action</th><th>Enabled</th><th /></tr></thead>
            <tbody>{rules.map((rule, index) => {
              const entryCount = ledger.entries.filter((entry) => entry.ruleId === rule.id).length;
              return <tr key={rule.id}>
                <td>{index + 1}</td>
                <td>{rule.name}</td>
                <td>{rule.match.text || "Any description"} · {rule.match.mode === "contains" ? "contains" : "starts with"}</td>
                <td>{rule.action.displayName || "Raw description"}{rule.action.categoryId && ` · ${ledger.categories?.find((category) => category.id === rule.action.categoryId)?.name ?? "Category"}`}{rule.action.tags.length > 0 && ` · ${rule.action.tags.join(", ")}`}</td>
                <td><input aria-label={`Enable ${rule.name}`} checked={rule.enabled} onChange={() => toggleRule(rule)} type="checkbox" /></td>
                <td>
                  <button aria-label={`Move ${rule.name} up`} className="secondary" disabled={index === 0} onClick={() => moveRule(index, -1)} type="button">Up</button>{" "}
                  <button aria-label={`Move ${rule.name} down`} className="secondary" disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)} type="button">Down</button>{" "}
                  <button className="secondary" onClick={() => editRule(rule)} type="button">Edit</button>{" "}
                  <button className="secondary" onClick={() => deleteRule(rule)} type="button">Delete</button>{" "}
                  {entryCount > 0 && <button className="secondary" onClick={() => undoRuleEntries(rule)} type="button">Undo rule entries ({entryCount})</button>}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}