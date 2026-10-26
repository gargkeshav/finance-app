import { accountCoverage, balances, report, type Ledger } from "../../domain/ledger";
import type { EntryFilter } from "../../domain/query";
import type { HealthIssue } from "../../domain/health";
import { formatMoney, sumCents } from "../../domain/value";

type HomeViewName = "Home" | "Review" | "Activity" | "Settle" | "Reports" | "Balances" | "Import" | "Health" | "Accounts" | "People" | "Rules" | "Data" | "History";

interface HomeViewProps {
  ledger: Ledger;
  healthIssues: HealthIssue[];
  reviewCount: number;
  openActivity: (filter?: EntryFilter) => void;
  onOpenEntity: (entityId: string) => void;
  onNavigate: (view: HomeViewName) => void;
}

function dateString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function HomeView({ ledger, healthIssues, reviewCount, openActivity, onOpenEntity, onNavigate }: HomeViewProps) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentStart = dateString(year, month, 1);
  const currentEnd = dateString(year, month, new Date(year, month + 1, 0).getDate());
  const previousMonth = new Date(year, month - 1, 1);
  const previousStart = dateString(previousMonth.getFullYear(), previousMonth.getMonth(), 1);
  const previousEnd = dateString(year, month, 0);
  const currentReport = report(ledger.entries, currentStart, currentEnd);
  const previousReport = report(ledger.entries, previousStart, previousEnd);
  const entityBalances = balances(ledger).byEntity;
  const nonzeroEntities = ledger.entities
    .filter((entity) => entity.kind !== "self" && (entityBalances[entity.id] ?? 0) !== 0)
    .map((entity) => ({ entity, amount: entityBalances[entity.id] ?? 0 }));
  const owedToYou = sumCents(nonzeroEntities.filter(({ amount }) => amount > 0).map(({ amount }) => amount));
  const youOwe = sumCents(nonzeroEntities.filter(({ amount }) => amount < 0).map(({ amount }) => -amount));
  const coverage = ledger.accounts.map((account) => ({
    account,
    coverage: accountCoverage(ledger, account.id),
  }));
  const lastCoveredDate = coverage.flatMap(({ coverage: accountCoverageResult }) => accountCoverageResult.ranges)
    .map((range) => range.to)
    .sort()
    .at(-1);
  const gapCount = coverage.reduce((total, item) => total + item.coverage.gaps.length, 0);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentlyHandled = [...(ledger.history ?? [])]
    .filter((change) => change.actor !== "you" && Date.parse(change.at) >= cutoff)
    .sort((first, second) => second.at.localeCompare(first.at));

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Home</h1>
        </div>
        <button className="primary" onClick={() => openActivity()} type="button">Open Activity</button>
      </header>

      <section aria-labelledby="net-position-heading">
        <h2 id="net-position-heading">Net position</h2>
        <div className="summary-strip">
          <div><span className="metric-label">Owed to you</span><strong className="amount">{formatMoney(owedToYou)}</strong></div>
          <div><span className="metric-label">You owe</span><strong className="amount">{formatMoney(youOwe)}</strong></div>
        </div>
        {nonzeroEntities.length > 0 && <div className="table-scroll">
          <table>
            <thead><tr><th>Entity</th><th>Position</th><th>Balance</th></tr></thead>
            <tbody>{nonzeroEntities.map(({ entity, amount }) => (
              <tr key={entity.id}>
                <td><button className="drilldown-button" onClick={() => onOpenEntity(entity.id)} type="button">{entity.name}</button></td>
                <td>{amount > 0 ? "Owed to you" : "You owe"}</td>
                <td className="amount">{formatMoney(Math.abs(amount))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </section>

      <section aria-labelledby="month-heading">
        <h2 id="month-heading">This month</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th><th>Personal</th><th>House</th></tr></thead>
            <tbody>
              <tr><th scope="row">{today.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</th><td className="amount">{formatMoney(currentReport.personalCents)}</td><td className="amount">{formatMoney(currentReport.houseCents)}</td></tr>
              <tr><th scope="row">{previousMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</th><td className="amount">{formatMoney(previousReport.personalCents)}</td><td className="amount">{formatMoney(previousReport.houseCents)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="todo-heading">
        <h2 id="todo-heading">To do</h2>
        {reviewCount > 0 && <button className="drilldown-button" onClick={() => onNavigate("Review")} type="button">Waiting in review · {reviewCount}</button>}
        {healthIssues.map((issue, index) => (
          <button className="drilldown-button" key={`${issue.kind}-${index}`} onClick={() => onNavigate(issue.view)} type="button">
            {issue.kind} · {issue.count}: {issue.detail}
          </button>
        ))}
        {reviewCount === 0 && healthIssues.length === 0 && <p className="empty-state compact">Nothing needs attention right now.</p>}
      </section>

      {recentlyHandled.length > 0 && <section aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recently handled</h2>
        {recentlyHandled.map((change) => (
          <button className="drilldown-button" key={change.id} onClick={() => onNavigate("History")} type="button">
            {change.reason} · {change.actor} · {new Date(change.at).toLocaleString()}
          </button>
        ))}
      </section>}

      {ledger.accounts.length === 0 ? (
        <section className="card" aria-label="Getting started">
          <h2>Getting started</h2>
          <ol className="steps">
            <li className={ledger.accounts.length > 0 ? "done" : ""}>Add your bank accounts <button className="text-button" onClick={() => onNavigate("Accounts")} type="button">Open Accounts</button></li>
            <li className={ledger.entities.some((entity) => entity.kind === "person" || entity.kind === "group") ? "done" : ""}>Add people and groups you share costs with <button className="text-button" onClick={() => onNavigate("People")} type="button">Open People</button></li>
            <li className={(ledger.bankRows ?? []).length > 0 ? "done" : ""}>Import a CSV from your bank <button className="text-button" onClick={() => onNavigate("Import")} type="button">Open Import</button></li>
            <li className={(ledger.bankRows ?? []).length > 0 && reviewCount === 0 ? "done" : ""}>Review the imported rows <button className="text-button" onClick={() => onNavigate("Review")} type="button">Open Review</button></li>
          </ol>
        </section>
      ) : (
        <section aria-labelledby="accounts-heading">
          <h2 id="accounts-heading">Accounts</h2>
          <p>Last covered date: {lastCoveredDate ?? "No coverage yet"}</p>
          <p>Coverage gaps: {gapCount}</p>
          <button className="text-button" onClick={() => onNavigate("Import")} type="button">Open Import</button>
        </section>
      )}
    </>
  );
}