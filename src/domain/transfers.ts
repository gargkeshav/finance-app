import {
  HOUSE_ENTITY_ID,
  SELF_ENTITY_ID,
  accountCoverage,
  linkedBankAmountCents,
  type BankRow,
  type Entry,
  type Ledger,
  type Settlement,
} from "./ledger";
import { sumCents } from "./value";

export interface PossibleTransfer {
  outgoing: BankRow;
  incoming: BankRow;
  amountCents: number;
}

export interface CardCycle {
  sumCents: number;
  differenceCents: number;
}

export interface CardPaymentCheckRow {
  payment: Entry;
  chargesSinceCents: number;
  owedAfterCents: number;
  fundedFrom: string | null;
}

export interface CardPaymentCheck {
  rows: CardPaymentCheckRow[];
  owedNowCents: number;
  /** Date of the balance checkpoint the estimate starts from, if any. */
  anchoredOn: string | null;
}

export type TransferChoice = "contribution" | "settlement";

function isPending(row: BankRow): boolean {
  return !row.entryId && !row.settlementId && !row.skipped;
}

function withinThreeDays(first: string, second: string): boolean {
  const toDay = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return Math.abs(toDay(first) - toDay(second)) <= 3;
}

function daysBetween(first: string, second: string): number {
  const toDay = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return Math.abs(toDay(first) - toDay(second));
}

function linkedRows(ledger: Ledger, entry: Entry): BankRow[] {
  return (ledger.bankRows ?? []).filter((row) =>
    row.entryId === entry.id || entry.bankRowIds?.includes(row.id),
  );
}

export function cardPaymentCheck(ledger: Ledger, accountId: string): CardPaymentCheck {
  const bankRows = ledger.bankRows ?? [];
  const payments = ledger.entries
    .filter((entry) => entry.kind === "transfer" && (
      entry.accountId === accountId || linkedRows(ledger, entry).some((row) =>
        row.accountId === accountId && row.amountCents > 0,
      )
    ))
    .sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
  const charges = ledger.entries
    .filter((entry) => entry.accountId === accountId && (entry.kind === "spend" || entry.kind === "refund"))
    .map((entry) => ({
      date: entry.date,
      amountCents: (linkedBankAmountCents(entry, bankRows) ?? entry.chargedCents ?? entry.amountCents) *
        (entry.kind === "refund" ? -1 : 1),
    }))
    .sort((first, second) => first.date.localeCompare(second.date));

  // A checkpoint is the card balance from a statement (negative when owed); the estimate restarts from it.
  const anchor = [...(ledger.checkpoints ?? [])]
    .filter((checkpoint) => checkpoint.accountId === accountId)
    .sort((first, second) => second.date.localeCompare(first.date))[0] ?? null;
  let anchored = !anchor;
  let previousPaymentDate = "";
  let chargeIndex = 0;
  let owedAfterCents = 0;
  const applyAnchor = (beforeDate: string | null) => {
    if (anchored || !anchor || (beforeDate !== null && anchor.date >= beforeDate)) return;
    while (chargeIndex < charges.length && charges[chargeIndex].date <= anchor.date) chargeIndex += 1;
    owedAfterCents = -anchor.balanceCents;
    anchored = true;
  };
  const rows = payments.map((payment) => {
    applyAnchor(payment.date);
    let chargesSinceCents = 0;
    while (chargeIndex < charges.length && charges[chargeIndex].date <= payment.date) {
      const charge = charges[chargeIndex++];
      owedAfterCents += charge.amountCents;
      if (charge.date > previousPaymentDate) chargesSinceCents += charge.amountCents;
    }
    owedAfterCents -= payment.amountCents;
    const fundedFrom = linkedRows(ledger, payment)
      .find((row) => row.amountCents < 0 && ledger.accounts.some((account) =>
        account.id === row.accountId && account.type === "asset",
      ));
    previousPaymentDate = payment.date;
    return {
      payment,
      chargesSinceCents,
      owedAfterCents,
      fundedFrom: fundedFrom ? ledger.accounts.find((account) => account.id === fundedFrom.accountId)?.name ?? null : null,
    };
  });

  applyAnchor(null);
  for (; chargeIndex < charges.length; chargeIndex += 1) owedAfterCents += charges[chargeIndex].amountCents;
  return { rows, owedNowCents: owedAfterCents, anchoredOn: anchor?.date ?? null };
}

