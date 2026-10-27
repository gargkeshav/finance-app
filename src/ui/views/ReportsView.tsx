import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { accountCoverage, type Ledger } from "../../domain/ledger";
import type { EntryFilter } from "../../domain/query";
import { byCategory, byNature, cashFlow, monthly, topMerchants, type ReportScope } from "../../domain/reports";
import { formatMoney } from "../../domain/value";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ReportTable = "Monthly" | "Categories" | "By nature" | "Merchants" | "Cash flow";

interface ReportsViewProps {
  ledger: Ledger;
  openActivity: (filter?: EntryFilter) => void;
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthDate(month: string): string {
  return `${month}-01`;
}

function defaultRange(ledger: Ledger): { from: string; to: string } {
  const today = new Date();
  const earliestAllowed = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const firstEntryMonth = ledger.entries
    .filter((entry) => entry.kind === "spend" || entry.kind === "refund" || entry.kind === "income")
    .map((entry) => entry.date.slice(0, 7))
    .filter((month) => month <= currentMonth)
    .sort()[0];
  const earliestAllowedMonth = `${earliestAllowed.getFullYear()}-${String(earliestAllowed.getMonth() + 1).padStart(2, "0")}`;
  const firstMonth = firstEntryMonth && firstEntryMonth > earliestAllowedMonth ? firstEntryMonth : earliestAllowedMonth;
  return { from: monthDate(firstEntryMonth ? firstMonth : currentMonth), to: localDate(today) };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvMoney(cents: number): string {
  const absolute = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
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

const reportChartConfig = {
  spendingCents: { label: "Spending", color: "var(--chart-1)" },
  refundsCents: { label: "Refunds", color: "var(--chart-2)" },
  netCents: { label: "Net", color: "var(--chart-3)" },
  totalCents: { label: "Total", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ReportsView({ ledger, openActivity }: ReportsViewProps) {
  const initialRange = defaultRange(ledger);
  const [scope, setScope] = useState<ReportScope>("personal");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [table, setTable] = useState<ReportTable>("Monthly");
  const [showEmptyMonths, setShowEmptyMonths] = useState(false);
  const rangeIsValid = from <= to;
  const monthFrom = from.slice(0, 7);
  const monthTo = to.slice(0, 7);
  const monthlyRows = rangeIsValid
    ? monthly(ledger, scope, monthCountToCurrent(from)).filter((row) => row.month >= monthFrom && row.month <= monthTo)
    : [];
  const hasMonthlyActivity = (row: typeof monthlyRows[number]) =>
    row.spendingCents !== 0 || row.refundsCents !== 0 || row.netCents !== 0;
  const visibleMonthlyRows = showEmptyMonths ? monthlyRows : monthlyRows.filter(hasMonthlyActivity);
  const categoryReport = rangeIsValid ? byCategory(ledger, scope, from, to) : { months: [], rows: [], columnTotals: {}, totalCents: 0 };
  const visibleMonths = showEmptyMonths
    ? categoryReport.months
    : categoryReport.months.filter((month) => monthlyRows.some((row) => row.month === month && hasMonthlyActivity(row)));
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
      <button className="font-medium tabular-nums hover:underline" aria-label={`${label}: ${formatMoney(amount)}`} onClick={() => openActivity(filter)} type="button">
        {formatMoney(amount)}
      </button>
    );
  }

  function exportCurrentTable() {
    if (table === "Monthly") {
      downloadCsv(table, [
        ["Month", "Spending", "Refunds", "Net", "Data"],
        ...visibleMonthlyRows.map((row) => [row.month, csvMoney(row.spendingCents), csvMoney(row.refundsCents), csvMoney(row.netCents), partialMonth(row.month) ? "Partial data" : ""]),
      ]);
    } else if (table === "Categories") {
      downloadCsv(table, [
        ["Category", ...visibleMonths, "Total"],
        ...categoryReport.rows.map((row) => [row.categoryName, ...visibleMonths.map((month) => csvMoney(row.byMonth[month])), csvMoney(row.totalCents)]),
        ["Total", ...visibleMonths.map((month) => csvMoney(categoryReport.columnTotals[month] ?? 0)), csvMoney(categoryReport.totalCents)],
      ]);
    } else if (table === "Merchants") {
      downloadCsv(table, [["Merchant", "Net"], ...merchantRows.map((row) => [row.merchant, csvMoney(row.totalCents)])]);
    } else if (table === "By nature") {
      downloadCsv(table, [["Nature", "Total"], ...natureRows.map((row) => [row.nature, csvMoney(row.totalCents)])]);
    } else {
      downloadCsv(table, [
        ["Type", "In", "Out"],
        ...([
          ["Income", cashFlowReport.income],
          ["Transfers", cashFlowReport.transfers],
          ["Settlements", cashFlowReport.settlements],
        ] as const).map(([label, row]) => [label, csvMoney(row.inCents), csvMoney(row.outCents)]),
      ]);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Reports</h1>
        <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={exportCurrentTable} type="button">Download CSV</button>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="flex flex-wrap gap-3">
          <legend className="mb-2 font-medium">Scope</legend>
          <label className="flex items-center gap-2"><input checked={scope === "personal"} name="report-scope" onChange={() => setScope("personal")} type="radio" /> Personal (incl. ½ House)</label>
          <label className="flex items-center gap-2"><input checked={scope === "household"} name="report-scope" onChange={() => setScope("household")} type="radio" /> Household</label>
        </fieldset>
        <label className="grid gap-1">From <input aria-label="Report start date" className="rounded-md border bg-background px-3 py-2" onChange={(event) => setFrom(event.target.value)} type="date" value={from} /></label>
        <label className="grid gap-1">To <input aria-label="Report end date" className="rounded-md border bg-background px-3 py-2" onChange={(event) => setTo(event.target.value)} type="date" value={to} /></label>
        <label className="flex items-center gap-2 pb-2">
          <Switch checked={showEmptyMonths} onCheckedChange={setShowEmptyMonths} />
          Show empty months
        </label>
      </div>
      {!rangeIsValid && <p className="text-sm text-destructive" role="status">Start date must be on or before end date.</p>}
      <Tabs onValueChange={(value) => setTable(value as ReportTable)} value={table}>
        <TabsList aria-label="Report tables" className="flex h-auto flex-wrap bg-background text-foreground">
          {(["Monthly", "Categories", "By nature", "Merchants", "Cash flow"] as const).map((name) => (
            <TabsTrigger key={name} value={name}>{name}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="Monthly" className="space-y-4">
          <ChartContainer aria-label="Monthly spending, refunds, and net" className="h-72 w-full" config={reportChartConfig} role="img">
            <BarChart accessibilityLayer data={visibleMonthlyRows} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis axisLine={false} dataKey="month" tickLine={false} />
              <YAxis axisLine={false} tickFormatter={(value: number) => formatMoney(value)} tickLine={false} width={90} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatMoney(Number(value))} />} />
              <Bar dataKey="spendingCents" fill="var(--color-spendingCents)" radius={4} />
              <Bar dataKey="refundsCents" fill="var(--color-refundsCents)" radius={4} />
              <Bar dataKey="netCents" fill="var(--color-netCents)" radius={4} />
            </BarChart>
          </ChartContainer>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm [&_th]:!text-foreground">
              <thead className="text-foreground"><tr><th>Month</th><th>Spending</th><th>Refunds</th><th>Net</th><th>Coverage</th></tr></thead>
              <tbody>
                {visibleMonthlyRows.map((row) => {
                  const monthRange = rangeForMonth(row.month, from, to);
                  return (
                    <tr key={row.month}>
                      <th scope="row">{row.month}</th>
                      <td>{amountButton(row.spendingCents, `${row.month} spending`, { ...monthRange, entryIds: row.spendingEntryIds })}</td>
                      <td>{amountButton(row.refundsCents, `${row.month} refunds`, { ...monthRange, entryIds: row.refundEntryIds })}</td>
                      <td>{amountButton(row.netCents, `${row.month} net`, { ...monthRange, entryIds: row.entryIds })}</td>
                      <td>
                        {partialMonth(row.month) && <TooltipProvider><Tooltip><TooltipTrigger><Badge variant="outline">Partial data</Badge></TooltipTrigger><TooltipContent>Some account activity for this month may not have been imported.</TooltipContent></Tooltip></TooltipProvider>}
                      </td>
                    </tr>
                  );
                })}
                {!visibleMonthlyRows.length && <tr><td colSpan={5}>No report data for this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="Categories" className="space-y-4">
          <ChartContainer aria-label="Spending by category" className="h-80 w-full" config={reportChartConfig} role="img">
            <BarChart accessibilityLayer data={categoryReport.rows} layout="vertical" margin={{ left: 12, right: 24 }}>
              <CartesianGrid horizontal={false} />
              <XAxis axisLine={false} tickFormatter={(value: number) => formatMoney(value)} tickLine={false} type="number" />
              <YAxis axisLine={false} dataKey="categoryName" tickLine={false} type="category" width={120} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatMoney(Number(value))} />} />
              <Bar dataKey="totalCents" fill="var(--color-totalCents)" radius={4} />
            </BarChart>
          </ChartContainer>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm [&_th]:!text-foreground">
              <thead className="text-foreground"><tr><th>Category</th>{visibleMonths.map((month) => <th key={month}>{month}</th>)}<th>Total</th></tr></thead>
              <tbody>
                {categoryReport.rows.map((row) => (
                  <tr key={row.categoryId ?? "uncategorized"}>
                    <th scope="row">{row.categoryName}</th>
                    {visibleMonths.map((month) => (
                      <td key={month}>{amountButton(row.byMonth[month], `${row.categoryName}, ${month}`, { ...rangeForMonth(month, from, to), categoryId: row.categoryId ?? undefined, entryIds: row.monthEntryIds[month] })}</td>
                    ))}
                    <td>{amountButton(row.totalCents, `${row.categoryName} total`, { ...rangeFilter(from, to), categoryId: row.categoryId ?? undefined, entryIds: row.entryIds })}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Total</th>
                  {visibleMonths.map((month) => <td key={month}>{amountButton(categoryReport.columnTotals[month] ?? 0, `${month} total`, { ...rangeForMonth(month, from, to), entryIds: categoryReport.rows.flatMap((row) => row.monthEntryIds[month]) })}</td>)}
                  <td>{amountButton(categoryReport.totalCents, "Category report total", { ...rangeFilter(from, to), entryIds: categoryReport.rows.flatMap((row) => row.entryIds) })}</td>
                </tr>
                {!categoryReport.rows.length && <tr><td colSpan={visibleMonths.length + 2}>No report data for this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="By nature">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm [&_th]:!text-foreground">
              <thead className="text-foreground"><tr><th>Nature</th><th>Total</th></tr></thead>
              <tbody>
                {natureRows.map((row) => (
                  <tr key={row.nature}>
                    <th scope="row">
                      {row.entryIds.length
                        ? <button className="text-primary underline" onClick={() => openActivity({ ...rangeFilter(from, to), entryIds: row.entryIds })} type="button">{row.nature === "unspecified" ? "Unspecified" : row.nature}</button>
                        : row.nature === "unspecified" ? "Unspecified" : row.nature}
                    </th>
                    <td>{formatMoney(row.totalCents)}</td>
                  </tr>
                ))}
                {!natureRows.length && <tr><td colSpan={2}>No report data for this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="Merchants">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm [&_th]:!text-foreground">
              <thead className="text-foreground"><tr><th>Merchant</th><th>Net</th></tr></thead>
              <tbody>
                {merchantRows.map((row) => <tr key={row.merchant}><th scope="row">{row.merchant}</th><td>{amountButton(row.totalCents, `${row.merchant} total`, { ...rangeFilter(from, to), entryIds: row.entryIds })}</td></tr>)}
                {!merchantRows.length && <tr><td colSpan={2}>No report data for this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="Cash flow">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm [&_th]:!text-foreground">
              <thead className="text-foreground"><tr><th>Type</th><th>In</th><th>Out</th></tr></thead>
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
        </TabsContent>
      </Tabs>
    </section>
  );
}

function rangeFilter(from: string, to: string): EntryFilter {
  return { from, to };
}
