import { z } from "zod";
import { type Ledger, validateSpend } from "../domain/ledger";
import { bankDateSchema, centsSchema } from "../domain/value";

const idSchema = z.string().min(1, "must not be empty");
const updatedAtSchema = z.string().min(1, "must not be empty");

const entitySchema = z.object({
  id: idSchema,
  kind: z.enum(["self", "house", "person", "group"]),
  name: z.string().min(1, "must not be empty"),
  archived: z.boolean(),
  updatedAt: updatedAtSchema,
});

const accountSchema = z.object({
  id: idSchema,
  name: z.string().min(1, "must not be empty"),
  type: z.enum(["asset", "credit"]),
  payerEntityId: idSchema,
  updatedAt: updatedAtSchema,
});

const portionSchema = z.object({
  entityId: idSchema,
  amountCents: centsSchema.positive(),
});

const entrySchema = z
  .object({
    id: idSchema,
    kind: z.enum(["spend", "transfer", "income", "refund"]),
    date: bankDateSchema,
    description: z.string(),
    amountCents: centsSchema.positive(),
    payerEntityId: idSchema,
    accountId: idSchema.nullable(),
    portions: z.array(portionSchema),
    countsTowardDebt: z.boolean(),
    updatedAt: updatedAtSchema,
  })
  .superRefine((entry, context) => {
    if (entry.kind === "spend" && !validateSpend(entry)) {
      context.addIssue({
        code: "custom",
        message: "Spend portions must be unique, positive, and sum to the amount.",
        path: ["portions"],
      });
    }
  });

const baselineSchema = z.object({
  id: idSchema,
  entityId: idSchema,
  amountCents: centsSchema,
  updatedAt: updatedAtSchema,
});

const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(entitySchema).default([]),
  accounts: z.array(accountSchema).default([]),
  entries: z.array(entrySchema).default([]),
  baselines: z.array(baselineSchema).default([]),
});

export function emptyLedger(): Ledger {
  const updatedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    entities: [
      { id: "self", kind: "self", name: "You", archived: false, updatedAt },
      { id: "house", kind: "house", name: "House", archived: false, updatedAt },
    ],
    accounts: [],
    entries: [],
    baselines: [],
  };
}

function formatValidationError(message: string, issues: z.ZodIssue[]): Error {
  const details = issues
    .map((issue) => `${issue.path.join(".") || "ledger"}: ${issue.message}`)
    .join("; ");
  return new Error(`${message}: ${details}`);
}

export function parseLedger(text: string): Ledger {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The ledger file is not valid JSON.");
  }

  const result = ledgerSchema.safeParse(value);
  if (!result.success) {
    throw formatValidationError("The ledger file is invalid", result.error.issues);
  }
  return result.data;
}

export function stringifyLedger(ledger: Ledger): string {
  const result = ledgerSchema.safeParse(ledger);
  if (!result.success) {
    throw formatValidationError("The ledger cannot be saved", result.error.issues);
  }
  return JSON.stringify(result.data, null, 2);
}