export function existingEntryFor(ledger: Ledger, row: BankRow): Entry | null {
  const rowAmount = Math.abs(row.amountCents);
  const candidates = ledger.entries.filter((entry) => {
    if (entry.kind === (row.amountCents < 0 ? "spend" : "refund")) {
      return (entry.chargedCents ?? entry.amountCents) === rowAmount && entry.accountId === row.accountId &&
        !entry.bankRowIds?.length && daysBetween(entry.date, row.date) <= 2;
    }
    if (entry.kind !== "transfer" || Math.abs(entry.amountCents) !== rowAmount ||
      !entry.tags?.includes("card-payment") || !entry.accountId || daysBetween(entry.date, row.date) > 3) {
      return false;
    }
    const card = ledger.accounts.find((account) => account.id === entry.accountId && account.type === "credit");
    if (!card) return false;
    const hasAccountRow = (entry.bankRowIds ?? []).some((id) =>
      ledger.bankRows?.some((bankRow) => bankRow.id === id && bankRow.accountId === row.accountId),
    ) || (ledger.bankRows ?? []).some((bankRow) => bankRow.entryId === entry.id && bankRow.accountId === row.accountId);
    if (hasAccountRow) return false;
    return row.amountCents > 0
      ? row.accountId === card.id
      : row.amountCents < 0 && ledger.accounts.some((account) =>
        account.id === row.accountId && account.type === "asset" && account.payerEntityId === card.payerEntityId,
      );
  });
  const sameDate = candidates.filter((entry) => entry.date === row.date);
  if (sameDate.length === 1) return sameDate[0];
  if (sameDate.length > 1) return null;
  return candidates.length === 1 ? candidates[0] : null;
}

export function isWaitingOnOtherAccount(
  ledger: Ledger,
  row: BankRow,
  pairedTransfers: readonly PossibleTransfer[] = suggestTransfers(ledger),
): boolean {
  if (pairedTransfers.some(({ outgoing, incoming }) => outgoing.id === row.id || incoming.id === row.id)) return false;
  const [year, month, day] = row.date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  target.setUTCDate(target.getUTCDate() + 3);
  const targetDate = target.toISOString().slice(0, 10);
  return !ledger.accounts.some((account) => account.id !== row.accountId &&
    accountCoverage(ledger, account.id).ranges.some((range) => range.to >= targetDate));
}

export function waitingReason(ledger: Ledger, row: BankRow): string | null {
  if (!isWaitingOnOtherAccount(ledger, row)) return null;
  const [year, month, day] = row.date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  target.setUTCDate(target.getUTCDate() + 3);
  return `Waiting for another account's import to reach ${target.toISOString().slice(0, 10)}`;
}

export function suggestTransfers(ledger: Ledger): PossibleTransfer[] {
  const rows = (ledger.bankRows ?? []).filter(isPending);
  const candidateCount = new Map<string, number>();
  const candidates: PossibleTransfer[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const first = rows[index];
    if (first.amountCents === 0) continue;
    for (let otherIndex = index + 1; otherIndex < rows.length; otherIndex += 1) {
      const second = rows[otherIndex];
      if (
        second.amountCents === 0 ||
        first.accountId === second.accountId ||
        Math.sign(first.amountCents) === Math.sign(second.amountCents) ||
        Math.abs(first.amountCents) !== Math.abs(second.amountCents) ||
        !withinThreeDays(first.date, second.date) ||
        first.dismissedTransferIds.includes(second.id) ||
        second.dismissedTransferIds.includes(first.id)
      ) continue;

      candidateCount.set(first.id, (candidateCount.get(first.id) ?? 0) + 1);
      candidateCount.set(second.id, (candidateCount.get(second.id) ?? 0) + 1);
      const outgoing = first.amountCents < 0 ? first : second;
      const incoming = first.amountCents > 0 ? first : second;
      candidates.push({ outgoing, incoming, amountCents: Math.abs(outgoing.amountCents) });
    }
  }

  return candidates
    .filter(({ outgoing, incoming }) =>
      candidateCount.get(outgoing.id) === 1 && candidateCount.get(incoming.id) === 1,
    )
    .sort((first, second) =>
      first.outgoing.date.localeCompare(second.outgoing.date) ||
      first.outgoing.id.localeCompare(second.outgoing.id),
    );
}

