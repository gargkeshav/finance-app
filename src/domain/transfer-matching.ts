import type { BankEvent } from "../application/import-contracts";

export interface PossibleTransfer {
  outgoing: BankEvent;
  incoming: BankEvent;
  amountCents: number;
}

interface TransferGroup {
  outgoing: BankEvent[];
  incoming: BankEvent[];
  amountCents: number;
}

export function findPossibleTransfers(
  events: readonly BankEvent[],
): PossibleTransfer[] {
  const groups = new Map<string, TransferGroup>();
  for (const event of events) {
    if (event.amountCents === 0) continue;
    const amount = BigInt(event.amountCents);
    const absoluteAmount = amount < 0n ? -amount : amount;
    const key = `${event.date}:${absoluteAmount}`;
    const group = groups.get(key) ?? {
      outgoing: [],
      incoming: [],
      amountCents: Number(absoluteAmount),
    };
    (amount < 0n ? group.outgoing : group.incoming).push(event);
    groups.set(key, group);
  }

  const suggestions: PossibleTransfer[] = [];
  for (const group of groups.values()) {
    if (group.outgoing.length !== 1 || group.incoming.length !== 1) continue;
    const [outgoing] = group.outgoing;
    const [incoming] = group.incoming;
    if (outgoing.accountId === incoming.accountId) continue;
    suggestions.push({
      outgoing,
      incoming,
      amountCents: group.amountCents,
    });
  }
  return suggestions.sort(
    (left, right) =>
      left.outgoing.date.localeCompare(right.outgoing.date) ||
      left.outgoing.id.localeCompare(right.outgoing.id),
  );
}
