import {
  commandSchema,
  snapshotSchema,
  type Ledger,
  type LedgerCommand,
  type Snapshot,
} from "../application/contracts";

export class SyntheticLedger implements Ledger {
  private snapshot: Snapshot = {
    schemaVersion: 3,
    epoch: crypto.randomUUID(),
    revision: 0,
    accounts: [],
    expenses: [],
    imports: [],
    bankEvents: [],
    reversals: [],
    auditCount: 0,
  };
  private completed = new Map<string, string>();

  async read() {
    return structuredClone(this.snapshot);
  }

  async resolve(command: LedgerCommand) {
    const parsed = commandSchema.parse(command);
    const previous = this.completed.get(parsed.commandId);
    if (!previous) return null;
    if (previous !== JSON.stringify(parsed))
      throw new Error("Command identity conflict.");
    return this.read();
  }

  async execute(input: LedgerCommand) {
    const command = commandSchema.parse(input);
    const previous = this.completed.get(command.commandId);
    if (previous) {
      if (previous !== JSON.stringify(command))
        throw new Error("Command identity conflict.");
      return this.read();
    }
    if (
      command.expectedEpoch !== this.snapshot.epoch ||
      command.expectedRevision !== this.snapshot.revision
    )
      throw new Error("The ledger changed. Reload before saving.");
    const next = structuredClone(this.snapshot);
    if (command.operation.type === "commitImport") {
      const record = command.operation.import;
      if (!next.accounts.some((account) => account.id === record.accountId))
        throw new Error("Account not found.");
      const exact = next.imports.find(
        (previous) =>
          previous.accountId === record.accountId &&
          previous.profile === record.profile &&
          previous.contentHash === record.contentHash,
      );
      if (!exact) {
        for (const row of record.rows) {
          const event = next.bankEvents.find(
            (event) => event.id === row.eventId,
          );
          if (row.decision === "existing") {
            if (
              !event ||
              event.accountId !== record.accountId ||
              event.date !== row.observation.date ||
              event.amountCents !== row.observation.amountCents ||
              event.comparisonDescription !==
                row.observation.comparisonDescription
            )
              throw new Error("Selected match is no longer compatible.");
          } else {
            if (event) throw new Error("Event identity already exists.");
            const {
              date,
              description,
              comparisonDescription,
              amountCents,
              balanceCents,
              currency,
            } = row.observation;
            next.bankEvents.push({
              id: row.eventId,
              accountId: record.accountId,
              date,
              description,
              comparisonDescription,
              amountCents,
              balanceCents,
              currency,
            });
          }
        }
        next.imports.push(record);
      }
    } else if (command.operation.type === "createAccount") {
      const newAccount = command.operation.account;
      if (next.accounts.some((account) => account.id === newAccount.id))
        throw new Error("Account already exists.");
      next.accounts.push(newAccount);
    } else if (command.operation.type === "reverseExpense") {
      const { expenseId, reason } = command.operation;
      if (!next.expenses.some((expense) => expense.id === expenseId))
        throw new Error("Expense not found.");
      if (next.reversals.some((reversal) => reversal.expenseId === expenseId))
        throw new Error("Expense is already reversed.");
      next.reversals.push({ expenseId, reason });
    } else {
      const operation = command.operation;
      if (operation.type === "correctExpense") {
        if (
          !next.expenses.some((expense) => expense.id === operation.expenseId)
        )
          throw new Error("Expense not found.");
        if (
          next.reversals.some(
            (reversal) => reversal.expenseId === operation.expenseId,
          )
        )
          throw new Error("Expense is already reversed.");
        next.reversals.push({
          expenseId: operation.expenseId,
          reason: operation.reason,
        });
      }
      const expense =
        operation.type === "correctExpense"
          ? operation.replacement
          : operation.expense;
      if (!next.accounts.some((account) => account.id === expense.accountId))
        throw new Error("Account not found.");
      if (next.expenses.some((existing) => existing.id === expense.id))
        throw new Error("Expense already exists.");
      const allocationIds = new Set(
        next.expenses.flatMap((existing) =>
          existing.allocations.map((line) => line.id),
        ),
      );
      if (expense.allocations.some((line) => allocationIds.has(line.id)))
        throw new Error("Allocation already exists.");
      next.expenses.push(expense);
    }
    next.revision += 1;
    next.auditCount += 1;
    this.snapshot = snapshotSchema.parse(next);
    this.completed.set(command.commandId, JSON.stringify(command));
    return this.read();
  }
}
