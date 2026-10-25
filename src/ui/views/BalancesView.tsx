import { useState } from "react";
import { balances, report, type Baseline, type Ledger } from "../../domain/ledger";
import { formatAud, parseAud } from "../../domain/value";

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
  const [from, to] = monthBounds(month);
  const monthly = report(ledger.entries, from, to);
  const overall = balances(ledger);
  const selfId = ledger.entities.find((entity) => entity.kind === "self")?.id;
  const entities = ledger.entities.filter((entity) => entity.id !== selfId);

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
        <div><span className="metric-label">Personal spend</span><strong className="amount">{formatAud(monthly.personalCents)}</strong></div>
        <div><span className="metric-label">House spend</span><strong className="amount">{formatAud(monthly.houseCents)}</strong></div>
      </section>

      <h2>Balances</h2>
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Entity</th><th>Balance</th><th>Opening balance</th></tr></thead>
          <tbody>
            {entities.map((entity) => {
              const amount = overall.byEntity[entity.id] ?? 0;
              const baseline = baselineFor(entity.id);
              return (
                <tr key={entity.id}>
                  <td>{entity.name}</td>
                  <td>{amount > 0 ? `Owes you ${formatAud(amount)}` : amount < 0 ? `You owe ${entity.name} ${formatAud(Math.abs(amount))}` : "Settled"}</td>
                  <td>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Between others</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Debtor</th><th>Creditor</th><th>Amount</th></tr></thead>
          <tbody>
            {overall.betweenEntities.map((debt) => (
              <tr key={`${debt.debtorId}-${debt.creditorId}`}>
                <td>{ledger.entities.find((entity) => entity.id === debt.debtorId)?.name ?? "Unknown"}</td>
                <td>{ledger.entities.find((entity) => entity.id === debt.creditorId)?.name ?? "Unknown"}</td>
                <td className="amount">{formatAud(debt.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {overall.betweenEntities.length === 0 && <p className="empty-state compact">No balances between others.</p>}
      </div>
    </>
  );
}