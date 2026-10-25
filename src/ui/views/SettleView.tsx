import { useState } from "react";
import {
  balances,
  openItems,
  SELF_ENTITY_ID,
  type BankRow,
  type EntityOpenItems,
  type Ledger,
  type OpenItem,
  type SettlementDirection,
} from "../../domain/ledger";
import { formatAud, parseAud } from "../../domain/value";
import type { SplitwiseInboxItem } from "../../adapters/splitwise";

interface SettleViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  bankRow: BankRow | null;
  onSaved: () => void;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function centsText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function allocations(items: OpenItem[], amountCents: number) {
  let remaining = amountCents;
  return items.flatMap((item) => {
    const appliedCents = Math.min(item.openAmountCents, remaining);
    remaining -= appliedCents;
    return appliedCents > 0 ? [{ item, appliedCents }] : [];
  });
}

function ItemsTable({ title, items }: { title: string; items: OpenItem[] }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Item</th><th>Open amount</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.id}-${index}`}>
                <td className="date-cell">{item.date || "Opening"}</td>
                <td>{item.description}</td>
                <td className="amount">{formatAud(item.openAmountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="empty-state compact">No open items.</p>}
      </div>
    </>
  );
}

function allocationsFor(
  open: EntityOpenItems,
  direction: SettlementDirection,
  amountCents: number,
) {
  return allocations(direction === "theyPaidYou" ? open.theyOweYou : open.youOweThem, amountCents);
}

export function SettleView({ ledger, update, bankRow, onSaved }: SettleViewProps) {
  const entities = ledger.entities.filter((entity) => entity.id !== SELF_ENTITY_ID && entity.kind !== "self");
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [date, setDate] = useState(bankRow?.date ?? today());
  const [direction, setDirection] = useState<SettlementDirection>(
    bankRow && bankRow.amountCents > 0 ? "theyPaidYou" : "youPaidThem",
  );
  const [amount, setAmount] = useState(bankRow ? centsText(Math.abs(bankRow.amountCents)) : "");
  const [note, setNote] = useState(bankRow?.description ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const entity = entities.find((item) => item.id === entityId);
  const items = entity ? openItems(ledger, entity.id) : { theyOweYou: [], youOweThem: [] };
  const amountCents = (() => {
    try {
      return amount.trim() ? parseAud(amount) : 0;
    } catch {
      return 0;
    }
  })();
  const preview = allocationsFor(items, direction, amountCents);
  const netBalance = entity ? balances(ledger).byEntity[entity.id] ?? 0 : 0;
  const settlements = (ledger.settlements ?? [])
    .filter((settlement) => settlement.entityId === entityId)
    .sort((first, second) => second.date.localeCompare(first.date) || second.id.localeCompare(first.id));
  const splitwisePayments = (ledger.splitwiseInbox ?? []).filter((item) =>
    item.entityId === entityId && item.isPayment && ["new", "changed", "deleted"].includes(item.status),
  );
  const recordedSplitwisePaymentIds = new Set((ledger.settlements ?? [])
    .map((settlement) => settlement.splitwisePaymentId)
    .filter((id): id is string => Boolean(id)));

  function recordSplitwisePayment(item: SplitwiseInboxItem) {
    const now = new Date().toISOString();
    const settlement = {
      id: crypto.randomUUID(),
      date: item.date,
      entityId: item.entityId,
      direction: item.yourPaidCents === 0 ? "theyPaidYou" as const : "youPaidThem" as const,
      amountCents: item.costCents,
      bankRowIds: [],
      note: item.description,
      splitwisePaymentId: item.splitwiseExpenseId,
      updatedAt: now,
    };
    update({
      ...ledger,
      settlements: [...(ledger.settlements ?? []), settlement],
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "done" }
        : candidate),
    });
  }

  function bankActivity(settlement: (typeof settlements)[number]) {
    const rows = settlement.bankRowIds
      .map((id) => (ledger.bankRows ?? []).find((row) => row.id === id))
      .filter((row): row is BankRow => Boolean(row));
    return rows.length
      ? rows.map((row) => `${row.date} ${row.description || "Bank transaction"}`).join("; ")
      : "Manual";
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let parsedAmount: number;
    try {
      parsedAmount = parseAud(amount);
    } catch {
      setError("Enter a valid AUD amount with up to two decimal places.");
      return;
    }
    if (!entity || parsedAmount <= 0) {
      setError("Choose an entity and enter an amount greater than zero.");
      return;
    }
    if (!date) {
      setError("Enter a settlement date.");
      return;
    }

    const now = new Date().toISOString();
    const settlement = {
      id: crypto.randomUUID(),
      date,
      entityId: entity.id,
      direction,
      amountCents: parsedAmount,
      bankRowIds: bankRow ? [bankRow.id] : [],
      note,
      splitwisePaymentId: null,
      updatedAt: now,
    };
    update({
      ...ledger,
      settlements: [...(ledger.settlements ?? []), settlement],
      bankRows: bankRow
        ? (ledger.bankRows ?? []).map((row) => row.id === bankRow.id
          ? { ...row, settlementId: settlement.id, updatedAt: now }
          : row)
        : ledger.bankRows,
    });
    setError("");
    setSuccess("Settlement recorded.");
    setDate(today());
    setDirection("theyPaidYou");
    setAmount("");
    setNote("");
    onSaved();
  }

  function deleteSettlement(settlement: (typeof settlements)[number]) {
    if (!window.confirm("Delete this settlement? This cannot be undone.")) return;
    update({
      ...ledger,
      settlements: (ledger.settlements ?? []).filter((item) => item.id !== settlement.id),
      bankRows: (ledger.bankRows ?? []).map((row) => row.settlementId === settlement.id
        ? { ...row, settlementId: null, updatedAt: new Date().toISOString() }
        : row),
    });
  }

  return (
    <>
      <header className="page-heading">
        <h1>Settle</h1>
        <button className="primary" disabled={!entities.length} form="settlement-form" type="submit">Record settlement</button>
      </header>
      <section className="summary-strip" aria-label="Current balance">
        <div>
          <span className="metric-label">{entity ? `${entity.name} balance` : "Balance"}</span>
          <strong className="amount">
            {netBalance > 0 ? `Owes you ${formatAud(netBalance)}` : netBalance < 0 ? `You owe ${entity?.name ?? "them"} ${formatAud(Math.abs(netBalance))}` : "Settled"}
          </strong>
        </div>
      </section>

      <form className="form-grid" id="settlement-form" onSubmit={save}>
        {error && <p className="banner error" role="alert">{error}</p>}
        {success && <p className="banner success" role="status">{success}</p>}
        <label>
          Entity
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)} required>
            {entities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as SettlementDirection)}>
            <option value="theyPaidYou">They paid you</option>
            <option value="youPaidThem">You paid them</option>
          </select>
        </label>
        <label>
          Amount (AUD)
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label>
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </form>

      <h2>Payment allocation</h2>
      <p>Applied oldest first. Allocation is fixed.</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Item</th><th>Applied</th></tr></thead>
          <tbody>
            {preview.map(({ item, appliedCents }, index) => (
              <tr key={`${item.id}-${index}`}>
                <td className="date-cell">{item.date || "Opening"}</td>
                <td>{item.description}</td>
                <td className="amount">{formatAud(appliedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!preview.length && <p className="empty-state compact">This payment will not close any open items.</p>}
      </div>

      <h2>Open items</h2>
      <ItemsTable title="They owe you" items={items.theyOweYou} />
      <ItemsTable title="You owe them" items={items.youOweThem} />

      <h3>Recorded in Splitwise</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Payment</th><th>Direction</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {splitwisePayments.map((item) => (
              <tr key={item.id}>
                <td className="date-cell">{item.date}</td>
                <td>{item.description || "Splitwise payment"}</td>
                <td>{item.yourPaidCents === 0 ? "They paid you" : "You paid them"}</td>
                <td className="amount">{formatAud(item.costCents)}</td>
                <td>{item.status === "new" && !recordedSplitwisePaymentIds.has(item.splitwiseExpenseId) && (
                  <button className="primary" onClick={() => recordSplitwisePayment(item)} type="button">Record</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!splitwisePayments.length && <p className="empty-state compact">No unrecorded Splitwise payments.</p>}
      </div>
      <h2>Past settlements</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Direction</th><th>Amount</th><th>Note</th><th>Bank activity</th><th /></tr></thead>
          <tbody>
            {settlements.map((settlement) => (
              <tr key={settlement.id}>
                <td className="date-cell">{settlement.date}</td>
                <td>{settlement.direction === "theyPaidYou" ? "They paid you" : "You paid them"}</td>
                <td className="amount">{formatAud(settlement.amountCents)}</td>
                <td>{settlement.note}</td>
                <td>{bankActivity(settlement)}</td>
                <td><button className="secondary" onClick={() => deleteSettlement(settlement)} type="button">Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!settlements.length && <p className="empty-state compact">No settlements recorded.</p>}
      </div>
    </>
  );
}