import { balances, debtsOf, openEntryIds, SELF_ENTITY_ID, type Entry, type Ledger } from "../../domain/ledger";
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
}

export function EntityView({ ledger, update, entityId, openActivity, onSettle, onBack }: EntityViewProps) {
  const entity = ledger.entities.find((item) => item.id === entityId);
  if (!entity) {
    return <>
      <header className="page-heading">
        <h1>Entity not found</h1>
        <button className="secondary" onClick={onBack} type="button">Back</button>
      </header>
    </>;
  }

  const balanceCents = balances(ledger).byEntity[entityId] ?? 0;
  const baselineCents = sumCents(ledger.baselines
    .filter((baseline) => baseline.entityId === entityId)
    .map((baseline) => baseline.amountCents));
  const openIds = openEntryIds(ledger);
  const items: TimelineItem[] = [{
    id: `opening-${entityId}`,
    date: "",
    label: "Opening balance",
    amountCents: baselineCents,
  }];

  for (const entry of ledger.entries) {
    for (const debt of debtsOf(entry, ledger.bankRows ?? [])) {
      if (debt.debtorId === entityId && debt.creditorId === SELF_ENTITY_ID) {
        items.push({ id: `entry-${entry.id}`, date: entry.date, label: entry.description || entry.kind, amountCents: debt.amountCents, entry, settled: !openIds.has(entry.id) });
      } else if (debt.debtorId === SELF_ENTITY_ID && debt.creditorId === entityId) {
        items.push({ id: `entry-${entry.id}`, date: entry.date, label: entry.description || entry.kind, amountCents: -debt.amountCents, entry, settled: !openIds.has(entry.id) });
      }
    }
  }

  for (const settlement of ledger.settlements ?? []) {
    if (settlement.entityId !== entityId) continue;
    items.push({
      id: `settlement-${settlement.id}`,
      date: settlement.date,
      label: settlement.direction === "theyPaidYou" ? "They paid you" : "You paid them",
      amountCents: settlement.direction === "theyPaidYou" ? -settlement.amountCents : settlement.amountCents,
    });
  }

  items.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
  let runningBalanceCents = 0;
  const rows = items.map((item) => {
    runningBalanceCents += item.amountCents;
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
  const balanceText = balanceCents > 0
    ? `${entity.name} owes you ${formatMoney(balanceCents)}`
    : balanceCents < 0
      ? `You owe ${entity.name} ${formatMoney(Math.abs(balanceCents))}`
      : "Settled";

  return <>
    <header className="page-heading">
      <div>
        <button className="text-button" onClick={onBack} type="button">Back</button>
        <h1>{entity.name}</h1>
        <p className={balanceCents > 0 ? "amount positive" : balanceCents < 0 ? "amount negative" : "muted"}>{balanceText}</p>
      </div>
      <button className="primary" onClick={onSettle} type="button">Settle up</button>
    </header>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Date</th><th>Activity</th><th>Amount</th><th>Status</th><th>Balance</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const entryId = row.entry?.id;
            return <tr key={row.id}>
              <td className="date-cell">{row.date || "Opening"}</td>
              <td>{entryId
                ? <button className="transaction-link" onClick={() => openActivity({ entryIds: [entryId] })} type="button">{row.label}</button>
                : row.label}</td>
              <td className="amount">{formatMoney(row.amountCents)}</td>
              <td>{row.entry ? row.settled ? "Settled" : "Open" : ""}</td>
              <td className="amount">{formatMoney(row.runningBalanceCents)}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <section>
      <h2>Written off and gifted</h2>
      {treatedPortions.length === 0
        ? <p className="empty-state compact">No written-off or gifted portions.</p>
        : <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Activity</th><th>Treatment</th><th>Would-be debt</th><th>Action</th></tr></thead>
            <tbody>
              {treatedPortions.map(({ entry, portionIndex, portion, debt }) => {
                const debtorId = debt && (debt.amountCents < 0 ? debt.creditorId : debt.debtorId);
                const creditorId = debt && (debt.amountCents < 0 ? debt.debtorId : debt.creditorId);
                const debtorName = ledger.entities.find((item) => item.id === debtorId)?.name ?? "Unknown";
                const creditorName = ledger.entities.find((item) => item.id === creditorId)?.name ?? "Unknown";
                return <tr key={`${entry.id}-${portionIndex}`}>
                  <td className="date-cell">{entry.date}</td>
                  <td><button className="transaction-link" onClick={() => openActivity({ entryIds: [entry.id] })} type="button">{entry.description || entry.kind}</button></td>
                  <td>{portion.treatment === "writeOff" ? "Write off" : "Gift"}</td>
                  <td>{debt
                    ? `${debtorName} owes ${creditorName} ${formatMoney(Math.abs(debt.amountCents))}`
                    : "No debt would be created"}</td>
                  <td>{portion.treatment === "writeOff" && <button className="text-button" onClick={() => startClaiming(entry.id, portionIndex)} type="button">Start claiming</button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
    </section>
  </>;
}
