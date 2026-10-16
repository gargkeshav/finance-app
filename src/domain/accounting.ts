export interface SpendingLine {
  bucket: "personal" | "house";
  amountCents: number;
}

export interface SpendingExpense {
  id: string;
  amountCents: number;
  allocations: readonly SpendingLine[];
}

export interface SpendingSummary {
  grossCents: bigint;
  houseCents: bigint;
  attributedCents: bigint;
}

export function calculateSpendingSummary(
  expenses: readonly SpendingExpense[],
  reversedExpenseIds: ReadonlySet<string> = new Set(),
): SpendingSummary {
  let grossCents = 0n;
  let houseCents = 0n;
  let personalCents = 0n;
  for (const expense of expenses) {
    if (reversedExpenseIds.has(expense.id)) continue;
    grossCents += BigInt(expense.amountCents);
    for (const line of expense.allocations) {
      if (line.bucket === "house") houseCents += BigInt(line.amountCents);
      else personalCents += BigInt(line.amountCents);
    }
  }
  return {
    grossCents,
    houseCents,
    attributedCents: personalCents + (houseCents + 1n) / 2n,
  };
}
