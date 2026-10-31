import { Fragment } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { balances, debtsOf, openItems, SELF_ENTITY_ID, settlementCoverage, settlementEffectCents, settlementsForEntry, type Entry, type Ledger, type Settlement } from "../../domain/ledger";
import { SettlementDetail, countLabel, differenceText } from "./SettlementDetail";
import { formatMoney, sumCents } from "../../domain/value";
import type { EntryFilter } from "../../domain/query";

interface EntityViewProps {
  ledger: Ledger;
  update: (next: Ledger, undoLabel?: string) => void;
  entityId: string;
  openActivity: (filter: EntryFilter) => void;
  onSettle: () => void;
  onBack: () => void;
}

interface TimelineItem {
  id: string;
  date: string;
  label: string;
  amountCents: number;
  entry?: Entry;
  settled?: boolean;
  settlement?: Settlement;
  balanceEffectCents?: number;
  paidOn?: string;
}

function settlementCredit(ledger: Ledger, entityId: string, settlement: Settlement): number {
  const all = ledger.settlements ?? [];
  const position = all.indexOf(settlement);
  const priorSettlements = all.filter((item, index) =>
    item.date < settlement.date || item.date === settlement.date && index < position,
  );
  const prior = { ...ledger, settlements: priorSettlements };
  const open = openItems(prior, entityId);
  const relevant = settlement.direction === "theyPaidYou" ? open.theyOweYou : open.youOweThem;
  const outstandingCents = sumCents(relevant.map((item) => item.openAmountCents));
  return Math.max(0, settlement.amountCents - outstandingCents);
}

