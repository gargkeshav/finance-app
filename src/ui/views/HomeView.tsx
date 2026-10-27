import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { accountCoverage, balances, report, type Ledger } from "../../domain/ledger";
import type { EntryFilter } from "../../domain/query";
import type { HealthIssue } from "../../domain/health";
import { formatMoney, sumCents } from "../../domain/value";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

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

const chartConfig = {
  personalCents: { label: "Personal (incl. ½ House)", color: "var(--chart-1)" },
  houseCents: { label: "House", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function HomeView({ ledger, healthIssues, reviewCount, openActivity, onOpenEntity, onNavigate }: HomeViewProps) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentStart = dateString(year, month, 1);
  const currentEnd = dateString(year, month, new Date(year, month + 1, 0).getDate());
  const currentReport = report(ledger.entries, currentStart, currentEnd);
  const entityBalances = balances(ledger).byEntity;
  const nonzeroEntities = ledger.entities
    .filter((entity) => entity.kind !== "self" && (entityBalances[entity.id] ?? 0) !== 0)
    .map((entity) => ({ entity, amount: entityBalances[entity.id] ?? 0 }));
  const balanceEntities = ledger.entities.map((entity) => ({ entity, amount: entityBalances[entity.id] ?? 0 }));
  const owedToYou = sumCents(nonzeroEntities.filter(({ amount }) => amount > 0).map(({ amount }) => amount));
  const youOwe = sumCents(nonzeroEntities.filter(({ amount }) => amount < 0).map(({ amount }) => -amount));
  const chartRows = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, month - 5 + index, 1);
    const start = dateString(date.getFullYear(), date.getMonth(), 1);
    const end = dateString(date.getFullYear(), date.getMonth(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
    const totals = report(ledger.entries, start, end);
    return {
      month: date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      personalCents: totals.personalCents,
      houseCents: totals.houseCents,
    };
  });
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
  const todoItems = [
    ...(reviewCount > 0 ? [{
      kind: "Review",
      count: reviewCount,
      detail: "Bank rows need your attention",
      view: "Review" as const,
    }] : []),
    ...healthIssues.map((issue) => ({
      kind: issue.kind,
      count: issue.count,
      detail: issue.detail,
      view: issue.view,
    })),
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-foreground">Overview</p>
          <h1>Home</h1>
        </div>
        <button className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 font-semibold text-background hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => openActivity()} type="button">Open Activity</button>
      </header>

      <section aria-label="Summary" className="space-y-3">
        <h2 className="text-xl font-semibold">Balances</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Owed to you</CardTitle></CardHeader>
          <CardContent><strong className={`text-2xl font-bold tabular-nums ${owedToYou > 0 ? "text-positive" : "text-foreground"}`}>{formatMoney(owedToYou)}</strong></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>You owe</CardTitle></CardHeader>
          <CardContent><strong className={`text-2xl font-bold tabular-nums ${youOwe > 0 ? "text-negative" : "text-foreground"}`}>{formatMoney(youOwe)}</strong></CardContent>
        </Card>
        </div>
        <h2 className="text-xl font-semibold">This month</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Personal (incl. ½ House)</CardTitle></CardHeader>
          <CardContent><strong className="text-2xl font-semibold tabular-nums">{formatMoney(currentReport.personalCents)}</strong></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>House spending</CardTitle></CardHeader>
          <CardContent><strong className="text-2xl font-semibold tabular-nums">{formatMoney(currentReport.houseCents)}</strong></CardContent>
        </Card>
        </div>
      </section>

      <section aria-labelledby="balance-heading" className="space-y-3">
        <h2 id="balance-heading" className="text-xl font-semibold">Entity balances</h2>
        {balanceEntities.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {balanceEntities.map(({ entity, amount }) => (
              <li key={entity.id}>
                <button className="flex w-full items-center justify-between rounded-lg border p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => onOpenEntity(entity.id)} type="button">
                  <span>{entity.name}</span>
                  <span className={`font-medium tabular-nums ${amount > 0 ? "text-positive" : amount < 0 ? "text-negative" : "text-foreground"}`}>{formatMoney(amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted-foreground">No entities yet.</p>}
      </section>

      <section aria-labelledby="trend-heading" className="space-y-3">
        <h2 id="trend-heading" className="text-xl font-semibold">Spending · last 6 months</h2>
        <ChartContainer aria-label="Personal and House spending for the last six months" className="h-72 w-full" config={chartConfig} role="img">
          <BarChart accessibilityLayer data={chartRows} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis axisLine={false} dataKey="month" tickLine={false} />
            <YAxis axisLine={false} tickFormatter={(value: number) => formatMoney(value)} tickLine={false} width={90} />
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatMoney(Number(value))} />} />
            <Bar dataKey="personalCents" fill="var(--color-personalCents)" radius={4} />
            <Bar dataKey="houseCents" fill="var(--color-houseCents)" radius={4} />
          </BarChart>
        </ChartContainer>
      </section>

      <section aria-labelledby="todo-heading" className="space-y-3">
        <h2 id="todo-heading" className="text-xl font-semibold">To do</h2>
        {todoItems.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {todoItems.map((item, index) => (
              <li className="flex flex-wrap items-center gap-3 p-4" key={`${item.kind}-${index}`}>
                <span className="font-medium">{item.kind}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-sm tabular-nums">{item.count}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">{item.detail}</span>
                <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => onNavigate(item.view)} type="button">Open {item.view}</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-foreground">Nothing needs attention right now.</p>}
      </section>

      {recentlyHandled.length > 0 && <section aria-labelledby="recent-heading" className="space-y-3">
        <h2 id="recent-heading" className="text-xl font-semibold">Recently handled</h2>
        <ul className="divide-y rounded-lg border">
          {recentlyHandled.map((change) => (
            <li key={change.id}>
              <button className="w-full p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => onNavigate("History")} type="button">
                {change.reason} · {change.actor} · {new Date(change.at).toLocaleString()}
              </button>
            </li>
          ))}
        </ul>
      </section>}

      {ledger.accounts.length === 0 ? (
        <Card aria-label="Getting started">
          <CardHeader><CardTitle>Getting started</CardTitle></CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-3 pl-5">
              <li>Add your bank accounts <button className="text-primary underline" onClick={() => onNavigate("Accounts")} type="button">Open Accounts</button></li>
              <li>Add people and groups you share costs with <button className="text-primary underline" onClick={() => onNavigate("People")} type="button">Open People</button></li>
              <li>Import a CSV from your bank <button className="text-primary underline" onClick={() => onNavigate("Import")} type="button">Open Import</button></li>
              <li>Review the imported rows <button className="text-primary underline" onClick={() => onNavigate("Review")} type="button">Open Review</button></li>
            </ol>
          </CardContent>
        </Card>
      ) : (
        <section aria-labelledby="accounts-heading" className="space-y-2">
          <h2 id="accounts-heading" className="text-xl font-semibold">Accounts</h2>
          <p>Last covered date: {lastCoveredDate ?? "No coverage yet"}</p>
          <p>Coverage gaps: {gapCount}</p>
          <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => onNavigate("Import")} type="button">Open Import</button>
        </section>
      )}
    </div>
  );
}
