import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { settlementCoverage, type BankRow, type Ledger, type Settlement, type SettlementCoverageItem } from "../../domain/ledger";
import { formatMoney } from "../../domain/value";

const headClass = "!text-secondary-foreground !font-semibold";

export function differenceText(differenceCents: number, remainder: Settlement["remainder"], basis = "the items"): string {
  if (differenceCents === 0) return "Matches exactly";
  const size = formatMoney(Math.abs(differenceCents));
  const side = differenceCents > 0 ? `${size} more than` : `${size} less than`;
  return `Paid ${side} ${basis} · ${remainder === "writeOff" ? "written off" : differenceCents > 0 ? "kept as credit" : "still owed"}`;
}

export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function rowCount(count: number): string {
  return countLabel(count, "row");
}

function ItemRows({ items }: { items: SettlementCoverageItem[] }) {
  return (
    <>
      {items.map(({ entry, shareCents }) => (
        <TableRow key={entry.id}>
          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{entry.date}</TableCell>
          <TableCell className="whitespace-normal break-words">
            {entry.displayName || entry.description}
            {!entry.countsTowardDebt && <Badge className="ml-2" variant="outline">History</Badge>}
          </TableCell>
          <TableCell className="text-right tabular-nums">{formatMoney(shareCents)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** What a payment paid for: its bank rows, statement lines, linked items, and how far off the total is. */
export function SettlementDetail({ ledger, settlement }: { ledger: Ledger; settlement: Settlement }) {
  const coverage = settlementCoverage(ledger, settlement);
  const bankRows = settlement.bankRowIds
    .map((id) => (ledger.bankRows ?? []).find((row) => row.id === id))
    .filter((row): row is BankRow => Boolean(row));
  const accountName = (id: string) => ledger.accounts.find((account) => account.id === id)?.name ?? "Account";
  const lineEntryIds = new Set(coverage.lines.flatMap(({ items }) => items.map(({ entry }) => entry.id)));
  const looseItems = coverage.items.filter(({ entry }) => !lineEntryIds.has(entry.id));
  const statedCents = settlement.amountCents - coverage.differenceCents;

  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm" aria-label="What this payment covered">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Payment</dt>
        <dd className="tabular-nums">{formatMoney(settlement.amountCents)}</dd>
        <dt className="text-muted-foreground">{coverage.lines.length ? "Lines total" : "Items total"}</dt>
        <dd className="tabular-nums">{formatMoney(statedCents)}</dd>
        <dt className="text-muted-foreground">Difference</dt>
        <dd className={coverage.differenceCents === 0 ? "text-positive" : ""}>{differenceText(coverage.differenceCents, settlement.remainder, coverage.lines.length ? "the lines" : "the items")}</dd>
        <dt className="text-muted-foreground">Bank</dt>
        <dd>{bankRows.length
          ? bankRows.map((row) => `${row.date} · ${accountName(row.accountId)} · ${row.description} · ${formatMoney(Math.abs(row.amountCents))}`).join("; ")
          : "Not linked to a bank row"}</dd>
      </dl>
      {coverage.lines.length > 0 && (
        <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className={headClass}>Line</TableHead>
              <TableHead className={headClass}>Amount</TableHead>
              <TableHead className={headClass}>Source rows</TableHead>
              <TableHead className={headClass}>Note</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {coverage.lines.map(({ line, items, itemsCents }, index) => (
                <TableRow key={`${line.label}-${index}`}>
                  <TableCell>{line.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.amountCents)}</TableCell>
                  <TableCell className="tabular-nums">
                    {items.length ? `${rowCount(items.length)} · ${formatMoney(itemsCents)}` : "—"}
                    {items.length > 0 && itemsCents === line.amountCents && <Badge className="ml-2" variant="outline">Exact</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.note ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {coverage.lines.some(({ items }) => items.length) && (
        <details>
          <summary className="cursor-pointer">Show the {lineEntryIds.size} source rows</summary>
          {coverage.lines.filter(({ items }) => items.length).map(({ line, items }, index) => (
            <div className="mt-2" key={`${line.label}-rows-${index}`}>
              <p className="font-medium">{line.label}</p>
              <Table><TableBody><ItemRows items={items} /></TableBody></Table>
            </div>
          ))}
        </details>
      )}
      {looseItems.length > 0 && (
        <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <p className="font-medium">Items paid ({looseItems.length})</p>
          <Table><TableBody><ItemRows items={looseItems} /></TableBody></Table>
        </div>
      )}
      {!coverage.lines.length && !coverage.items.length && (
        <p className="text-muted-foreground">
          {settlement.remainder === "writeOff"
            ? "Recorded for reference; the items it paid are kept elsewhere (for example Splitwise)."
            : "Not linked to items, so it pays the oldest open items first."}
        </p>
      )}
    </div>
  );
}