export function EntityView({ ledger, update, entityId, openActivity, onSettle, onBack }: EntityViewProps) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const entity = ledger.entities.find((item) => item.id === entityId);
  if (!entity) {
    return <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Entity not found</h1>
        <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={onBack} type="button">Back</button>
      </header>
    </>;
  }

  const balanceCents = balances(ledger).byEntity[entityId] ?? 0;
  const paidOn = (entryId: string) => settlementsForEntry(ledger, entryId).find((settlement) => settlement.entityId === entityId)?.date;
  const baselineCents = sumCents(ledger.baselines
    .filter((baseline) => baseline.entityId === entityId)
    .map((baseline) => baseline.amountCents));
  const entityOpen = openItems(ledger, entityId);
  const openIds = new Set([...entityOpen.theyOweYou, ...entityOpen.youOweThem]
    .filter((item) => item.source === "entry")
    .map((item) => item.id));
  const items: TimelineItem[] = [{
    id: `opening-${entityId}`,
    date: "",
    label: "Opening balance",
    amountCents: baselineCents,
  }];

  for (const entry of ledger.entries) {
    for (const debt of debtsOf(entry, ledger.bankRows ?? [])) {
      if (debt.debtorId === entityId && debt.creditorId === SELF_ENTITY_ID) {
        items.push({ id: `entry-${entry.id}`, date: entry.date, label: entry.displayName || entry.description || entry.kind, amountCents: debt.amountCents, entry, settled: !openIds.has(entry.id), paidOn: paidOn(entry.id) });
      } else if (debt.debtorId === SELF_ENTITY_ID && debt.creditorId === entityId) {
        items.push({ id: `entry-${entry.id}`, date: entry.date, label: entry.displayName || entry.description || entry.kind, amountCents: -debt.amountCents, entry, settled: !openIds.has(entry.id), paidOn: paidOn(entry.id) });
      }
    }
  }

  if (showHistory) {
    for (const entry of ledger.entries) {
      if (entry.countsTowardDebt || (entry.kind !== "spend" && entry.kind !== "refund")) continue;
      const sign = entry.kind === "refund" ? -1 : 1;
      const theirs = entry.payerEntityId === SELF_ENTITY_ID
        ? sumCents(entry.portions.filter((portion) => portion.entityId === entityId && (portion.treatment ?? "claim") === "claim").map((portion) => portion.amountCents))
        : entry.payerEntityId === entityId
          ? -sumCents(entry.portions.filter((portion) => portion.entityId === SELF_ENTITY_ID && (portion.treatment ?? "claim") === "claim").map((portion) => portion.amountCents))
          : 0;
      if (!theirs) continue;
      items.push({ id: `history-${entry.id}`, date: entry.date, label: entry.displayName || entry.description || entry.kind, amountCents: sign * theirs, balanceEffectCents: 0, entry, settled: true, paidOn: paidOn(entry.id) });
    }
  }

  for (const settlement of ledger.settlements ?? []) {
    if (settlement.entityId !== entityId || settlement.paidToEntityId) continue;
    const creditCents = settlement.remainder === "writeOff" ? 0 : settlementCredit(ledger, entityId, settlement);
    const sign = settlement.direction === "theyPaidYou" ? -1 : 1;
    const coverage = settlementCoverage(ledger, settlement);
    const covered = coverage.lines.length || coverage.items.length
      ? ` · ${coverage.lines.length ? countLabel(coverage.lines.length, "line") : countLabel(coverage.items.length, "item")}, ${differenceText(coverage.differenceCents, settlement.remainder, coverage.lines.length ? "the lines" : "the items").toLowerCase()}`
      : "";
    items.push({
      id: `settlement-${settlement.id}`,
      date: settlement.date,
      label: `${settlement.direction === "theyPaidYou" ? `${entity.name} paid you` : `You paid ${entity.name}`}${creditCents > 0 ? ` · includes ${formatMoney(creditCents)} credit` : ""}${covered}`,
      amountCents: sign * settlement.amountCents,
      balanceEffectCents: sign * settlementEffectCents(ledger, settlement),
      settlement,
    });
  }

  items.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
  let runningBalanceCents = 0;
  const rows = items.map((item) => {
    runningBalanceCents += item.balanceEffectCents ?? item.amountCents;
    return { ...item, runningBalanceCents };
  });
  const treatedPortions = ledger.entries.flatMap((entry) => entry.portions.flatMap((portion, portionIndex) => {
    if (portion.entityId !== entityId || (portion.treatment !== "writeOff" && portion.treatment !== "gift")) return [];
    const asClaim: Entry = {
      ...entry,
      portions: entry.portions.map((candidate, index) => index === portionIndex
        ? { ...candidate, treatment: "claim" }
        : candidate),
    };
    const debt = debtsOf(asClaim, ledger.bankRows ?? []).find((candidate) =>
      candidate.debtorId === portion.entityId && candidate.creditorId === entry.payerEntityId,
    );
    return [{ entry, portionIndex, portion, debt }];
  }));

  function startClaiming(entryId: string, portionIndex: number) {
    update({
      ...ledger,
      entries: ledger.entries.map((entry) => entry.id !== entryId ? entry : {
        ...entry,
        portions: entry.portions.map((portion, index) => index === portionIndex
          ? { ...portion, treatment: undefined }
          : portion),
      }),
    }, "Start claiming write-off");
  }
  function toggleArchived() {
    const currentEntity = ledger.entities.find((item) => item.id === entityId);
    update({
      ...ledger,
      entities: ledger.entities.map((item) => item.id === entityId
        ? { ...item, archived: !item.archived, updatedAt: new Date().toISOString() }
        : item),
    }, currentEntity?.archived ? `Restore ${currentEntity.name}` : `Archive ${currentEntity?.name ?? "entity"}`);
    setConfirmArchive(false);
  }
  const canArchive = entity.kind !== "self" && entity.kind !== "house";
  const balanceText = balanceCents > 0
    ? `${entity.name} owes you ${formatMoney(balanceCents)}`
    : balanceCents < 0
      ? `You owe ${entity.name} ${formatMoney(Math.abs(balanceCents))}`
      : "Settled";

  return <>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <button className="text-sm underline-offset-4 hover:underline" onClick={onBack} type="button">Back</button>
        <h1>{entity.name}</h1>
        <p className={balanceCents > 0 ? "text-right tabular-nums text-positive" : balanceCents < 0 ? "text-right tabular-nums text-negative" : "text-muted-foreground"}>{balanceText}</p>
      </div>
      <div className="flex items-center gap-2">
        {canArchive && <Button variant="outline" onClick={() => setConfirmArchive(true)} type="button">{entity.archived ? "Restore" : "Archive"}</Button>}
        <Button onClick={onSettle} type="button">Settle up</Button>
      </div>
    </header>
    <label className="flex w-fit items-center gap-2 text-sm">
      <input checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} type="checkbox" />
      Show settled history (items already paid before tracking; they don't change the balance)
    </label>
    <div className="min-w-0 max-w-full overflow-x-auto">
      <Table tabIndex={0}>
        <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Date</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Activity</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Amount</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Status</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Balance</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((row) => {
            const entryId = row.entry?.id;
            const expanded = row.settlement && expandedId === row.settlement.id;
            return <Fragment key={row.id}>
              <TableRow>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{row.date || "Opening"}</TableCell>
                <TableCell>{entryId
                  ? <Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => openActivity({ entryIds: [entryId] })} type="button">{row.label}</Button>
                  : row.settlement
                    ? <Button variant="link" className="h-auto whitespace-normal p-0 text-left" aria-expanded={Boolean(expanded)} onClick={() => setExpandedId(expanded ? null : row.settlement!.id)} type="button">{row.label}</Button>
                    : row.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.amountCents)}</TableCell>
                <TableCell>{row.entry ? row.settled ? row.paidOn ? `Paid ${row.paidOn}` : row.balanceEffectCents === 0 ? "Settled earlier" : "Settled" : "Open" : row.settlement ? row.balanceEffectCents === 0 ? "History" : "Payment" : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.runningBalanceCents)}</TableCell>
              </TableRow>
              {expanded && row.settlement && <TableRow><TableCell colSpan={5}><SettlementDetail ledger={ledger} settlement={row.settlement} /></TableCell></TableRow>}
            </Fragment>;
          })}
        </TableBody>
      </Table>
    </div>
    <section>
      <h2>Written off and gifted</h2>
      {treatedPortions.length === 0
        ? <p className="text-sm text-muted-foreground p-4">No written-off or gifted portions.</p>
        : <div className="w-full min-w-0 overflow-x-auto">
          <table>
            <thead><tr><th>Date</th><th>Activity</th><th>Treatment</th><th>Would-be debt</th><th>Action</th></tr></thead>
            <tbody>
              {treatedPortions.map(({ entry, portionIndex, portion, debt }) => {
                const debtorId = debt && (debt.amountCents < 0 ? debt.creditorId : debt.debtorId);
                const creditorId = debt && (debt.amountCents < 0 ? debt.debtorId : debt.creditorId);
                const debtorName = ledger.entities.find((item) => item.id === debtorId)?.name ?? "Unknown";
                const creditorName = ledger.entities.find((item) => item.id === creditorId)?.name ?? "Unknown";
                return <tr key={`${entry.id}-${portionIndex}`}>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{entry.date}</td>
                  <td><button className="transaction-link" onClick={() => openActivity({ entryIds: [entry.id] })} type="button">{entry.description || entry.kind}</button></td>
                  <td>{portion.treatment === "writeOff" ? "Write off" : "Gift"}</td>
                  <td>{debt
                    ? `${debtorName} owes ${creditorName} ${formatMoney(Math.abs(debt.amountCents))}`
                    : "No debt would be created"}</td>
                  <td>{portion.treatment === "writeOff" && <button className="text-sm underline-offset-4 hover:underline" onClick={() => startClaiming(entry.id, portionIndex)} type="button">Start claiming</button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
    </section>
    <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{entity.archived ? "Restore this entity?" : "Archive this entity?"}</AlertDialogTitle>
          <AlertDialogDescription>{entity.archived ? `Restore ${entity.name} to the active entity list.` : `Archive ${entity.name}. Existing balances and history will be kept.`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={toggleArchived}>{entity.archived ? "Restore" : "Archive"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
import { useState } from "react";
