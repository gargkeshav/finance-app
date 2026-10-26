import { useState } from "react";
import { accountCoverage, type Ledger } from "../../domain/ledger";
import type { EntryFilter } from "../../domain/query";
import { byCategory, byNature, cashFlow, monthly, topMerchants, type ReportScope } from "../../domain/reports";
import { formatAud } from "../../domain/value";

type ReportTable = "Monthly" | "Categories" | "By nature" | "Merchants" | "Cash flow";

interface ReportsViewProps {
  ledger: Ledger;
  openActivity: (filter?: EntryFilter) => void;
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  return { from: localDate(firstDay), to: localDate(today) };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(table: ReportTable, rows: (string | number)[][]): void {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `reports-${table.toLowerCase().replace(/\s+/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function monthEnd(month: string): string {
  return `${month}-31`;
}

function rangeForMonth(month: string, from: string, to: string): { from: string; to: string } {
  return {
    from: from > monthStart(month) ? from : monthStart(month),
    to: to < monthEnd(month) ? to : monthEnd(month),
  };
}

function monthCountToCurrent(from: string): number {
  const now = new Date();
  const [fromYear, fromMonth] = from.slice(0, 7).split("-").map(Number);
  return Math.max(1, (now.getFullYear() - fromYear) * 12 + now.getMonth() + 1 - fromMonth + 1);
}

export function ReportsView({ ledger, openActivity }: ReportsViewProps) {
  const initialRange = defaultRange();
  const [scope, setScope] = useState<ReportScope>("personal");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [table, setTable] = useState<ReportTable>("Monthly");
  const rangeIsValid = from <= to;
  const monthFrom = from.slice(0, 7);
  const monthTo = to.slice(0, 7);
  const monthlyRows = rangeIsValid
    ? monthly(ledger, scope, monthCountToCurrent(from)).filter((row) => row.month >= monthFrom && row.month <= monthTo)
    : [];
  const categoryReport = rangeIsValid ? byCategory(ledger, scope, from, to) : { months: [], rows: [], columnTotals: {}, totalCents: 0 };
  const natureRows = rangeIsValid ? byNature(ledger, scope, from, to) : [];
  const merchantRows = rangeIsValid ? topMerchants(ledger, scope, from, to, 10) : [];
  const cashFlowReport = rangeIsValid
    ? cashFlow(ledger, from, to)
    : {
        income: { inCents: 0, outCents: 0, inEntryIds: [], outEntryIds: [] },
        transfers: { inCents: 0, outCents: 0, inEntryIds: [], outEntryIds: [] },
        settlements: { inCents: 0, outCents: 0, inEntryIds: [], outEntryIds: [] },
      };
  const partialMonth = (month: string) => {
    const fromDate = monthStart(month);
    const toDate = monthEnd(month);
    return ledger.accounts.some((account) => accountCoverage(ledger, account.id).gaps.some(
      (gap) => gap.from <= toDate && gap.to >= fromDate,
    ));
  };

  function amountButton(amount: number, label: string, filter: EntryFilter) {
    return (
      <button className="amount" aria-label={`${label}: ${formatAud(amount)}`} onClick={() => openActivity(filter)} type="button">
        {formatAud(amount)}
      </button>
    );
  }

  function exportCurrentTable() {
    if (table === "Monthly") {
      downloadCsv(table, [
        ["Month", "Spending", "Refunds", "Net", "Data"],
        ...monthlyRows.map((row) => [row.month, formatAud(row.spendingCents), formatAud(row.refundsCents), formatAud(row.netCents), partialMonth(row.month) ? "Partial data" : ""]),
      ]);
    } else if (table === "Categories") {
      downloadCsv(table, [
        ["Category", ...categoryReport.months, "Total"],
        ...categoryReport.rows.map((row) => [row.categoryName, ...categoryReport.months.map((month) => formatAud(row.byMonth[month])), formatAud(row.totalCents)]),
        ["Total", ...categoryReport.months.map((month) => formatAud(categoryReport.columnTotals[month])), formatAud(categoryReport.totalCents)],
      ]);
    } else if (table === "Merchants") {
      downloadCsv(table, [["Merchant", "Net"], ...merchantRows.map((row) => [row.merchant, formatAud(row.totalCents)])]);
    } else if (table === "By nature") {
      downloadCsv(table, [["Nature", "Total"], ...natureRows.map((row) => [row.nature, formatAud(row.totalCents)])]);
    } else {
      downloadCsv(table, [
        ["Type", "In", "Out"],
        ...([
          ["Income", cashFlowReport.income],
          ["Transfers", cashFlowReport.transfers],
          ["Settlements", cashFlowReport.settlements],
        ] as const).map(([label, row]) => [label, formatAud(row.inCents), formatAud(row.outCents)]),
      ]);
    }
  }

  return (
    <section>
      <header className="page-heading">
        <h1>Reports</h1>
        <button className="primary" onClick={exportCurrentTable} type="button">Download CSV</button>
      </header>
      <div className="filters">
        <fieldset>
          <legend>Scope</legend>
          <label><input checked={scope === "personal"} name="report-scope" onChange={() => setScope("personal")} type="radio" /> Personal</label>
          <label><input checked={scope === "household"} name="report-scope" onChange={() => setScope("household")} type="radio" /> Household</label>
        </fieldset>
        <label>From <input aria-label="Report start date" onChange={(event) => setFrom(event.target.value)} type="date" value={from} /></label>
        <label>To <input aria-label="Report end date" onChange={(event) => setTo(event.target.value)} type="date" value={to} /></label>
      </div>
      {!rangeIsValid && <p className="banner error" role="status">Start date must be on or before end date.</p>}
      <nav aria-label="Report tables" className="filters">
        {(["Monthly", "Categories", "By nature", "Merchants", "Cash flow"] as const).map((name) => (
          <button aria-pressed={table === name} className={table === name ? "primary" : "secondary"} key={name} onClick={() => setTable(name)} type="button">
            {name}
          </button>
        ))}
      </nav>
      {table === "Monthly" && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Month</th><th>Spending</th><th>Refunds</th><th>Net</th><th>Coverage</th></tr></thead>
            <tbody>
              {monthlyRows.map((row) => {
                const monthRange = rangeForMonth(row.month, from, to);
                return (
                  <tr key={row.month}>
                    <th scope="row">{row.month}</th>
                    <td>{amountButton(row.spendingCents, `${row.month} spending`, { ...monthRange, entryIds: row.spendingEntryIds })}</td>
                    <td>{amountButton(row.refundsCents, `${row.month} refunds`, { ...monthRange, entryIds: row.refundEntryIds })}</td>
                    <td>{amountButton(row.netCents, `${row.month} net`, { ...monthRange, entryIds: row.entryIds })}</td>
                    <td>{partialMonth(row.month) ? "Partial data" : ""}</td>
                  </tr>
                );
              })}
              {!monthlyRows.length && <tr><td colSpan={5}>No report data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {table === "Categories" && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Category</th>{categoryReport.months.map((month) => <th key={month}>{month}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {categoryReport.rows.map((row) => (
                <tr key={row.categoryId ?? "uncategorized"}>
                  <th scope="row">{row.categoryName}</th>
                  {categoryReport.months.map((month) => (
                    <td key={month}>{amountButton(row.byMonth[month], `${row.categoryName}, ${month}`, { ...rangeForMonth(month, from, to), categoryId: row.categoryId ?? undefined, entryIds: row.monthEntryIds[month] })}</td>
                  ))}
                  <td>{amountButton(row.totalCents, `${row.categoryName} total`, { ...rangeFilter(from, to), categoryId: row.categoryId ?? undefined, entryIds: row.entryIds })}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                {categoryReport.months.map((month) => <td key={month}>{amountButton(categoryReport.columnTotals[month], `${month} total`, { ...rangeForMonth(month, from, to), entryIds: categoryReport.rows.flatMap((row) => row.monthEntryIds[month]) })}</td>)}
                <td>{amountButton(categoryReport.totalCents, "Category report total", { ...rangeFilter(from, to), entryIds: categoryReport.rows.flatMap((row) => row.entryIds) })}</td>
              </tr>
              {!categoryReport.rows.length && <tr><td colSpan={categoryReport.months.length + 2}>No report data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {table === "Merchants" && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Merchant</th><th>Net</th></tr></thead>
            <tbody>
              {merchantRows.map((row) => <tr key={row.merchant}><th scope="row">{row.merchant}</th><td>{amountButton(row.totalCents, `${row.merchant} total`, { ...rangeFilter(from, to), entryIds: row.entryIds })}</td></tr>)}
              {!merchantRows.length && <tr><td colSpan={2}>No report data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {table === "By nature" && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nature</th><th>Total</th></tr></thead>
            <tbody>
              {natureRows.map((row) => (
                <tr key={row.nature}>
                  <th scope="row">
                    {row.entryIds.length
                      ? <button className="text-button" onClick={() => openActivity({ ...rangeFilter(from, to), entryIds: row.entryIds })} type="button">{row.nature === "unspecified" ? "Unspecified" : row.nature}</button>
                      : row.nature === "unspecified" ? "Unspecified" : row.nature}
                  </th>
                  <td className="amount">{formatAud(row.totalCents)}</td>
                </tr>
              ))}
              {!natureRows.length && <tr><td colSpan={2}>No report data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {table === "Cash flow" && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Type</th><th>In</th><th>Out</th></tr></thead>
            <tbody>
              {([
                ["Income", "income", cashFlowReport.income],
                ["Transfers", "transfers", cashFlowReport.transfers],
                ["Settlements", "settlements", cashFlowReport.settlements],
              ] as const).map(([label, key, row]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{amountButton(row.inCents, `${label} in`, { ...rangeFilter(from, to), ...(key === "settlements" ? {} : { entryIds: row.inEntryIds }) })}</td>
                  <td>{amountButton(row.outCents, `${label} out`, { ...rangeFilter(from, to), ...(key === "settlements" ? {} : { entryIds: row.outEntryIds }) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function rangeFilter(from: string, to: string): EntryFilter {
  return { from, to };
}