export function cardCycle(ledger: Ledger, paymentRow: BankRow): CardCycle | null {
  const account = ledger.accounts.find((item) => item.id === paymentRow.accountId);
  if (!account || account.type !== "credit") return null;

  const rows = (ledger.bankRows ?? []).filter((row) => row.accountId === paymentRow.accountId);
  const entries = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const previousPaymentDate = rows
    .filter((row) => row.id !== paymentRow.id && row.amountCents > 0 && row.date < paymentRow.date &&
      entries.get(row.entryId ?? "")?.kind === "transfer")
    .reduce((latest, row) => row.date > latest ? row.date : latest, "");
  const sum = sumCents(rows
    .filter((row) => row.date > previousPaymentDate && row.date <= paymentRow.date && row.amountCents < 0)
    .map((row) => Math.abs(row.amountCents)));

  return { sumCents: sum, differenceCents: paymentRow.amountCents - sum };
}

export function confirmTransfer(
  ledger: Ledger,
  outgoing: BankRow,
  incoming: BankRow,
  choice?: TransferChoice,
): Ledger | null {
  const rows = ledger.bankRows ?? [];
  const currentOutgoing = rows.find((row) => row.id === outgoing.id);
  const currentIncoming = rows.find((row) => row.id === incoming.id);
  if (
    !currentOutgoing || !currentIncoming ||
    !isPending(currentOutgoing) || !isPending(currentIncoming) ||
    currentOutgoing.amountCents >= 0 || currentIncoming.amountCents <= 0 ||
    currentOutgoing.accountId === currentIncoming.accountId
  ) return null;

  const outgoingAccount = ledger.accounts.find((account) => account.id === currentOutgoing.accountId);
  const incomingAccount = ledger.accounts.find((account) => account.id === currentIncoming.accountId);
  if (!outgoingAccount || !incomingAccount) return null;

  const now = new Date().toISOString();
  const amountCents = Math.abs(currentOutgoing.amountCents);
  if (outgoingAccount.payerEntityId === incomingAccount.payerEntityId) {
    const entry: Entry = {
      id: crypto.randomUUID(),
      kind: "transfer",
      date: currentOutgoing.date,
      description: currentOutgoing.description || currentIncoming.description || "Transfer",
      amountCents,
      payerEntityId: outgoingAccount.payerEntityId,
      accountId: null,
      portions: [],
      bankRowIds: [currentOutgoing.id, currentIncoming.id],
      countsTowardDebt: false,
      updatedAt: now,
    };
    return {
      ...ledger,
      entries: [...ledger.entries, entry],
      bankRows: rows.map((row) => row.id === currentOutgoing.id || row.id === currentIncoming.id
        ? { ...row, entryId: entry.id, updatedAt: now }
        : row),
    };
  }

  const isSelfAndHouse =
    (outgoingAccount.payerEntityId === SELF_ENTITY_ID && incomingAccount.payerEntityId === HOUSE_ENTITY_ID) ||
    (outgoingAccount.payerEntityId === HOUSE_ENTITY_ID && incomingAccount.payerEntityId === SELF_ENTITY_ID);
  if (!isSelfAndHouse || !choice) return null;

  if (choice === "contribution") {
    const entry: Entry = {
      id: crypto.randomUUID(),
      kind: "transfer",
      date: currentOutgoing.date,
      description: currentOutgoing.description || currentIncoming.description || "Transfer",
      amountCents,
      payerEntityId: outgoingAccount.payerEntityId,
      accountId: null,
      portions: [],
      bankRowIds: [currentOutgoing.id, currentIncoming.id],
      countsTowardDebt: false,
      updatedAt: now,
    };
    return {
      ...ledger,
      entries: [...ledger.entries, entry],
      bankRows: rows.map((row) => row.id === currentOutgoing.id || row.id === currentIncoming.id
        ? { ...row, entryId: entry.id, updatedAt: now }
        : row),
    };
  }

  const settlement: Settlement = {
    id: crypto.randomUUID(),
    date: currentOutgoing.date,
    entityId: HOUSE_ENTITY_ID,
    direction: outgoingAccount.payerEntityId === SELF_ENTITY_ID ? "youPaidThem" : "theyPaidYou",
    amountCents,
    bankRowIds: [currentOutgoing.id, currentIncoming.id],
    note: currentOutgoing.description || currentIncoming.description || "",
    splitwisePaymentId: null,
    updatedAt: now,
  };
  return {
    ...ledger,
    settlements: [...(ledger.settlements ?? []), settlement],
    bankRows: rows.map((row) => row.id === currentOutgoing.id || row.id === currentIncoming.id
      ? { ...row, settlementId: settlement.id, updatedAt: now }
      : row),
  };
}