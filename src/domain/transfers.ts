import {
  HOUSE_ENTITY_ID,
  SELF_ENTITY_ID,
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
  const previousPaymentDate = rows
    .filter((row) => row.id !== paymentRow.id && row.amountCents > 0 && row.date < paymentRow.date)
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