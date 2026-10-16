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

export interface HouseClaimExpense {
  id: string;
  accountId: string;
  date: string;
  description: string;
  allocations: readonly SpendingLine[];
}

export interface ClaimFundingAccount {
  id: string;
  role: "personal" | "common";
}

export interface HouseClaim {
  expenseId: string;
  date: string;
  description: string;
  paidFromAccountId: string;
  amountCents: bigint;
  outstandingCents: bigint;
  appliedCents: bigint;
}

export interface HouseClaimApplication {
  expenseId: string;
  amountCents: number;
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

export function calculateHouseClaims(
  expenses: readonly HouseClaimExpense[],
  accounts: readonly ClaimFundingAccount[],
  reversedExpenseIds: ReadonlySet<string> = new Set(),
  applications: readonly HouseClaimApplication[] = [],
): HouseClaim[] {
  const accountRoles = new Map(
    accounts.map((account) => [account.id, account.role]),
  );
  const appliedByExpense = new Map<string, bigint>();
  for (const application of applications) {
    appliedByExpense.set(
      application.expenseId,
      (appliedByExpense.get(application.expenseId) ?? 0n) +
        BigInt(application.amountCents),
    );
  }
  const claims: HouseClaim[] = [];
  for (const expense of expenses) {
    if (
      reversedExpenseIds.has(expense.id) ||
      accountRoles.get(expense.accountId) !== "personal"
    )
      continue;
    const amountCents = expense.allocations
      .filter((line) => line.bucket === "house")
      .reduce((total, line) => total + BigInt(line.amountCents), 0n);
    const appliedCents = appliedByExpense.get(expense.id) ?? 0n;
    const outstandingCents = amountCents - appliedCents;
    if (outstandingCents <= 0n) continue;
    claims.push({
      expenseId: expense.id,
      date: expense.date,
      description: expense.description,
      paidFromAccountId: expense.accountId,
      amountCents,
      appliedCents,
      outstandingCents,
    });
  }
  return claims;
}
