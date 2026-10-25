import { useState } from "react";
import { balances, HOUSE_ENTITY_ID, report, SELF_ENTITY_ID, type Baseline, type Ledger } from "../../domain/ledger";
import { formatAud, formatMoney, parseAud, sumCents } from "../../domain/value";

interface BalancesViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
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

export function BalancesView({ ledger, update }: BalancesViewProps) {
  const [month, setMonth] = useState(currentMonth);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errorEntityId, setErrorEntityId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showBaselines, setShowBaselines] = useState(false);
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

  return (
    <>
      <header className="page-heading">
        <h1>Balances</h1>
        <button className="primary" onClick={() => setMonth(currentMonth())} type="button">Current month</button>
      </header>
      <div className="filters">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} />
        </label>
      </div>
      <section className="summary-strip" aria-label="Monthly spending">
        <div><span className="metric-label">Personal spend</span><strong className="amount">{formatMoney(monthly.personalCents)}</strong></div>
        <div><span className="metric-label">House spend</span><strong className="amount">{formatMoney(monthly.houseCents)}</strong></div>
      </section>

      <h2>By category</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Category</th><th>Personal</th><th>House</th></tr></thead>
          <tbody>
            {categoryRows.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td className="amount">{formatMoney(category.personalCents)}</td>
                <td className="amount">{formatMoney(category.houseCents)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Total</th>
              <td className="amount">{formatMoney(monthly.personalCents)}</td>
              <td className="amount">{formatMoney(monthly.houseCents)}</td>
            </tr>
          </tbody>
        </table>
        {categoryRows.length === 0 && <p className="empty-state compact">No spending for this month.</p>}
      </div>

      <section className="section-heading">
        <h2>Balances</h2>
        <button className="secondary" onClick={() => setShowBaselines((visible) => !visible)} type="button">{showBaselines ? "Hide opening balances" : "Edit opening balances"}</button>
      </section>
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Entity</th><th>Balance</th>{showBaselines && <th>Opening balance</th>}</tr></thead>
          <tbody>
            {entities.map((entity) => {
              const amount = overall.byEntity[entity.id] ?? 0;
              const baseline = baselineFor(entity.id);
              return (
                <tr key={entity.id}>
                  <td>{entity.name}</td>
                  <td className={amount > 0 ? "amount positive" : amount < 0 ? "amount negative" : "muted"}>{amount > 0 ? `${entity.name} owes you ${formatMoney(amount)}` : amount < 0 ? `You owe ${entity.name} ${formatMoney(Math.abs(amount))}` : "Settled"}</td>
                  {showBaselines && <td>
                    <label>
                      <span className="sr-only">Opening balance for {entity.name}</span>
                      <input
                        inputMode="decimal"
                        value={drafts[entity.id] ?? (baseline && baseline.amountCents !== 0 ? centsText(baseline.amountCents) : "")}
                        onChange={(event) => { setDrafts((current) => ({ ...current, [entity.id]: event.target.value })); if (errorEntityId === entity.id) { setErrorEntityId(null); setError(""); } }}
                        onBlur={() => { if (entity.id in drafts) saveBaseline(entity.id); }}
                        aria-invalid={errorEntityId === entity.id}
                      />
                    </label>
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {overall.betweenEntities.length > 0 && <>
      <h2>Between others</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Debtor</th><th>Creditor</th><th>Amount</th></tr></thead>
          <tbody>
            {overall.betweenEntities.map((debt) => (
              <tr key={`${debt.debtorId}-${debt.creditorId}`}>
                <td>{ledger.entities.find((entity) => entity.id === debt.debtorId)?.name ?? "Unknown"}</td>
                <td>{ledger.entities.find((entity) => entity.id === debt.creditorId)?.name ?? "Unknown"}</td>
                <td className="amount">{formatMoney(debt.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </>
  );
}