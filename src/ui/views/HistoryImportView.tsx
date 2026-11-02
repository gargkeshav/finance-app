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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card aria-label="One-time history import">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>One-time ANZ credit history</CardTitle>
            <p className="text-sm text-muted-foreground">Match this statement to your ledger, then review what will be added.</p>
          </div>
          <Badge variant="outline">Dev only</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid content-start gap-2 text-sm font-medium">
          1. Credit account
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={accountId} onChange={(event) => { setAccountId(event.target.value); setPlan(null); setMapping(null); setMessage(""); }}>
            <option value="">Choose an account</option>
            {ledger.accounts.filter((account) => account.type === "credit").map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
        <label className="grid content-start gap-2 text-sm font-medium">
          2. History CSV
          <input className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" accept=".csv,text/csv" disabled={!accountId || busy} onChange={(event) => void readHistory(event)} type="file" />
          <span className="text-xs font-normal text-muted-foreground">Choose the ANZ history file to build a review preview.</span>
        </label>
      </div>
      {busy && <p role="status">Reading history file…</p>}
      {error && <p className="rounded-md border p-3 text-sm border-destructive/40 text-destructive" role="alert">{error}</p>}
      {message && <p className="rounded-md border p-3 text-sm border-positive/40 text-positive" role="status">{message}</p>}
      {plan && (
        <>
          <section aria-label="Import summary" className="grid gap-1 rounded-md border bg-muted/30 p-4">
            <h3 className="font-medium">3. Review the statement</h3>
            <p className="text-sm text-muted-foreground">
              {plan.matched.length} matched · {plan.created.length} to create · {plan.skipped.length} skipped · {plan.pending.length} pending · {plan.problems.length} problems
            </p>
          </section>
          <ImportRows title="Matched bank rows" rows={plan.matched} />
          <ImportRows title="Entries to create" rows={plan.created} />
          <ImportRows title="Skipped rows" rows={plan.skipped} />
          <ImportRows title="Pending associations" rows={plan.pending} />
          <ProblemRows rows={plan.problems} />
          {plan.problems.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input checked={skipProblems} onChange={(event) => setSkipProblems(event.target.checked)} type="checkbox" />
              Skip problem rows
            </label>
          )}
          {mapping && (
            <>
              <details className="rounded-md border p-4">
                <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review group and subtype mappings</summary>
                <div className="grid gap-6 pt-4">
                  <section aria-label="Group mapping" className="grid gap-3">
                    <div>
                      <h3 className="font-medium">Groups</h3>
                      <p className="text-sm text-muted-foreground">Choose who each group name refers to in your ledger.</p>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {[...groupRows.entries()].map(([key, groupItems]) => {
                        const current = mapping.groups[key] ?? { to: "person" as const, name: groupItems[0].group };
                        const mappedEntity = current.to === "person" || current.to === "group" ? current.name : "";
                        const groupOptions = mappedEntity && !entityChoices.some((option) => normalized(option.name) === normalized(mappedEntity))
                          ? [...entityChoices, { id: `new:${mappedEntity}`, name: mappedEntity }]
                          : entityChoices;
                        const openCount = groupItems.filter((row) => row.status.toLowerCase() !== "settled").length;
                        return (
                          <article className="grid min-w-0 gap-3 rounded-md border p-3" key={key}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h4 className="font-medium">{groupItems[0].group}</h4>
                              <span className="text-xs text-muted-foreground">{groupItems.length} rows · {openCount} open</span>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="grid gap-1 text-sm font-medium">
                                Map to
                                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={current.to} onChange={(event) => {
                                  const to = event.target.value as GroupMap["to"];
                                  updateGroup(key, to === "self"
                                    ? { to, tag: current.to === "self" ? current.tag : "" }
                                    : { to, name: mappedEntity || groupItems[0].group, ...(to === "group" ? { groupType: current.to === "group" ? current.groupType : "friends" } : {}) });
                                }}>
                                  <option value="person">Person</option><option value="group">Group</option><option value="self">Fold into you</option>
                                </select>
                              </label>
                              {current.to === "self" ? (
                                <label className="grid gap-1 text-sm font-medium">Tag for this group
                                  <input className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={current.tag ?? ""} onChange={(event) => updateGroup(key, { ...current, tag: event.target.value })} />
                                </label>
                              ) : (
                                <ComboField
                                  key={`${key}-${current.to}-${current.name}`}
                                  label="Name"
                                  value={nameComboValue(current.name, entityChoices)}
                                  options={groupOptions}
                                  nonePlaceholder="Enter a name"
                                  onCreate={(name) => `new:${name}`}
                                  onChange={(id) => comboNameChange(id, entityChoices, (name) => updateGroup(key, { ...current, name }))}
                                />
                              )}
                              {current.to === "group" && (
                                <label className="grid gap-1 text-sm font-medium">Group type
                                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={current.groupType ?? "other"} onChange={(event) => updateGroup(key, { ...current, groupType: event.target.value as NonNullable<typeof current.groupType> })}>
                                    <option value="household">Household</option><option value="trip">Trip</option><option value="friends">Friends</option><option value="project">Project</option><option value="other">Other</option>
                                  </select>
                                </label>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section aria-label="Subtype mapping" className="grid gap-3">
                    <div>
                      <h3 className="font-medium">Subtypes</h3>
                      <p className="text-sm text-muted-foreground">Map statement labels to a category, merchant, or tag.</p>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {[...subtypeRows.entries()].map(([key, subtypeItems]) => {
                        const current = mapping.subtypes[key] ?? { to: "category" as const, name: subtypeItems[0].subtype };
                        const categoryValue = current.to === "category" ? current.name ?? "" : current.category ?? "";
                        const subtypeCategoryOptions = categoryValue && !categoryChoices.some((option) => normalized(option.name) === normalized(categoryValue))
                          ? [...categoryChoices, { id: `new:${categoryValue}`, name: categoryValue }]
                          : categoryChoices;
                        const categoryIsNew = Boolean(categoryValue) && !categoryChoices.some((option) => normalized(option.name) === normalized(categoryValue));
                        const giftCard = current.to === "merchant" && normalized(current.category ?? "") === "gift cards";
                        return (
                          <article className="grid min-w-0 gap-3 rounded-md border p-3" key={key}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h4 className="font-medium">{subtypeItems[0].subtype}</h4>
                              <span className="text-xs text-muted-foreground">{subtypeItems.length} rows</span>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="grid gap-1 text-sm font-medium">Map to
                                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={current.to} onChange={(event) => {
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
                              <div className="grid min-w-0 gap-1">
                                <ComboField
                                  key={`${key}-category-${categoryValue}`}
                                  label="Category"
                                  value={nameComboValue(categoryValue, categoryChoices)}
                                  options={subtypeCategoryOptions}
                                  nonePlaceholder="No category"
                                  onCreate={(name) => `new:${name}`}
                                  onChange={(id) => comboNameChange(id, categoryChoices, (name) => {
                                    if (current.to === "category") updateSubtype(key, { to: "category", name });
                                    else updateSubtype(key, { ...current, category: name });
                                  })}
                                />
                                {categoryIsNew && <span className="text-xs text-muted-foreground">New category</span>}
                              </div>
                              {current.to === "merchant" ? (
                                <label className="grid gap-1 text-sm font-medium">Merchant name
                                  <input className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={current.displayName} onChange={(event) => updateSubtype(key, { ...current, displayName: event.target.value })} />
                                </label>
                              ) : current.to === "tag" ? (
                                <label className="grid gap-1 text-sm font-medium">Tag
                                  <input className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={current.tag} onChange={(event) => updateSubtype(key, { ...current, tag: event.target.value })} />
                                </label>
                              ) : null}
                              <label className="flex items-center gap-2 self-end text-sm">
                                <input checked={giftCard} onChange={(event) => updateSubtype(key, event.target.checked
                                  ? { to: "merchant", displayName: subtypeItems[0].subtype, category: "Gift cards" }
                                  : { to: "category", name: "Gift cards" })} type="checkbox" />
                                Gift card
                              </label>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                  <fieldset className="grid gap-2 rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium">When your share is blank</legend>
                    <p className="text-sm text-muted-foreground">Choose how to interpret rows without a share amount.</p>
                    {([
                      ["theyOweAll", "They owe all"],
                      ["splitEqual", "Split equally"],
                      ["groupDefault", "Use group default"],
                    ] as const).map(([value, label]) => (
                      <label className="flex items-center gap-2 text-sm" key={value}>
                        <input checked={mapping.blankShare === value} name="blank-share" onChange={() => setMapping({ ...mapping, blankShare: value })} type="radio" />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </details>

              {replace && <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">This import will replace the earlier history import.</p>}
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Advanced replacement options</summary>
                <div className="grid gap-3 pt-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input className="mt-0.5" checked={replace} onChange={(event) => { setReplace(event.target.checked); setRemoveEntityIds(null); setRemoveCategoryIds(null); }} type="checkbox" />
                    <span><span className="font-medium">Replace the earlier history import</span><span className="block text-muted-foreground">Use this when importing a corrected statement.</span></span>
                  </label>
                </div>
              </details>

              {previewError && <p className="rounded-md border p-3 text-sm border-destructive/40 text-destructive" role="alert">{previewError}</p>}
              {preview && (
                <>
                  {replace && (preview.unreferencedEntities.length > 0 || preview.unreferencedCategories.length > 0) && (
                    <section aria-label="Unreferenced records" className="grid gap-2 rounded-md border p-3">
                      <h3 className="font-medium">Unreferenced records after replacement</h3>
                      <p className="text-sm text-muted-foreground">Choose which unused records to remove.</p>
                      {preview.unreferencedEntities.map((entity) => (
                        <label className="flex items-center gap-2 text-sm" key={entity.id}>
                          <input checked={(removeEntityIds ?? preview.unreferencedEntities.map((item) => item.id)).includes(entity.id)} onChange={(event) => setRemoveEntityIds((current) => {
                            const selected = new Set(current ?? preview.unreferencedEntities.map((item) => item.id));
                            if (event.target.checked) selected.add(entity.id); else selected.delete(entity.id);
                            return [...selected];
                          })} type="checkbox" />
                          Remove entity: {entity.name}
                        </label>
                      ))}
                      {preview.unreferencedCategories.map((category) => (
                        <label className="flex items-center gap-2 text-sm" key={category.id}>
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
                  <section aria-label="Import preview" className="grid gap-2">
                    <h3 className="font-medium">Preview changes</h3>
                    <p className="text-sm">{preview.byKind.spend} spends · {preview.byKind.refund} refunds · {preview.payments} payments · {preview.needsShare} needs-share</p>
                    <p className="text-sm text-muted-foreground">{preview.entitiesCreated.length} entities created · {preview.entitiesMerged.length} entity mappings merged · {preview.categoriesCreated.length} categories created · {preview.categoriesMerged.length} category mappings merged</p>
                    <div className="hidden w-full min-w-0 overflow-x-auto sm:block">
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
                    <ul className="grid gap-2 sm:hidden">
                      {Array.from(new Set([...Object.keys(preview.balancesBefore), ...Object.keys(preview.balancesAfter)])).map((id) => (
                        <li className="grid gap-1 rounded-md border p-3" key={id}>
                          <h4 className="font-medium">{ledger.entities.find((entity) => entity.id === id)?.name ?? id}</h4>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <span>Before <strong className="block font-medium tabular-nums">{formatMoney(preview.balancesBefore[id] ?? 0)}</strong></span>
                            <span>After <strong className="block font-medium tabular-nums">{formatMoney(preview.balancesAfter[id] ?? 0)}</strong></span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
              <div className="flex justify-end border-t pt-4">
                <Button className="w-full sm:w-auto" disabled={!preview || Boolean(previewError) || (plan.problems.length > 0 && !skipProblems)} onClick={commit} type="button" variant="outline">
                  Add history to ledger
                </Button>
              </div>
            </>
          )}
        </>
      )}
      </CardContent>
    </Card>
  );
}