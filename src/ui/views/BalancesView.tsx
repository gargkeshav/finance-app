import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { balances, HOUSE_ENTITY_ID, report, SELF_ENTITY_ID, type Baseline, type CategoryNature, type Ledger } from "../../domain/ledger";
import { addStarterCategories, STARTER_CATEGORIES } from "../../domain/taxonomy";
import { formatAud, formatMoney, parseAud, sumCents } from "../../domain/value";
import type { EntryFilter } from "../../domain/query";

interface BalancesViewProps {
  ledger: Ledger;
  update: (next: Ledger, undoLabel?: string) => void;
  openActivity: (filter: EntryFilter) => void;
  onOpenEntity?: (entityId: string) => void;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): [string, string] {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`];
}

function centsText(cents: number): string {
  return formatAud(cents).slice(4);
}

const CATEGORY_NATURES: CategoryNature[] = ["essential", "discretionary", "oneOff", "reimbursable", "business", "savings"];

export function BalancesView({ ledger, update, openActivity, onOpenEntity }: BalancesViewProps) {
  const [month, setMonth] = useState(currentMonth);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errorEntityId, setErrorEntityId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showBaselines, setShowBaselines] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, { parentId: string; nature: CategoryNature | "" }>>({});
  const [from, to] = monthBounds(month);
  const monthly = report(ledger.entries, from, to);
  const overall = balances(ledger);
  const selfId = ledger.entities.find((entity) => entity.kind === "self")?.id;
  const entities = ledger.entities.filter((entity) => entity.id !== selfId);
  const categoryTotals = new Map<string, { id: string; name: string; personal: number[]; house: number[] }>();
  for (const entry of monthly.entries) {
    const categoryId = entry.categoryId ?? "";
    const category = ledger.categories?.find((item) => item.id === categoryId);
    const current = categoryTotals.get(categoryId) ?? {
      id: categoryId,
      name: category?.name ?? "Uncategorized",
      personal: [],
      house: [],
    };
    const direction = entry.kind === "refund" ? -1 : 1;
    for (const portion of entry.portions) {
      const signedAmount = direction * portion.amountCents;
      if (portion.entityId === SELF_ENTITY_ID) current.personal.push(signedAmount);
      if (portion.entityId === HOUSE_ENTITY_ID) {
        current.personal.push(Math.sign(signedAmount) * Math.ceil(Math.abs(signedAmount) / 2));
        current.house.push(signedAmount);
      }
    }
    categoryTotals.set(categoryId, current);
  }
  const categoryRows = [...categoryTotals.values()]
    .map((category) => ({
      ...category,
      personalCents: sumCents(category.personal),
      houseCents: sumCents(category.house),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
  const categories = ledger.categories ?? [];
  const categoryNames = new Set(categories.map((category) => category.name.trim().toLowerCase()));
  const hasMissingStarterCategories = STARTER_CATEGORIES.some((starter) =>
    !categoryNames.has(starter.name.toLowerCase()) || starter.children.some((child) => !categoryNames.has(child.toLowerCase())),
  );

  function baselineFor(entityId: string): Baseline | undefined {
    return ledger.baselines.find((baseline) => baseline.entityId === entityId);
  }

  function saveBaseline(entityId: string) {
    const raw = drafts[entityId] ?? "";
    let amountCents: number;
    try {
      amountCents = raw.trim() === "" ? 0 : parseAud(raw);
    } catch {
      setErrorEntityId(entityId);
      setError("Enter a valid AUD amount with up to two decimal places.");
      return;
    }
    const existing = baselineFor(entityId);
    if (!existing && amountCents === 0) {
      setDrafts((current) => { const next = { ...current }; delete next[entityId]; return next; });
      return;
    }
    const baseline: Baseline = existing
      ? { ...existing, amountCents }
      : { id: crypto.randomUUID(), entityId, amountCents, updatedAt: new Date().toISOString() };
    update({
      ...ledger,
      baselines: existing
        ? ledger.baselines.map((item) => item.id === existing.id ? baseline : item)
        : [...ledger.baselines, baseline],
    });
    setDrafts((current) => { const next = { ...current }; delete next[entityId]; return next; });
    setErrorEntityId(null);
    setError("");
  }

  function isDescendant(candidateId: string, categoryId: string): boolean {
    let current = categories.find((category) => category.id === candidateId);
    for (let steps = 0; current && steps < categories.length; steps += 1) {
      if (current.parentId === categoryId) return true;
      current = current.parentId ? categories.find((category) => category.id === current?.parentId) : undefined;
    }
    return false;
  }

  function updateCategoryDraft(categoryId: string, defaults: { parentId: string; nature: CategoryNature | "" }, changes: Partial<{ parentId: string; nature: CategoryNature | "" }>) {
    setCategoryDrafts((current) => ({
      ...current,
      [categoryId]: { ...(current[categoryId] ?? defaults), ...changes },
    }));
  }

  function saveCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;
    const draft = categoryDrafts[categoryId] ?? { parentId: category.parentId ?? "", nature: category.nature ?? "" };
    const updated = {
      ...category,
      parentId: draft.parentId || undefined,
      nature: draft.nature || undefined,
    };
    update({ ...ledger, categories: categories.map((item) => item.id === categoryId ? updated : item) });
    setCategoryDrafts((current) => { const next = { ...current }; delete next[categoryId]; return next; });
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Balances</h1>
        <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => setMonth(currentMonth())} type="button">Current month</button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} />
        </label>
      </div>
      <section className="flex flex-wrap gap-4" aria-label="Monthly spending">
        <div><span className="text-sm text-muted-foreground">Personal spend</span><strong className="text-right tabular-nums">{formatMoney(monthly.personalCents)}</strong></div>
        <div><span className="text-sm text-muted-foreground">House spend</span><strong className="text-right tabular-nums">{formatMoney(monthly.houseCents)}</strong></div>
      </section>

      <section className="section-heading">
        <h2>By category</h2>
        {hasMissingStarterCategories && <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => update(addStarterCategories(ledger, new Date().toISOString()), "Add suggested categories")} type="button">Add suggested categories</button>}
      </section>
      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Category</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Personal</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">House</TableHead></TableRow></TableHeader>
          <TableBody>
            {categoryRows.map((category) => (
              <TableRow key={category.id}>
                <TableCell>
                  {category.name}
                  {category.id && (() => {
                    const record = categories.find((item) => item.id === category.id);
                    if (!record) return null;
                    const defaults = { parentId: record.parentId ?? "", nature: record.nature ?? "" as const };
                    const draft = categoryDrafts[record.id] ?? defaults;
                    return (
                      <details>
                        <summary>Edit</summary>
                        <div className="grid gap-4">
                          <label>Parent
                            <select value={draft.parentId} onChange={(event) => updateCategoryDraft(record.id, defaults, { parentId: event.target.value })}>
                              <option value="">None</option>
                              {categories.filter((candidate) => candidate.id !== record.id && !isDescendant(candidate.id, record.id)).map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>Nature
                            <select value={draft.nature} onChange={(event) => updateCategoryDraft(record.id, defaults, { nature: event.target.value as CategoryNature | "" })}>
                              <option value="">Unspecified</option>
                              {CATEGORY_NATURES.map((nature) => <option key={nature} value={nature}>{nature}</option>)}
                            </select>
                          </label>
                          <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => saveCategory(record.id)} type="button">Save</button>
                        </div>
                      </details>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right tabular-nums"><button className="text-right tabular-nums drilldown-button" aria-label={`${category.name} personal transactions: ${formatMoney(category.personalCents)}`} onClick={() => openActivity({ from, to, categoryId: category.id || undefined, entityId: SELF_ENTITY_ID })} type="button">{formatMoney(category.personalCents)}</button></TableCell>
                <TableCell className="text-right tabular-nums"><button className="text-right tabular-nums drilldown-button" aria-label={`${category.name} house transactions: ${formatMoney(category.houseCents)}`} onClick={() => openActivity({ from, to, categoryId: category.id || undefined, entityId: HOUSE_ENTITY_ID })} type="button">{formatMoney(category.houseCents)}</button></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableHead scope="row" className="!text-secondary-foreground !text-xl !font-bold">Total</TableHead>
              <TableCell className="text-right tabular-nums">{formatMoney(monthly.personalCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(monthly.houseCents)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {categoryRows.length === 0 && <p className="text-sm text-muted-foreground p-4">No spending for this month.</p>}
      </div>

      <section className="section-heading">
        <h2>Balances</h2>
        <Button variant="outline" onClick={() => setShowBaselines((visible) => !visible)} type="button">{showBaselines ? "Hide opening balances" : "Edit opening balances"}</Button>
      </section>
      {error && <p className="rounded-md border p-3 text-sm border-destructive/40 text-destructive" role="alert">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entities.map((entity) => {
          const amount = overall.byEntity[entity.id] ?? 0;
          const baseline = baselineFor(entity.id);
          const balanceLabel = amount > 0
            ? `${entity.name} owes you ${formatMoney(amount)}`
            : amount < 0
              ? `You owe ${entity.name} ${formatMoney(Math.abs(amount))}`
              : "Settled";
          return (
            <Card key={entity.id} className={amount > 0 ? "border-positive/40" : amount < 0 ? "border-negative/40" : ""}>
              <CardHeader>
                <CardTitle className="text-base">
                  {onOpenEntity
                    ? <Button variant="link" className="h-auto p-0 text-base" onClick={() => onOpenEntity(entity.id)} type="button">{entity.name}</Button>
                    : entity.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className={`text-right tabular-nums ${amount > 0 ? "text-positive" : amount < 0 ? "text-negative" : "text-muted-foreground"}`}>{balanceLabel}</p>
                {showBaselines && <div>
                    <label>
                      <span className="text-sm text-muted-foreground">Opening balance</span>
                      <input
                        inputMode="decimal"
                        value={drafts[entity.id] ?? (baseline && baseline.amountCents !== 0 ? centsText(baseline.amountCents) : "")}
                        onChange={(event) => { setDrafts((current) => ({ ...current, [entity.id]: event.target.value })); if (errorEntityId === entity.id) { setErrorEntityId(null); setError(""); } }}
                        onBlur={() => { if (entity.id in drafts) saveBaseline(entity.id); }}
                        aria-invalid={errorEntityId === entity.id}
                      />
                    </label>
                </div>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {overall.betweenEntities.length > 0 && <>
      <h2>Between others</h2>
      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Debtor</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Creditor</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {overall.betweenEntities.map((debt) => (
              <TableRow key={`${debt.debtorId}-${debt.creditorId}`}>
                <TableCell>{ledger.entities.find((entity) => entity.id === debt.debtorId)?.name ?? "Unknown"}</TableCell>
                <TableCell>{ledger.entities.find((entity) => entity.id === debt.creditorId)?.name ?? "Unknown"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(debt.amountCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      </>}
    </>
  );
}