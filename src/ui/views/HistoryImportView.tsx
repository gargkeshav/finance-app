import { useState } from "react";
import {
  applyHistoryImport,
  planHistoryImport,
  previewHistoryImport,
  suggestHistoryMapping,
  type GroupMap,
  type HistoryImportPlan,
  type HistoryImportProblem,
  type HistoryImportPreview,
  type HistoryImportRow,
  type HistoryMapping,
  type SubtypeMap,
} from "../../domain/history-import";
import type { Ledger } from "../../domain/ledger";
import { STARTER_CATEGORIES } from "../../domain/taxonomy";
import { formatMoney } from "../../domain/value";
import { ComboField } from "./ComboField";

interface HistoryImportViewProps {
  ledger: Ledger;
  update: (ledger: Ledger, undoLabel?: string, actor?: "you" | "rule" | "import" | "splitwise" | "matcher" | "system") => void;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function rowsForPlan(plan: HistoryImportPlan): HistoryImportRow[] {
  return [...plan.created, ...plan.pending, ...plan.payments];
}

function entityOptions(ledger: Ledger) {
  return ledger.entities.filter((entity) => entity.kind === "person" || entity.kind === "group")
    .map(({ id, name }) => ({ id, name }));
}

function categoryOptions(ledger: Ledger) {
  const categories = (ledger.categories ?? []).map(({ id, name }) => ({ id, name }));
  for (const starter of STARTER_CATEGORIES) {
    for (const name of [starter.name, ...starter.children]) {
      if (!categories.some((option) => normalized(option.name) === normalized(name))) {
        categories.push({ id: `starter:${name}`, name });
      }
    }
  }
  return categories;
}

function ImportRows({ title, rows }: { title: string; rows: HistoryImportRow[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h3>{title} ({rows.length})</h3>
      <ul>
        {rows.slice(0, 10).map((row) => (
          <li key={`${row.lineNumber}-${row.historyKey}`}>
            Line {row.lineNumber}: {row.date} · {row.description || "(no description)"} · {formatMoney(row.bankAmountCents)}
          </li>
        ))}
      </ul>
      {rows.length > 10 && <p>Showing the first 10 of {rows.length} rows.</p>}
    </section>
  );
}

function ProblemRows({ rows }: { rows: HistoryImportProblem[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label="Problem rows">
      <h3>Problems ({rows.length})</h3>
      <ul>
        {rows.slice(0, 10).map((row) => (
          <li key={`${row.lineNumber}-${row.reason}`}>
            Line {row.lineNumber}: {row.date} · {row.description || "(no description)"} · {row.reason}
          </li>
        ))}
      </ul>
      {rows.length > 10 && <p>Showing the first 10 of {rows.length} rows.</p>}
    </section>
  );
}

export function HistoryImportView({ ledger, update }: HistoryImportViewProps) {
  const [accountId, setAccountId] = useState(ledger.accounts.find((account) => account.type === "credit")?.id ?? "");
  const [plan, setPlan] = useState<HistoryImportPlan | null>(null);
  const [mapping, setMapping] = useState<HistoryMapping | null>(null);
  const [skipProblems, setSkipProblems] = useState(false);
  const [replace, setReplace] = useState(() => ledger.entries.some((entry) => entry.source === "history"));
  const [removeEntityIds, setRemoveEntityIds] = useState<string[] | null>(null);
  const [removeCategoryIds, setRemoveCategoryIds] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function readHistory(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setPlan(null);
    setMapping(null);
    setMessage("");
    setError("");
    if (!file || !accountId) return;
    setBusy(true);
    try {
      const nextPlan = await planHistoryImport(await file.text(), ledger, accountId);
      setPlan(nextPlan);
      setMapping(suggestHistoryMapping(nextPlan, ledger));
      setSkipProblems(false);
      setRemoveEntityIds(null);
      setRemoveCategoryIds(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The history file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function commit() {
    if (!plan || !mapping || !preview || (plan.problems.length > 0 && !skipProblems)) return;
    try {
      update(applyHistoryImport(plan, ledger, mapping, {
        replace,
        removeEntityIds: removeEntityIds ?? preview.unreferencedEntities.map((entity) => entity.id),
        removeCategoryIds: removeCategoryIds ?? preview.unreferencedCategories.map((category) => category.id),
      }), "Import history", "system");
      setMessage("Save the file now");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The history rows could not be added.");
    }
  }

  const rows = plan ? rowsForPlan(plan) : [];
  const groupRows = new Map<string, HistoryImportRow[]>();
  for (const row of rows) {
    if (!row.group) continue;
    const key = normalized(row.group);
    groupRows.set(key, [...(groupRows.get(key) ?? []), row]);
  }
  const subtypeRows = new Map<string, HistoryImportRow[]>();
  for (const row of rows) {
    if (!row.subtype) continue;
    const key = normalized(row.subtype);
    subtypeRows.set(key, [...(subtypeRows.get(key) ?? []), row]);
  }
  const entityChoices = entityOptions(ledger);
  const categoryChoices = categoryOptions(ledger);
  let preview: HistoryImportPreview | null = null;
  let previewError = "";
  if (plan && mapping) {
    try {
      preview = previewHistoryImport(plan, ledger, mapping, { replace });
    } catch (reason) {
      previewError = reason instanceof Error ? reason.message : "The history import preview could not be built.";
    }
  }

  function updateGroup(key: string, value: GroupMap) {
    setMapping((current) => current ? { ...current, groups: { ...current.groups, [key]: value } } : current);
  }

  function updateSubtype(key: string, value: SubtypeMap) {
    setMapping((current) => current ? { ...current, subtypes: { ...current.subtypes, [key]: value } } : current);
  }

  function nameComboValue(value: string, options: { id: string; name: string }[]) {
    return options.find((option) => normalized(option.name) === normalized(value))?.id ?? (value ? `new:${value}` : "");
  }

  function comboNameChange(id: string, options: { id: string; name: string }[], onName: (name: string) => void) {
    if (id.startsWith("new:")) onName(id.slice(4));
    else onName(options.find((option) => option.id === id)?.name ?? "");
  }

  return (
    <section className="form-grid" aria-label="One-time history import">
      <h2>One-time ANZ credit history</h2>
      <label>
        Credit account
        <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setPlan(null); setMapping(null); setMessage(""); }}>
          <option value="">Choose an account</option>
          {ledger.accounts.filter((account) => account.type === "credit").map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
      </label>
      <label>
        History CSV
        <input accept=".csv,text/csv" disabled={!accountId || busy} onChange={(event) => void readHistory(event)} type="file" />
      </label>
      {busy && <p role="status">Reading history file…</p>}
      {error && <p className="banner error" role="alert">{error}</p>}
      {message && <p className="banner success" role="status">{message}</p>}
      {plan && (
        <>
          <p>
            {plan.matched.length} matched · {plan.created.length} to create · {plan.skipped.length} skipped · {plan.pending.length} pending · {plan.problems.length} problems
          </p>
          <ImportRows title="Matched bank rows" rows={plan.matched} />
          <ImportRows title="Entries to create" rows={plan.created} />
          <ImportRows title="Skipped rows" rows={plan.skipped} />
          <ImportRows title="Pending associations" rows={plan.pending} />
          <ProblemRows rows={plan.problems} />
          {plan.problems.length > 0 && (
            <label className="checkbox-label">
              <input checked={skipProblems} onChange={(event) => setSkipProblems(event.target.checked)} type="checkbox" />
              Skip problem rows
            </label>
          )}
          {mapping && (
            <>
              <section aria-label="Group mapping">
                <h3>Groups</h3>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Value</th><th>Rows</th><th>Open rows</th><th>To</th><th>Name</th><th>Type</th></tr></thead>
                    <tbody>
                      {[...groupRows.entries()].map(([key, groupItems]) => {
                        const current = mapping.groups[key] ?? { to: "person" as const, name: groupItems[0].group };
                        const mappedEntity = current.to === "person" || current.to === "group" ? current.name : "";
                        const groupOptions = mappedEntity && !entityChoices.some((option) => normalized(option.name) === normalized(mappedEntity))
                          ? [...entityChoices, { id: `new:${mappedEntity}`, name: mappedEntity }]
                          : entityChoices;
                        return (
                          <tr key={key}>
                            <td>{groupItems[0].group}</td>
                            <td>{groupItems.length}</td>
                            <td>{groupItems.filter((row) => row.status.toLowerCase() !== "settled").length}</td>
                            <td>
                              <label>
                                <span className="sr-only">Map {groupItems[0].group} to</span>
                                <select value={current.to} onChange={(event) => {
                                  const to = event.target.value as GroupMap["to"];
                                  updateGroup(key, to === "self"
                                    ? { to, tag: current.to === "self" ? current.tag : "" }
                                    : { to, name: mappedEntity || groupItems[0].group, ...(to === "group" ? { groupType: current.to === "group" ? current.groupType : "friends" } : {}) });
                                }}>
                                  <option value="person">Person</option><option value="group">Group</option><option value="self">Fold into you</option>
                                </select>
                              </label>
                            </td>
                            <td>
                              {current.to === "self" ? (
                                <label><span className="sr-only">Tag for {groupItems[0].group}</span><input value={current.tag ?? ""} onChange={(event) => updateGroup(key, { ...current, tag: event.target.value })} /></label>
                              ) : (
                                <ComboField
                                  key={`${key}-${current.to}-${current.name}`}
                                  label={`Name for ${groupItems[0].group}`}
                                  value={nameComboValue(current.name, entityChoices)}
                                  options={groupOptions}
                                  nonePlaceholder="Enter a name"
                                  onCreate={(name) => `new:${name}`}
                                  onChange={(id) => comboNameChange(id, entityChoices, (name) => updateGroup(key, { ...current, name }))}
                                />
                              )}
                            </td>
                            <td>
                              {current.to === "group" && (
                                <label>
                                  <span className="sr-only">Type for {groupItems[0].group}</span>
                                  <select value={current.groupType ?? "other"} onChange={(event) => updateGroup(key, { ...current, groupType: event.target.value as NonNullable<typeof current.groupType> })}>
                                    <option value="household">Household</option><option value="trip">Trip</option><option value="friends">Friends</option><option value="project">Project</option><option value="other">Other</option>
                                  </select>
                                </label>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-label="Subtype mapping">
                <h3>Subtypes</h3>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Value</th><th>Rows</th><th>To</th><th>Category</th><th>Name or tag</th><th>Gift card</th></tr></thead>
                    <tbody>
                      {[...subtypeRows.entries()].map(([key, subtypeItems]) => {
                        const current = mapping.subtypes[key] ?? { to: "category" as const, name: subtypeItems[0].subtype };
                        const categoryValue = current.to === "category" ? current.name ?? "" : current.category ?? "";
                        const subtypeCategoryOptions = categoryValue && !categoryChoices.some((option) => normalized(option.name) === normalized(categoryValue))
                          ? [...categoryChoices, { id: `new:${categoryValue}`, name: categoryValue }]
                          : categoryChoices;
                        const categoryIsNew = Boolean(categoryValue) && !categoryChoices.some((option) => normalized(option.name) === normalized(categoryValue));
                        const giftCard = current.to === "merchant" && normalized(current.category ?? "") === "gift cards";
                        return (
                          <tr key={key}>
                            <td>{subtypeItems[0].subtype}</td><td>{subtypeItems.length}</td>
                            <td>
                              <label>
                                <span className="sr-only">Map {subtypeItems[0].subtype} to</span>
                                <select value={current.to} onChange={(event) => {
                                  const to = event.target.value as SubtypeMap["to"];
                                  updateSubtype(key, to === "category"
                                    ? { to, name: categoryValue || subtypeItems[0].subtype }
                                    : to === "merchant"
                                      ? { to, displayName: subtypeItems[0].subtype, category: categoryValue }
                                      : { to, tag: subtypeItems[0].subtype.toLowerCase(), category: categoryValue });
                                }}>
                                  <option value="category">Category</option><option value="merchant">Merchant name</option><option value="tag">Tag</option>
                                </select>
                              </label>
                            </td>
                            <td>
                              <ComboField
                                key={`${key}-category-${categoryValue}`}
                                label={`Category for ${subtypeItems[0].subtype}`}
                                value={nameComboValue(categoryValue, categoryChoices)}
                                options={subtypeCategoryOptions}
                                nonePlaceholder="No category"
                                onCreate={(name) => `new:${name}`}
                                onChange={(id) => comboNameChange(id, categoryChoices, (name) => {
                                  if (current.to === "category") updateSubtype(key, { to: "category", name });
                                  else updateSubtype(key, { ...current, category: name });
                                })}
                              />
                              {categoryIsNew && <span>New</span>}
                            </td>
                            <td>
                              {current.to === "merchant" ? (
                                <label><span className="sr-only">Merchant name for {subtypeItems[0].subtype}</span><input value={current.displayName} onChange={(event) => updateSubtype(key, { ...current, displayName: event.target.value })} /></label>
                              ) : current.to === "tag" ? (
                                <label><span className="sr-only">Tag for {subtypeItems[0].subtype}</span><input value={current.tag} onChange={(event) => updateSubtype(key, { ...current, tag: event.target.value })} /></label>
                              ) : null}
                            </td>
                            <td>
                              <label className="checkbox-label">
                                <input checked={giftCard} onChange={(event) => updateSubtype(key, event.target.checked
                                  ? { to: "merchant", displayName: subtypeItems[0].subtype, category: "Gift cards" }
                                  : { to: "category", name: "Gift cards" })} type="checkbox" />
                                <span className="sr-only">Mark {subtypeItems[0].subtype} as gift card</span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <fieldset>
                <legend>When your share is blank</legend>
                {([
                  ["theyOweAll", "They owe all"],
                  ["splitEqual", "Split equally"],
                  ["groupDefault", "Use group default"],
                ] as const).map(([value, label]) => (
                  <label className="checkbox-label" key={value}>
                    <input checked={mapping.blankShare === value} name="blank-share" onChange={() => setMapping({ ...mapping, blankShare: value })} type="radio" />
                    {label}
                  </label>
                ))}
              </fieldset>

              <label className="checkbox-label">
                <input checked={replace} onChange={(event) => { setReplace(event.target.checked); setRemoveEntityIds(null); setRemoveCategoryIds(null); }} type="checkbox" />
                Replace the earlier history import
              </label>

              {previewError && <p className="banner error" role="alert">{previewError}</p>}
              {preview && (
                <>
                  {replace && (preview.unreferencedEntities.length > 0 || preview.unreferencedCategories.length > 0) && (
                    <section aria-label="Unreferenced records">
                      <h3>Unreferenced records after replacement</h3>
                      {preview.unreferencedEntities.map((entity) => (
                        <label className="checkbox-label" key={entity.id}>
                          <input checked={(removeEntityIds ?? preview.unreferencedEntities.map((item) => item.id)).includes(entity.id)} onChange={(event) => setRemoveEntityIds((current) => {
                            const selected = new Set(current ?? preview.unreferencedEntities.map((item) => item.id));
                            if (event.target.checked) selected.add(entity.id); else selected.delete(entity.id);
                            return [...selected];
                          })} type="checkbox" />
                          Remove entity: {entity.name}
                        </label>
                      ))}
                      {preview.unreferencedCategories.map((category) => (
                        <label className="checkbox-label" key={category.id}>
                          <input checked={(removeCategoryIds ?? preview.unreferencedCategories.map((item) => item.id)).includes(category.id)} onChange={(event) => setRemoveCategoryIds((current) => {
                            const selected = new Set(current ?? preview.unreferencedCategories.map((item) => item.id));
                            if (event.target.checked) selected.add(category.id); else selected.delete(category.id);
                            return [...selected];
                          })} type="checkbox" />
                          Remove category: {category.name}
                        </label>
                      ))}
                    </section>
                  )}
                  <section aria-label="Import preview">
                    <h3>Preview</h3>
                    <p>{preview.byKind.spend} spends · {preview.byKind.refund} refunds · {preview.payments} payments · {preview.needsShare} needs-share</p>
                    <p>{preview.entitiesCreated.length} entities created · {preview.entitiesMerged.length} entity mappings merged · {preview.categoriesCreated.length} categories created · {preview.categoriesMerged.length} category mappings merged</p>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Entity</th><th>Before</th><th>After</th></tr></thead>
                        <tbody>
                          {Array.from(new Set([...Object.keys(preview.balancesBefore), ...Object.keys(preview.balancesAfter)])).map((id) => (
                            <tr key={id}>
                              <td>{ledger.entities.find((entity) => entity.id === id)?.name ?? id}</td>
                              <td>{formatMoney(preview.balancesBefore[id] ?? 0)}</td>
                              <td>{formatMoney(preview.balancesAfter[id] ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              <div className="dialog-actions">
                <button className="primary" disabled={!preview || Boolean(previewError) || (plan.problems.length > 0 && !skipProblems)} onClick={commit} type="button">
                  Commit import
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}