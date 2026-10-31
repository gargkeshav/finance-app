import { Fragment, useRef, useState } from "react";
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
  settlementCoverage,
  SELF_ENTITY_ID,
  type BankRow,
  type Ledger,
  type OpenItem,
  type Settlement,
  type SettlementDirection,
} from "../../domain/ledger";
import { formatMoney, parseAud } from "../../domain/value";
import type { SplitwiseInboxItem } from "../../adapters/splitwise";
import { BetweenOthers } from "./BetweenOthers";
import { countLabel, differenceText, SettlementDetail } from "./SettlementDetail";
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

/** Oldest items first, as many as the payment fully covers. */
function autoPick(items: OpenItem[], amountCents: number): Set<string> {
  const picked = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (item.source !== "entry") continue;
    if (total + item.openAmountCents > amountCents) break;
    total += item.openAmountCents;
    picked.add(item.id);
  }
  return picked;
}

function ItemsTable({ title, items }: { title: string; items: OpenItem[] }) {
  return (
    <>
      {title && <h3>{title}</h3>}
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

export function SettleView({ ledger, update, saveNow, bankRow, onSaved }: SettleViewProps) {
  const currentLedger = useRef(ledger);
  currentLedger.current = ledger;
  const entityBalances = balances(ledger).byEntity;
  const entities = ledger.entities.filter((entity) =>
    entity.id !== SELF_ENTITY_ID &&
    entity.kind !== "self" &&
    (!entity.archived || (entityBalances[entity.id] ?? 0) !== 0),
  );
  const [entityId, setEntityId] = useState(() =>
    [...entities].sort((first, second) => Math.abs(entityBalances[second.id] ?? 0) - Math.abs(entityBalances[first.id] ?? 0))[0]?.id ?? "");
  const [date, setDate] = useState(bankRow?.date ?? today());
  const directionFor = (id: string): SettlementDirection => bankRow
    ? bankRow.amountCents > 0 ? "theyPaidYou" : "youPaidThem"
    : (entityBalances[id] ?? 0) < 0 ? "youPaidThem" : "theyPaidYou";
  const [direction, setDirection] = useState<SettlementDirection>(() => directionFor(entityId));
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [remainder, setRemainder] = useState<"carry" | "writeOff">("carry");
  const [itemFilter, setItemFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const payable = direction === "theyPaidYou" ? items.theyOweYou : items.youOweThem;
  const pickedIds = picked ?? autoPick(payable, amountCents);
  const pickedCents = payable.filter((item) => pickedIds.has(item.id)).reduce((total, item) => total + item.openAmountCents, 0);
  const differenceCents = amountCents - pickedCents;
  const filterText = itemFilter.trim().toLowerCase();
  const shownItems = filterText
    ? payable.filter((item) => `${item.date} ${item.description} ${formatMoney(item.openAmountCents)}`.toLowerCase().includes(filterText))
    : payable;
  const entityName = entity?.name ?? "them";

  function chooseEntity(id: string) {
    setEntityId(id);
    if (!bankRow) setDirection(directionFor(id));
    setPicked(null);
    setItemFilter("");
  }

  function togglePicked(id: string) {
    const next = new Set(pickedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }
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
      ...(pickedIds.size ? { entryIds: payable.filter((item) => pickedIds.has(item.id)).map((item) => item.id) } : {}),
      ...(pickedIds.size && remainder === "writeOff" && differenceCents !== 0 ? { remainder } : {}),
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
    setSuccess(`Recorded ${formatMoney(parsedAmount)} ${direction === "theyPaidYou" ? `from ${entity.name}` : `to ${entity.name}`}${pickedIds.size ? `, covering ${pickedIds.size} item${pickedIds.size === 1 ? "" : "s"}` : ""}.`);
    setDate(today());
    setAmount("");
    setNote("");
    setPicked(null);
    setRemainder("carry");
    setExpandedId(settlement.id);
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
          <Select items={entities.map((item) => ({ value: item.id, label: item.name }))} value={entityId} onValueChange={(value) => chooseEntity(value ?? "")}>
            <SelectTrigger id="settlement-who"><SelectValue placeholder="Choose an entity" /></SelectTrigger>
            <SelectContent>
              {entities.map((item) => {
                const cents = entityBalances[item.id] ?? 0;
                return <SelectItem key={item.id} value={item.id}>{item.name}{cents !== 0 && <span className="ml-2 text-muted-foreground tabular-nums">{cents > 0 ? `owes you ${formatMoney(cents)}` : `you owe ${formatMoney(-cents)}`}</span>}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <label className="grid gap-2">
          Direction
          <select value={direction} onChange={(event) => { setDirection(event.target.value as SettlementDirection); setPicked(null); }}>
            <option value="theyPaidYou">{entityName} paid me</option>
            <option value="youPaidThem">I paid {entityName}</option>
          </select>
        </label>
        <label className="grid gap-2">
          Amount
          <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[$,\s]/g, "")); setPicked(null); }} required />
        </label>
        {netBalance !== 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => {
              setDirection(netBalance > 0 ? "theyPaidYou" : "youPaidThem");
              setAmount(centsText(Math.abs(netBalance)));
              setPicked(null);
            }}>Full balance {formatMoney(Math.abs(netBalance))}</Button>
          </div>
        )}
        <label className="grid gap-2">Date<Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label className="grid gap-2">
          Note
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="flex justify-end"><Button disabled={!entities.length || amountCents <= 0} type="submit">Record payment</Button></div>
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

      <section className="grid gap-3 rounded-lg border p-4" aria-label="What this payment covers">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2>{direction === "theyPaidYou" ? `What ${entityName} is paying for` : `What you are paying ${entityName} for`}</h2>
          <span className="text-sm text-muted-foreground">{payable.length} open item{payable.length === 1 ? "" : "s"} · {formatMoney(payable.reduce((total, item) => total + item.openAmountCents, 0))}</span>
        </div>
        <p className="text-sm text-muted-foreground">Tick the items this payment covers. With an amount entered, the oldest items it fully covers are ticked for you. Unticked items stay open.</p>
        {payable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-xs" placeholder="Filter items" value={itemFilter} onChange={(event) => setItemFilter(event.target.value)} aria-label="Filter open items" />
            <Button size="sm" variant="outline" type="button" onClick={() => setPicked(new Set([...pickedIds, ...shownItems.filter((item) => item.source === "entry").map((item) => item.id)]))}>Tick {filterText ? "shown" : "all"}</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
        )}
        {!payable.length ? <p className="text-muted-foreground">Nothing open in this direction.</p> : <div className="max-h-96 w-full min-w-0 max-w-full overflow-auto">
          <Table tabIndex={0}>
            <TableHeader><TableRow><TableHead className="w-10"><span className="sr-only">Covered</span></TableHead><TableHead className="hidden !text-secondary-foreground !font-semibold sm:table-cell">Date</TableHead><TableHead className="!text-secondary-foreground !font-semibold">Item</TableHead><TableHead className="!text-secondary-foreground !font-semibold">Open</TableHead></TableRow></TableHeader>
            <TableBody>
              {shownItems.map((item, index) => (
                <TableRow key={`${item.id}-${index}`} className={pickedIds.has(item.id) ? "bg-muted/40" : undefined}>
                  <TableCell>{item.source === "entry" && <input aria-label={`Covers ${item.description}`} checked={pickedIds.has(item.id)} onChange={() => togglePicked(item.id)} type="checkbox" />}</TableCell>
                  <TableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground sm:table-cell">{item.date || "Opening"}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {item.description} {item.source !== "entry" && <Badge variant="outline">{item.source === "baseline" ? "Opening balance" : "Credit"}</Badge>}
                    <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">{item.date || "Opening"}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(item.openAmountCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>}
        {(pickedIds.size > 0 || amountCents > 0) && (
          <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm" role="status">
            <p className="tabular-nums">Payment {formatMoney(amountCents)} · ticked {pickedIds.size} item{pickedIds.size === 1 ? "" : "s"} {formatMoney(pickedCents)} · {differenceCents === 0 ? "matches exactly" : differenceCents > 0 ? `${formatMoney(differenceCents)} over` : `${formatMoney(-differenceCents)} under`}</p>
            {pickedIds.size > 0 && differenceCents !== 0 && (
              <fieldset className="flex flex-wrap gap-4">
                <legend className="sr-only">Difference</legend>
                <label className="flex items-center gap-2"><input checked={remainder === "carry"} name="remainder" onChange={() => setRemainder("carry")} type="radio" />
                  {differenceCents > 0 ? "Apply the extra to other open items, then keep it as credit" : "Keep the shortfall as still owed"}</label>
                <label className="flex items-center gap-2"><input checked={remainder === "writeOff"} name="remainder" onChange={() => setRemainder("writeOff")} type="radio" />
                  Write off the {formatMoney(Math.abs(differenceCents))} difference</label>
              </fieldset>
            )}
            {!pickedIds.size && amountCents > 0 && <p className="text-muted-foreground">Nothing ticked: the payment pays the oldest items first.</p>}
          </div>
        )}
        {items[direction === "theyPaidYou" ? "youOweThem" : "theyOweYou"].length > 0 && (
          <details open={items[direction === "theyPaidYou" ? "youOweThem" : "theyOweYou"].some((item) => item.source === "credit")}>
            <summary className="cursor-pointer text-sm">{direction === "theyPaidYou" ? "You also owe them" : "They also owe you"} {formatMoney(items[direction === "theyPaidYou" ? "youOweThem" : "theyOweYou"].reduce((total, item) => total + item.openAmountCents, 0))}</summary>
            <ItemsTable title="" items={items[direction === "theyPaidYou" ? "youOweThem" : "theyOweYou"]} />
          </details>
        )}
      </section>

      {splitwisePayments.length > 0 && <>
      <h3>Splitwise payments to record</h3>
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
      </div>
      </>}
      <h2>Past payments with {entityName}</h2>
      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow><TableHead className="!text-secondary-foreground !font-semibold">Date</TableHead><TableHead className="!text-secondary-foreground !font-semibold">Direction</TableHead><TableHead className="!text-secondary-foreground !font-semibold">Amount</TableHead><TableHead className="!text-secondary-foreground !font-semibold">Covers</TableHead><TableHead className="!text-secondary-foreground !font-semibold">Note</TableHead><TableHead className="!text-secondary-foreground !font-semibold" /></TableRow></TableHeader>
          <TableBody>
            {settlements.map((settlement) => {
              const coverage = settlementCoverage(ledger, settlement);
              const linked = coverage.items.length + coverage.lines.length;
              const expanded = expandedId === settlement.id;
              return (
                <Fragment key={settlement.id}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{settlement.date}</TableCell>
                    <TableCell>{settlement.direction === "theyPaidYou" ? `${entityName} paid you` : `You paid ${entityName}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(settlement.amountCents)}</TableCell>
                    <TableCell className="text-sm">
                      {linked ? <>
                        {coverage.lines.length ? countLabel(coverage.lines.length, "line") : countLabel(coverage.items.length, "item")}
                        <span className="block text-muted-foreground">{differenceText(coverage.differenceCents, settlement.remainder, coverage.lines.length ? "the lines" : "the items")}</span>
                      </> : <span className="text-muted-foreground">Oldest items first</span>}
                      {!settlement.bankRowIds.length && <Badge className="mt-1" variant="outline">No bank row</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{settlement.note}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : settlement.id)} type="button">{expanded ? "Hide" : "Details"}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeletingSettlement(settlement)} type="button">Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && <TableRow><TableCell colSpan={6}><SettlementDetail ledger={ledger} settlement={settlement} /></TableCell></TableRow>}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        {!settlements.length && <p className="text-sm text-muted-foreground p-4">No payments recorded yet.</p>}
      </div>
      <BetweenOthers ledger={ledger} update={update} />
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