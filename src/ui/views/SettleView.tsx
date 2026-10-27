import { useRef, useState } from "react";
import {
  balances,
  openItems,
  SELF_ENTITY_ID,
  type BankRow,
  type EntityOpenItems,
  type Ledger,
  type OpenItem,
  type Settlement,
  type SettlementDirection,
} from "../../domain/ledger";
import { formatMoney, parseAud } from "../../domain/value";
import type { SplitwiseInboxItem } from "../../adapters/splitwise";
import {
  buildPayment,
  getCurrentUser,
  getFriends,
  getGroups,
  postExpense,
  sessionStatus,
  SplitwiseNoResponseError,
  SplitwiseRejectedError,
  type SplitwiseExpenseDraft,
  type SplitwiseUser,
} from "../../adapters/splitwise";

interface SettleViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  saveNow: (next: Ledger) => Promise<void>;
  bankRow: BankRow | null;
  onSaved: () => void;
}

interface StagedPayment {
  settlementId: string;
  entityId: string;
  memberId: number;
  youId: number;
  draft: SplitwiseExpenseDraft;
  amountInput: string;
  paidById: number;
  owedById: number;
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
      {!items.length ? <p className="muted">Nothing open.</p> : <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Item</th><th>Open amount</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.id}-${index}`}>
                <td className="date-cell">{item.date || "Opening"}</td>
                <td>{item.description}</td>
                <td className="amount">{formatMoney(item.openAmountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>}
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

export function SettleView({ ledger, update, saveNow, bankRow, onSaved }: SettleViewProps) {
  const currentLedger = useRef(ledger);
  currentLedger.current = ledger;
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
  const [savedSettlement, setSavedSettlement] = useState<Settlement | null>(null);
  const [paymentContext, setPaymentContext] = useState<{ settlementId: string; youId: number; members: SplitwiseUser[] } | null>(null);
  const [selectedPaymentMemberId, setSelectedPaymentMemberId] = useState("");
  const [stagedPayment, setStagedPayment] = useState<StagedPayment | null>(null);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [pendingPayment, setPendingPayment] = useState(false);
  const [checkedBalance, setCheckedBalance] = useState<{ entityId: string; splitwiseCents: number } | null>(null);
  const [balanceUnavailableFor, setBalanceUnavailableFor] = useState("");
  const [checkingBalance, setCheckingBalance] = useState(false);
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
  const settlementPost = savedSettlement && (ledger.splitwisePosts ?? []).find((post) =>
    post.settlementId === savedSettlement.id,
  );

  function stagePayment(settlement: NonNullable<typeof savedSettlement>, memberId: number, youId: number) {
    const entity = ledger.entities.find((candidate) => candidate.id === settlement.entityId);
    if (!entity) return;
    try {
      const draft = buildPayment(settlement, entity, memberId, youId);
      const paidById = settlement.direction === "theyPaidYou" ? memberId : youId;
      const owedById = settlement.direction === "theyPaidYou" ? youId : memberId;
      setStagedPayment({ settlementId: settlement.id, entityId: entity.id, memberId, youId, draft, amountInput: centsText(settlement.amountCents), paidById, owedById });
      setPaymentContext(null);
      setPaymentMessage("");
    } catch (reason) {
      setPaymentMessage(reason instanceof Error ? reason.message : "Could not prepare the Splitwise payment.");
    }
  }

  async function preparePayment(settlement: NonNullable<typeof savedSettlement>) {
    const entity = ledger.entities.find((candidate) => candidate.id === settlement.entityId);
    if (!entity?.splitwise || settlement.splitwisePaymentId) return;
    try {
      if (!(await sessionStatus()).connected) {
        setPaymentMessage("Connect Splitwise in People first.");
        return;
      }
      const you = await getCurrentUser();
      const posts = currentLedger.current.splitwisePosts ?? [];
      if (posts.some((post) => post.settlementId === settlement.id)) return;
      if (entity.splitwise.kind === "user") {
        stagePayment(settlement, Number(entity.splitwise.id), you.id);
        return;
      }
      const group = (await getGroups()).find((candidate) => candidate.id === Number(entity.splitwise?.id));
      if (!group) throw new Error("The linked Splitwise group could not be found.");
      const members = group.members.filter((member) => member.id !== you.id);
      if (!members.length) throw new Error("The linked Splitwise group has no other members.");
      setPaymentContext({ settlementId: settlement.id, youId: you.id, members });
      setSelectedPaymentMemberId(String(members[0].id));
      setPaymentMessage("");
    } catch (reason) {
      setPaymentMessage(reason instanceof Error ? reason.message : "Could not prepare the Splitwise payment.");
    }
  }

  async function submitPayment() {
    if (!stagedPayment || pendingPayment) return;
    try {
      if (!(await sessionStatus()).connected) {
        setPaymentMessage("Connect Splitwise in People first.");
        return;
      }
    } catch (reason) {
      setPaymentMessage(reason instanceof Error ? reason.message : "Could not check the Splitwise session.");
      return;
    }
    let amountCents: number;
    try {
      amountCents = parseAud(stagedPayment.amountInput);
    } catch {
      setPaymentMessage("Enter a valid AUD amount with up to two decimal places.");
      return;
    }
    if (amountCents <= 0 || !stagedPayment.draft.date || !stagedPayment.draft.description.trim() || stagedPayment.paidById === stagedPayment.owedById) {
      setPaymentMessage("Enter a date, description, positive amount, and different payer and recipient.");
      return;
    }
    const users = [stagedPayment.memberId, stagedPayment.youId];
    const draft: SplitwiseExpenseDraft = {
      ...stagedPayment.draft,
      costCents: amountCents,
      shares: users.map((userId) => ({
        userId,
        name: userId === stagedPayment.youId ? "You" : stagedPayment.draft.shares.find((share) => share.userId === userId)?.name ?? "Member",
        paidCents: userId === stagedPayment.paidById ? amountCents : 0,
        owedCents: userId === stagedPayment.owedById ? amountCents : 0,
      })),
    };
    const posting = {
      id: crypto.randomUUID(),
      entryId: null,
      settlementId: stagedPayment.settlementId,
      entityId: stagedPayment.entityId,
      state: "posting" as const,
      splitwiseExpenseId: null,
      remoteUpdatedAt: null,
      updatedAt: new Date().toISOString(),
    };
    const postingLedger = {
      ...currentLedger.current,
      splitwisePosts: [...(currentLedger.current.splitwisePosts ?? []), posting],
    };
    update(postingLedger);
    setPendingPayment(true);
    setStagedPayment(null);
    try {
      await saveNow(postingLedger);
    } catch (reason) {
      const current = currentLedger.current;
      update({ ...current, splitwisePosts: (current.splitwisePosts ?? []).filter((post) => post.id !== posting.id) });
      setPaymentMessage(reason instanceof Error ? reason.message : "Could not save the pending Splitwise post.");
      setPendingPayment(false);
      return;
    }
    try {
      const expenseId = await postExpense(draft);
      const current = currentLedger.current;
      update({
        ...current,
        splitwisePosts: (current.splitwisePosts ?? []).map((post) => post.id === posting.id
          ? { ...post, state: "posted", splitwiseExpenseId: String(expenseId), updatedAt: new Date().toISOString() }
          : post),
      });
      setPaymentMessage("Payment posted to Splitwise.");
    } catch (reason) {
      const rejected = reason instanceof SplitwiseRejectedError;
      const current = currentLedger.current;
      update({
        ...current,
        splitwisePosts: rejected
          ? (current.splitwisePosts ?? []).filter((post) => post.id !== posting.id)
          : (current.splitwisePosts ?? []).map((post) => post.id === posting.id
            ? { ...post, state: "unknown", updatedAt: new Date().toISOString() }
            : post),
      });
      setPaymentMessage(rejected
        ? reason.message
        : reason instanceof SplitwiseNoResponseError
          ? `Check Splitwise before retrying. ${reason.message}`
          : "Check Splitwise before retrying.");
    } finally {
      setPendingPayment(false);
    }
  }

  async function checkSplitwiseBalance() {
    if (!entity?.splitwise || entity.splitwise.kind !== "user" || checkingBalance) return;
    setCheckingBalance(true);
    setPaymentMessage("");
    try {
      const friend = (await getFriends()).find((candidate) => candidate.id === Number(entity.splitwise?.id));
      const balance = friend?.balance?.find((candidate) => candidate.currency_code === "AUD");
      if (!balance) {
        setCheckedBalance(null);
        setBalanceUnavailableFor(entity.id);
        return;
      }
      setCheckedBalance({ entityId: entity.id, splitwiseCents: parseAud(balance.amount) });
    } catch (reason) {
      setPaymentMessage(reason instanceof Error ? reason.message : "Could not check the Splitwise balance.");
    } finally {
      setCheckingBalance(false);
    }
  }

  function clearSettlementPost(postId: string) {
    update({ ...ledger, splitwisePosts: (ledger.splitwisePosts ?? []).filter((post) => post.id !== postId) });
    setPaymentMessage("");
  }

  function markSettlementPosted(post: NonNullable<Ledger["splitwisePosts"]>[number]) {
    const expenseId = window.prompt("Splitwise payment ID");
    if (!expenseId?.trim() || !/^\d+$/.test(expenseId.trim())) return;
    update({
      ...ledger,
      splitwisePosts: (ledger.splitwisePosts ?? []).map((candidate) => candidate.id === post.id
        ? { ...candidate, state: "posted", splitwiseExpenseId: expenseId.trim(), updatedAt: new Date().toISOString() }
        : candidate),
    });
    setPaymentMessage("");
  }

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
    const nextLedger = {
      ...ledger,
      settlements: [...(ledger.settlements ?? []), settlement],
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "done" as const }
        : candidate),
    };
    update(nextLedger);
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
    const nextLedger = {
      ...ledger,
      settlements: [...(ledger.settlements ?? []), settlement],
      bankRows: bankRow
        ? (ledger.bankRows ?? []).map((row) => row.id === bankRow.id
          ? { ...row, settlementId: settlement.id, updatedAt: now }
          : row)
        : ledger.bankRows,
    };
    update(nextLedger);
    setSavedSettlement(settlement);
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
      </header>
      <section className="card" aria-label="Current balance">
        <p>{entity ? `${entity.name}: ` : "Balance: "}{netBalance > 0 ? `They owe you ${formatMoney(netBalance)}` : netBalance < 0 ? `You owe ${entity?.name ?? "them"} ${formatMoney(Math.abs(netBalance))}` : "Settled"}</p>
        {entity?.splitwise?.kind === "user" && balanceUnavailableFor !== entity.id && <button className="secondary" disabled={checkingBalance} onClick={() => void checkSplitwiseBalance()} type="button">{checkingBalance ? "Checking Splitwise…" : "Check Splitwise balance"}</button>}
        {checkedBalance && checkedBalance.entityId === entity?.id && <p>Splitwise: {formatMoney(checkedBalance.splitwiseCents)}. Difference: {formatMoney(checkedBalance.splitwiseCents - netBalance)}. A difference means an unmatched entry or settlement.</p>}
      </section>

      <form className="form-grid card" id="settlement-form" onSubmit={save}>
        {error && <p className="banner error" role="alert">{error}</p>}
        {success && <p className="banner success" role="status">{success}</p>}
        <label>
          Who
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)} required>
            {entities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as SettlementDirection)}>
            <option value="theyPaidYou">They paid me</option>
            <option value="youPaidThem">I paid them</option>
          </select>
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label>
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="dialog-actions"><button className="primary" disabled={!entities.length} type="submit">Record</button></div>
      </form>

      {savedSettlement && ledger.settlements?.some((settlement) => settlement.id === savedSettlement.id) &&
        !savedSettlement.splitwisePaymentId && ledger.entities.find((item) => item.id === savedSettlement.entityId)?.splitwise && (
        <section className="card" aria-label="Record settlement in Splitwise">
          <h2>Splitwise payment</h2>
          {settlementPost?.state === "posted" && <p>Posted to Splitwise ({settlementPost.splitwiseExpenseId}).</p>}
          {(settlementPost?.state === "posting" || pendingPayment) && <p role="status">Posting to Splitwise.</p>}
          {(settlementPost?.state === "unknown" || settlementPost?.state === "posting" && !pendingPayment) && <div className="banner error" role="status">
            Check Splitwise before retrying. {" "}
            <button className="secondary" onClick={() => markSettlementPosted(settlementPost)} type="button">Mark posted</button>{" "}
            <button className="secondary" onClick={() => clearSettlementPost(settlementPost.id)} type="button">Clear</button>
          </div>}
          {paymentMessage && <p className={`banner${paymentMessage.includes("posted") ? " success" : " error"}`} role="status">{paymentMessage}</p>}
          {!settlementPost && !pendingPayment && !stagedPayment && !paymentContext && (
            <button className="secondary" onClick={() => void preparePayment(savedSettlement)} type="button">Also record in Splitwise</button>
          )}
          {paymentContext && (
            <div className="form-grid">
              <label>Group member<select value={selectedPaymentMemberId} onChange={(event) => setSelectedPaymentMemberId(event.target.value)}>
                {paymentContext.members.map((member) => <option key={member.id} value={member.id}>{`${member.first_name} ${member.last_name}`.trim()}</option>)}
              </select></label>
              <button className="primary" disabled={!selectedPaymentMemberId} onClick={() => {
                const settlement = ledger.settlements?.find((item) => item.id === paymentContext.settlementId);
                if (settlement) stagePayment(settlement, Number(selectedPaymentMemberId), paymentContext.youId);
              }} type="button">Continue</button>
              <button className="secondary" onClick={() => setPaymentContext(null)} type="button">Cancel</button>
            </div>
          )}
          {stagedPayment && (
            <div className="form-grid">
              <label>Description<input value={stagedPayment.draft.description} onChange={(event) => setStagedPayment((current) => current ? { ...current, draft: { ...current.draft, description: event.target.value } } : current)} /></label>
              <label>Date<input type="date" value={stagedPayment.draft.date} onChange={(event) => setStagedPayment((current) => current ? { ...current, draft: { ...current.draft, date: event.target.value } } : current)} /></label>
              <label>Amount (AUD)<input inputMode="decimal" value={stagedPayment.amountInput} onChange={(event) => setStagedPayment((current) => current ? { ...current, amountInput: event.target.value } : current)} /></label>
              <label>Who paid?<select value={stagedPayment.paidById} onChange={(event) => setStagedPayment((current) => current ? { ...current, paidById: Number(event.target.value), owedById: Number(event.target.value) === current.youId ? current.memberId : current.youId } : current)}>
                <option value={stagedPayment.memberId}>{ledger.entities.find((item) => item.id === stagedPayment.entityId)?.name ?? "Member"}</option>
                <option value={stagedPayment.youId}>You</option>
              </select></label>
              <label>Who is owed?<select value={stagedPayment.owedById} onChange={(event) => setStagedPayment((current) => current ? { ...current, owedById: Number(event.target.value), paidById: Number(event.target.value) === current.youId ? current.memberId : current.youId } : current)}>
                <option value={stagedPayment.memberId}>{ledger.entities.find((item) => item.id === stagedPayment.entityId)?.name ?? "Member"}</option>
                <option value={stagedPayment.youId}>You</option>
              </select></label>
              <div className="dialog-actions">
                <button className="primary" disabled={pendingPayment} onClick={() => void submitPayment()} type="button">Confirm and post</button>
                <button className="secondary" disabled={pendingPayment} onClick={() => setStagedPayment(null)} type="button">Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      {amount.trim() && <>
        <h2>Payment allocation</h2>
        <p className="muted">Applied oldest first. Allocation is fixed.</p>
        {!preview.length ? <p className="muted">Nothing open.</p> : <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Item</th><th>Applied</th></tr></thead>
            <tbody>{preview.map(({ item, appliedCents }, index) => <tr key={`${item.id}-${index}`}>
              <td className="date-cell">{item.date || "Opening"}</td><td>{item.description}</td><td className="amount">{formatMoney(appliedCents)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </>}

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
                <td className="amount">{formatMoney(item.costCents)}</td>
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
                <td className="amount">{formatMoney(settlement.amountCents)}</td>
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