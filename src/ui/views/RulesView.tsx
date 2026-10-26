import { useEffect, useState } from "react";
import { splitPreset, type Entry, type Ledger, type SplitPreset } from "../../domain/ledger";
import { previewRuleChanges, type EntryRule, type RuleChangeSummary, type RulePreview } from "../../domain/rules";
import { formatMoney } from "../../domain/value";

interface RulesViewProps {
  ledger: Ledger;
  update: (next: Ledger, undoLabel?: string, actor?: "rule") => void;
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
      descriptionRegex: "",
      weekday: [],
      accountId: null,
      sign: "any",
      minCents: null,
      maxCents: null,
    },
    scope: "newRows",
    protectManualEdits: true,
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
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!initialDescription) return;
    setDraft(createRule(initialDescription, rules));
    setEditingId(null);
    setTagsText("");
    setFormError("");
    setPreview(null);
    setSelectedItems(new Set());
    setShowEditor(true);
  }, [initialDescription]);

  function changeDraft(update: (current: EntryRule) => EntryRule) {
    setDraft(update);
    setPreview(null);
    setSelectedItems(new Set());
    setFormError("");
  }

  function updateMatch<K extends keyof EntryRule["match"]>(key: K, value: EntryRule["match"][K]) {
    changeDraft((current) => ({ ...current, match: { ...current.match, [key]: value } }));
  }

  function updateAction<K extends keyof EntryRule["action"]>(key: K, value: EntryRule["action"][K]) {
    changeDraft((current) => ({ ...current, action: { ...current.action, [key]: value } }));
  }

  function validateRegex(): boolean {
    const pattern = draft.match.descriptionRegex?.trim();
    if (!pattern) return true;
    try {
      new RegExp(pattern);
      return true;
    } catch {
      setFormError("Enter a valid description regex.");
      return false;
    }
  }

  function prepareRule(): EntryRule {
    return {
      ...draft,
      name: draft.name.trim(),
      match: {
        ...draft.match,
        text: draft.match.text.trim(),
        descriptionRegex: draft.match.descriptionRegex?.trim() || undefined,
        weekday: [...(draft.match.weekday ?? [])],
      },
      scope: draft.scope ?? "newRows",
      protectManualEdits: draft.protectManualEdits ?? true,
      action: {
        ...draft.action,
        displayName: draft.action.displayName?.trim() || null,
        tags: tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  function saveRuleTo(working: Ledger, rule: EntryRule): EntryRule[] {
    const currentRules = [...(working.rules ?? [])];
    return editingId
      ? currentRules.map((candidate) => candidate.id === editingId ? rule : candidate)
      : [...currentRules, { ...rule, order: Math.max(0, ...currentRules.map((candidate) => candidate.order)) + 1 }];
  }

  function runPreview() {
    if (!validateRegex()) return;
    setPreview(previewRuleChanges({ ...draft, enabled: true }, ledger));
    setSelectedItems(new Set());
  }

  function startNew() {
    setDraft(createRule("", rules));
    setEditingId(null);
    setTagsText("");
    setFormError("");
    setPreview(null);
    setSelectedItems(new Set());
    setShowEditor(true);
    onClearInitialDescription();
  }

  function editRule(rule: EntryRule) {
    setDraft({
      ...rule,
      match: { ...rule.match, descriptionRegex: rule.match.descriptionRegex ?? "", weekday: rule.match.weekday ?? [] },
      scope: rule.scope ?? "newRows",
      protectManualEdits: rule.protectManualEdits ?? true,
    });
    setEditingId(rule.id);
    setTagsText(rule.action.tags.join(", "));
    setFormError("");
    setPreview(null);
    setSelectedItems(new Set());
    setShowEditor(true);
  }

  function saveRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateRegex()) return;
    if (!draft.name.trim()) {
      setFormError("Enter a rule name.");
      return;
    }
    const saved = prepareRule();
    update({
      ...ledger,
      rules: saveRuleTo(ledger, saved),
    });
    setShowEditor(false);
    setEditingId(null);
    setFormError("");
    setPreview(null);
    setSelectedItems(new Set());
    onClearInitialDescription();
  }

  function applyPreview(applyAll: boolean) {
    if (!preview || !validateRegex()) return;
    const items = [
      ...preview.bankRows.map(({ row }) => `row:${row.id}`),
      ...preview.entries.map(({ entry }) => `entry:${entry.id}`),
    ];
    const selected = applyAll ? new Set(items) : selectedItems;
    if (!selected.size) return;
    if (!draft.name.trim()) {
      setFormError("Enter a rule name.");
      return;
    }

    const saved = prepareRule();
    const now = new Date().toISOString();
    const selectedRows = preview.bankRows.filter(({ row }) => selected.has(`row:${row.id}`));
    const selectedEntries = new Map(preview.entries
      .filter(({ entry }) => selected.has(`entry:${entry.id}`))
      .map(({ entry }) => [entry.id, entry]));
    const newEntries = selectedRows.map(({ row }): Entry => {
      const account = ledger.accounts.find((candidate) => candidate.id === row.accountId);
      const payerEntityId = account?.payerEntityId ?? "self";
      const amountCents = Math.abs(row.amountCents);
      return {
        id: crypto.randomUUID(),
        kind: "spend",
        date: row.date,
        description: row.description,
        displayName: saved.action.displayName ?? undefined,
        amountCents,
        payerEntityId,
        accountId: row.accountId,
        portions: splitPreset(amountCents, payerEntityId, saved.action.split ?? { kind: "payer" }),
        bankRowIds: [row.id],
        source: "rule",
        ruleId: saved.id,
        categoryId: saved.action.categoryId,
        tags: saved.action.tags,
        note: "",
        extraReimbursable: false,
        countsTowardDebt: ledger.imports?.find((item) => item.id === row.importId)?.countsTowardDebt ?? true,
        updatedAt: now,
      };
    });
    const entries = ledger.entries.map((entry) => {
      if (!selectedEntries.has(entry.id)) return entry;
      return {
        ...entry,
        displayName: saved.action.displayName ?? undefined,
        categoryId: saved.action.categoryId,
        tags: saved.action.tags,
        portions: saved.action.split
          ? splitPreset(entry.amountCents, entry.payerEntityId, saved.action.split)
          : entry.portions,
        updatedAt: now,
      };
    });
    const entryByRowId = new Map(newEntries.map((entry) => [entry.bankRowIds![0], entry]));
    const next: Ledger = {
      ...ledger,
      rules: saveRuleTo(ledger, saved),
      entries: [...entries, ...newEntries],
      bankRows: (ledger.bankRows ?? []).map((row) => {
        const created = entryByRowId.get(row.id);
        return created ? { ...row, entryId: created.id, updatedAt: now } : row;
      }),
    };
    update(next, `Apply rule ${saved.name}`, "rule");
    setDraft(saved);
    setEditingId(saved.id);
    setPreview(null);
    setSelectedItems(new Set());
    setFormError("");
  }

  function renderSummary(value: RuleChangeSummary) {
    const category = ledger.categories?.find((candidate) => candidate.id === value.categoryId)?.name ?? "None";
    const split = value.split.length
      ? value.split.map((portion) => `${ledger.entities.find((entity) => entity.id === portion.entityId)?.name ?? portion.entityId}: ${formatMoney(portion.amountCents)}`).join(", ")
      : "None";
    return <><div>Category: {category}</div><div>Display name: {value.displayName ?? "Raw description"}</div><div>Tags: {value.tags.join(", ") || "None"}</div><div>Split: {split}</div></>;
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
          <label>Rule name<input value={draft.name} onChange={(event) => changeDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
          <label>Description contains or starts with<input value={draft.match.text} onChange={(event) => updateMatch("text", event.target.value)} /></label>
          <label>Text mode<select value={draft.match.mode} onChange={(event) => updateMatch("mode", event.target.value as EntryRule["match"]["mode"])}><option value="contains">Contains</option><option value="startsWith">Starts with</option></select></label>
          <label>Description regex<input value={draft.match.descriptionRegex ?? ""} onChange={(event) => updateMatch("descriptionRegex", event.target.value)} /></label>
          <fieldset>
            <legend>Weekdays</legend>
            {[
              "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
            ].map((day, weekday) => <label className="checkbox-label" key={day}>
              <input
                checked={(draft.match.weekday ?? []).includes(weekday)}
                onChange={(event) => updateMatch("weekday", event.target.checked
                  ? [...new Set([...(draft.match.weekday ?? []), weekday])].sort((first, second) => first - second)
                  : (draft.match.weekday ?? []).filter((value) => value !== weekday))}
                type="checkbox"
              />{day}
            </label>)}
          </fieldset>
          <label>Account<select value={draft.match.accountId ?? ""} onChange={(event) => updateMatch("accountId", event.target.value || null)}><option value="">Any account</option>{ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>Direction<select value={draft.match.sign} onChange={(event) => updateMatch("sign", event.target.value as EntryRule["match"]["sign"])}><option value="any">Any</option><option value="out">Money out</option><option value="in">Money in</option></select></label>
          <label>Minimum amount (cents)<input min="0" step="1" type="number" value={draft.match.minCents ?? ""} onChange={(event) => updateMatch("minCents", event.target.value === "" ? null : Number(event.target.value))} /></label>
          <label>Maximum amount (cents)<input min="0" step="1" type="number" value={draft.match.maxCents ?? ""} onChange={(event) => updateMatch("maxCents", event.target.value === "" ? null : Number(event.target.value))} /></label>
          <label>Scope<select value={draft.scope ?? "newRows"} onChange={(event) => changeDraft((current) => ({ ...current, scope: event.target.value as EntryRule["scope"] }))}><option value="newRows">New bank rows</option><option value="existingEntries">Existing entries</option><option value="both">Both</option></select></label>
          <label className="checkbox-label"><input checked={draft.protectManualEdits ?? true} onChange={(event) => changeDraft((current) => ({ ...current, protectManualEdits: event.target.checked }))} type="checkbox" />Protect manual edits</label>
          <label>Display name<input value={draft.action.displayName ?? ""} onChange={(event) => updateAction("displayName", event.target.value || null)} /></label>
          <label>Category<select value={draft.action.categoryId ?? ""} onChange={(event) => updateAction("categoryId", event.target.value || null)}><option value="">No category</option>{(ledger.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Split<select value={splitKind(draft.action.split)} onChange={(event) => setSplitKind(event.target.value)}><option value="none">No split</option><option value="payer">Payer</option><option value="halfHouse">Half House</option><option value="allHouse">All House</option><option value="entity">One entity</option><option value="equal">Equal entities</option></select></label>
          {draft.action.split?.kind === "entity" && <label>Split entity<select value={draft.action.split.entityId} onChange={(event) => updateAction("split", { kind: "entity", entityId: event.target.value })}>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>}
          {draft.action.split?.kind === "equal" && <label>Equal split entities<select multiple size={Math.min(4, Math.max(2, ledger.entities.length))} value={draft.action.split.entityIds} onChange={(event) => {
            const entityIds = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
            if (entityIds.length) updateAction("split", { kind: "equal", entityIds });
          }}>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>}
          <label>Tags (comma-separated)<input value={tagsText} onChange={(event) => { setTagsText(event.target.value); setPreview(null); setSelectedItems(new Set()); }} /></label>
          <label className="checkbox-label"><input checked={draft.autoConfirm} onChange={(event) => changeDraft((current) => ({ ...current, autoConfirm: event.target.checked }))} type="checkbox" />Auto-confirm when a split is set</label>
          <section>
            <h3>Preview changes</h3>
            {preview && <>
              <p>{preview.bankRows.length + preview.entries.length} matching items</p>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Select</th><th>Item</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>
                    {preview.bankRows.map(({ row, after }) => {
                      const key = `row:${row.id}`;
                      return <tr key={key}>
                        <td><input aria-label={`Select ${row.description}`} checked={selectedItems.has(key)} onChange={(event) => setSelectedItems((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })} type="checkbox" /></td>
                        <td>{row.date} · {row.description} · {formatMoney(Math.abs(row.amountCents))}</td>
                        <td>New spend</td>
                        <td>{renderSummary(after)}</td>
                      </tr>;
                    })}
                    {preview.entries.map(({ entry, before, after }) => {
                      const key = `entry:${entry.id}`;
                      return <tr key={key}>
                        <td><input aria-label={`Select ${entry.description}`} checked={selectedItems.has(key)} onChange={(event) => setSelectedItems((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })} type="checkbox" /></td>
                        <td>{entry.date} · {entry.description} · {formatMoney(entry.amountCents)}</td>
                        <td>{renderSummary(before)}</td>
                        <td>{renderSummary(after)}</td>
                      </tr>;
                    })}
                    {preview.bankRows.length + preview.entries.length === 0 && <tr><td colSpan={4}>No matching changes.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="dialog-actions">
                <button className="secondary" disabled={!selectedItems.size} onClick={() => applyPreview(false)} type="button">Apply selected ({selectedItems.size})</button>
                <button className="primary" disabled={!preview.bankRows.length && !preview.entries.length} onClick={() => applyPreview(true)} type="button">Apply all</button>
                <button className="secondary" onClick={() => { setPreview(null); setSelectedItems(new Set()); }} type="button">Discard</button>
              </div>
            </>}
          </section>
          {formError && <p className="banner error" role="alert">{formError}</p>}
          <div className="dialog-actions">
            <button className="secondary" onClick={runPreview} type="button">Preview</button>
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
                <td>{rule.match.descriptionRegex || rule.match.text || "Any description"} · {rule.match.descriptionRegex ? "regex" : rule.match.mode === "contains" ? "contains" : "starts with"}</td>
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