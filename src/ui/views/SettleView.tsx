import { useRef, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  update: (next: Ledger, undoLabel?: string) => void;
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
      {!items.length ? <p className="text-muted-foreground">Nothing open.</p> : <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Date</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Item</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Open amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={`${item.id}-${index}`}>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{item.date || "Opening"}</TableCell>
                <TableCell>{item.description} {item.source === "credit" && <Badge variant="outline">Credit</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(item.openAmountCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  const entityBalances = balances(ledger).byEntity;
  const entities = ledger.entities.filter((entity) =>
    entity.id !== SELF_ENTITY_ID &&
    entity.kind !== "self" &&
    (!entity.archived || (entityBalances[entity.id] ?? 0) !== 0),
  );
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
  const [deletingSettlement, setDeletingSettlement] = useState<Settlement | null>(null);
  const [paymentIdDialogOpen, setPaymentIdDialogOpen] = useState(false);
  const [splitwisePaymentId, setSplitwisePaymentId] = useState("");
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
    .filter((settlement) => settlement.entityId === entityId && !settlement.paidToEntityId)
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
    const expenseId = splitwisePaymentId.trim();
    if (!/^\d+$/.test(expenseId)) {
      setPaymentMessage("Enter a valid Splitwise payment ID.");
      return;
    }
    update({
      ...ledger,
      splitwisePosts: (ledger.splitwisePosts ?? []).map((candidate) => candidate.id === post.id
        ? { ...candidate, state: "posted", splitwiseExpenseId: expenseId, updatedAt: new Date().toISOString() }
        : candidate),
    });
    setPaymentIdDialogOpen(false);
    setSplitwisePaymentId("");
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
    update(nextLedger, "Record settlement");
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
    update(nextLedger, "Record settlement");
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
    update({
      ...ledger,
      settlements: (ledger.settlements ?? []).filter((item) => item.id !== settlement.id),
      bankRows: (ledger.bankRows ?? []).map((row) => row.settlementId === settlement.id
        ? { ...row, settlementId: null, updatedAt: new Date().toISOString() }
        : row),
    }, "Delete settlement");
    setDeletingSettlement(null);
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Settle</h1>
      </header>
      <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm" aria-label="Current balance">
        <p>{entity ? `${entity.name}: ` : "Balance: "}{netBalance > 0 ? `They owe you ${formatMoney(netBalance)}` : netBalance < 0 ? `You owe ${entity?.name ?? "them"} ${formatMoney(Math.abs(netBalance))}` : "Settled"}</p>
        {entity?.splitwise?.kind === "user" && balanceUnavailableFor !== entity.id && <Button variant="outline" disabled={checkingBalance} onClick={() => void checkSplitwiseBalance()} type="button">{checkingBalance ? "Checking Splitwise…" : "Check Splitwise balance"}</Button>}
        {checkedBalance && checkedBalance.entityId === entity?.id && <p>Splitwise: {formatMoney(checkedBalance.splitwiseCents)}. Difference: {formatMoney(checkedBalance.splitwiseCents - netBalance)}. A difference means an unmatched entry or settlement.</p>}
      </section>

      <form className="grid gap-4 rounded-lg border p-4" id="settlement-form" onSubmit={save}>
        {error && <p className="rounded-md border p-3 text-sm border-destructive/40 text-destructive" role="alert">{error}</p>}
        {success && <p className="rounded-md border p-3 text-sm border-positive/40 text-positive" role="status">{success}</p>}
        <div className="grid gap-2">
          <Label htmlFor="settlement-who">Who</Label>
          <Select value={entityId} onValueChange={(value) => setEntityId(value ?? "")}>
            <SelectTrigger id="settlement-who"><SelectValue placeholder="Choose an entity" /></SelectTrigger>
            <SelectContent>
              {entities.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="grid gap-2">
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as SettlementDirection)}>
            <option value="theyPaidYou">They paid me</option>
            <option value="youPaidThem">I paid them</option>
          </select>
        </label>
        <label className="grid gap-2">
          Amount
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-2">Date<Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label className="grid gap-2">
          Note
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="flex justify-end"><Button disabled={!entities.length} type="submit">Record settlement</Button></div>
      </form>

      {savedSettlement && ledger.settlements?.some((settlement) => settlement.id === savedSettlement.id) &&
        !savedSettlement.splitwisePaymentId && ledger.entities.find((item) => item.id === savedSettlement.entityId)?.splitwise && (
        <section className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm" aria-label="Record settlement in Splitwise">
          <h2>Splitwise payment</h2>
          {settlementPost?.state === "posted" && <p>Posted to Splitwise ({settlementPost.splitwiseExpenseId}).</p>}
          {(settlementPost?.state === "posting" || pendingPayment) && <p role="status">Posting to Splitwise.</p>}
          {(settlementPost?.state === "unknown" || settlementPost?.state === "posting" && !pendingPayment) && <div className="rounded-md border p-3 text-sm border-destructive/40 text-destructive" role="status">
            Check Splitwise before retrying. {" "}
            <Button variant="outline" onClick={() => setPaymentIdDialogOpen(true)} type="button">Mark posted</Button>{" "}
            <Button variant="outline" onClick={() => clearSettlementPost(settlementPost.id)} type="button">Clear</Button>
          </div>}
          {paymentMessage && <p className={`rounded-md border p-3 text-sm ${paymentMessage.includes("posted") ? "border-positive/40 text-positive" : "border-destructive/40 text-destructive"}`} role="status">{paymentMessage}</p>}
          {!settlementPost && !pendingPayment && !stagedPayment && !paymentContext && (
            <Button variant="outline" onClick={() => void preparePayment(savedSettlement)} type="button">Also record in Splitwise</Button>
          )}
          {paymentContext && (
            <div className="grid gap-4">
              <label>Group member<select value={selectedPaymentMemberId} onChange={(event) => setSelectedPaymentMemberId(event.target.value)}>
                {paymentContext.members.map((member) => <option key={member.id} value={member.id}>{`${member.first_name} ${member.last_name}`.trim()}</option>)}
              </select></label>
              <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" disabled={!selectedPaymentMemberId} onClick={() => {
                const settlement = ledger.settlements?.find((item) => item.id === paymentContext.settlementId);
                if (settlement) stagePayment(settlement, Number(selectedPaymentMemberId), paymentContext.youId);
              }} type="button">Continue</button>
              <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => setPaymentContext(null)} type="button">Cancel</button>
            </div>
          )}
          {stagedPayment && (
            <div className="grid gap-4">
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
              <div className="flex flex-wrap justify-end gap-2">
                <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" disabled={pendingPayment} onClick={() => void submitPayment()} type="button">Confirm and post</button>
                <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" disabled={pendingPayment} onClick={() => setStagedPayment(null)} type="button">Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      {amount.trim() && <>
        <h2>Payment allocation</h2>
        <p className="text-muted-foreground">Applied oldest first. Allocation is fixed.</p>
        {!preview.length ? <p className="text-muted-foreground">Nothing open.</p> : <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <Table tabIndex={0}>
            <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Date</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Item</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Applied</TableHead></TableRow></TableHeader>
            <TableBody>{preview.map(({ item, appliedCents }, index) => <TableRow key={`${item.id}-${index}`}>
              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{item.date || "Opening"}</TableCell><TableCell>{item.description} {item.source === "credit" && <Badge variant="outline">Credit</Badge>}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(appliedCents)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>}
      </>}

      <h2>Open items</h2>
      <ItemsTable title="They owe you" items={items.theyOweYou} />
      <ItemsTable title="You owe them" items={items.youOweThem} />

      <h3>Recorded in Splitwise</h3>
      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Date</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Payment</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Direction</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Amount</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold" /></TableRow></TableHeader>
          <TableBody>
            {splitwisePayments.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{item.date}</TableCell>
                <TableCell>{item.description || "Splitwise payment"}</TableCell>
                <TableCell>{item.yourPaidCents === 0 ? "They paid you" : "You paid them"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(item.costCents)}</TableCell>
                <TableCell>{item.status === "new" && !recordedSplitwisePaymentIds.has(item.splitwiseExpenseId) && (
                  <Button onClick={() => recordSplitwisePayment(item)} type="button">Record</Button>
                )}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!splitwisePayments.length && <p className="text-sm text-muted-foreground p-4">No unrecorded Splitwise payments.</p>}
      </div>
      <h2>Past settlements</h2>
      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Date</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Direction</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Amount</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Note</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Bank activity</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold" /></TableRow></TableHeader>
          <TableBody>
            {settlements.map((settlement) => (
              <TableRow key={settlement.id}>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{settlement.date}</TableCell>
                <TableCell>{settlement.direction === "theyPaidYou" ? "They paid you" : "You paid them"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(settlement.amountCents)}</TableCell>
                <TableCell>{settlement.note}</TableCell>
                <TableCell>{bankActivity(settlement)}</TableCell>
                <TableCell><Button variant="outline" onClick={() => setDeletingSettlement(settlement)} type="button">Delete settlement</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!settlements.length && <p className="text-sm text-muted-foreground p-4">No settlements recorded.</p>}
      </div>
      <AlertDialog open={Boolean(deletingSettlement)} onOpenChange={(open) => { if (!open) setDeletingSettlement(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete settlement?</AlertDialogTitle>
            <AlertDialogDescription>This removes the settlement and unlinks its bank rows.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingSettlement && deleteSettlement(deletingSettlement)}>Delete settlement</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={paymentIdDialogOpen} onOpenChange={setPaymentIdDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Splitwise payment as posted</DialogTitle>
            <DialogDescription>Enter the payment ID to link the confirmed Splitwise payment.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="splitwise-payment-id">Splitwise payment ID</Label>
          <Input id="splitwise-payment-id" inputMode="numeric" value={splitwisePaymentId} onChange={(event) => setSplitwisePaymentId(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentIdDialogOpen(false)} type="button">Cancel</Button>
            <Button disabled={!settlementPost} onClick={() => settlementPost && markSettlementPosted(settlementPost)} type="button">Mark posted</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}