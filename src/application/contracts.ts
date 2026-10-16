import { z } from "zod";
import { bankEventSchema, bankImportSchema } from "./import-contracts";
import {
  bankDateSchema,
  centsSchema,
  currencySchema,
  sumCents,
} from "../domain/value";

const idSchema = z
  .uuidv4()
  .refine((id) => id === id.toLowerCase(), "Use a canonical lowercase UUID.");

export const accountSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["asset", "credit"]),
    role: z.enum(["personal", "common"]),
    currency: currencySchema,
    openingBalanceCents: centsSchema.nullable(),
    openingDate: bankDateSchema.nullable(),
    version: z.literal(1),
  })
  .strict()
  .refine(
    (account) =>
      (account.openingBalanceCents === null) === (account.openingDate === null),
    {
      message:
        "Opening balance and date must be supplied together, or both unknown.",
    },
  );

export const allocationSchema = z
  .object({
    id: idSchema,
    bucket: z.enum(["personal", "house"]),
    personId: z.null(),
    amountCents: centsSchema.refine((amount) => amount > 0),
  })
  .strict();

export const expenseSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    date: bankDateSchema,
    description: z.string().trim().min(1).max(300),
    currency: currencySchema,
    amountCents: centsSchema.refine((amount) => amount > 0),
    allocations: z.array(allocationSchema).min(1).max(100),
    version: z.literal(1),
  })
  .strict()
  .superRefine((expense, context) => {
    if (
      sumCents(expense.allocations.map((line) => line.amountCents)) !==
      expense.amountCents
    ) {
      context.addIssue({
        code: "custom",
        message: "Allocation total must equal the expense.",
      });
    }
    if (
      new Set(expense.allocations.map((line) => line.id)).size !==
      expense.allocations.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Allocation IDs must be unique.",
      });
    }
  });

export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(4),
    epoch: idSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    accounts: z.array(accountSchema),
    expenses: z.array(expenseSchema),
    imports: z.array(bankImportSchema).default([]),
    bankEvents: z.array(bankEventSchema).default([]),
    reversals: z
      .array(
        z
          .object({
            expenseId: idSchema,
            reason: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .default([]),
    auditCount: z.number().int().nonnegative(),
  })
  .strict();

export const commandSchema = z
  .object({
    commandId: idSchema,
    expectedEpoch: idSchema,
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    operation: z.discriminatedUnion("type", [
      z
        .object({ type: z.literal("commitImport"), import: bankImportSchema })
        .strict(),
      z
        .object({
          type: z.literal("reconcileImport"),
          importId: idSchema,
          ordinal: z.number().int().positive(),
          expectedEventId: idSchema,
          candidateEventId: idSchema,
          reason: z.string().trim().min(1).max(300),
        })
        .strict(),
      z
        .object({ type: z.literal("createAccount"), account: accountSchema })
        .strict(),
      z
        .object({ type: z.literal("createExpense"), expense: expenseSchema })
        .strict(),
      z
        .object({
          type: z.literal("reverseExpense"),
          expenseId: idSchema,
          reason: z.string().trim().min(1).max(300),
        })
        .strict(),
      z
        .object({
          type: z.literal("correctExpense"),
          expenseId: idSchema,
          reason: z.string().trim().min(1).max(300),
          replacement: expenseSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export type Account = z.infer<typeof accountSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type LedgerCommand = z.infer<typeof commandSchema>;

export interface Ledger {
  read(): Promise<Snapshot>;
  execute(command: LedgerCommand): Promise<Snapshot>;
  resolve(command: LedgerCommand): Promise<Snapshot | null>;
  exportData?(): Promise<boolean>;
  restoreData?(
    expectedEpoch: string,
    expectedRevision: number,
    confirmed: boolean,
  ): Promise<{ snapshot: Snapshot; safetyFile: string } | null>;
}
