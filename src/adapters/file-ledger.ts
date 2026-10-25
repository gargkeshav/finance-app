import { z } from "zod";
import { type Category, type CategoryMemory, type Ledger, type SplitPreset, validateSpend } from "../domain/ledger";
import type { EntryRule } from "../domain/rules";
import { bankDateSchema, centsSchema } from "../domain/value";
import { csvMappingSchema, type CsvMapping } from "./csv-mapping";

const idSchema = z.string().min(1, "must not be empty");
const updatedAtSchema = z.string().min(1, "must not be empty");

declare module "../domain/ledger" {
  interface Entity {
    splitwise?: { kind: "user" | "group"; id: string };
  }

  interface Entry {
    splitwiseExpenseId?: string | null;
  }

  interface Ledger {
    splitwiseSync?: SplitwiseSync[];
    splitwiseInbox?: SplitwiseInbox[];
    splitwisePosts?: SplitwisePost[];
  }

}

interface SplitwiseSync {
  id: string;
  entityId: string;
  lastPulledAt: string;
  updatedAt: string;
}

interface SplitwiseInbox {
  id: string;
  splitwiseExpenseId: string;
  entityId: string;
  date: string;
  description: string;
  costCents: number;
  yourPaidCents: number;
  yourOwedCents: number;
  isPayment: boolean;
  status: "new" | "changed" | "deleted" | "done" | "dismissed";
  updatedAt: string;
  previous?: {
    date: string;
    description: string;
    costCents: number;
    yourPaidCents: number;
    yourOwedCents: number;
  };
}

interface SplitwisePost {
  id: string;
  entryId: string;
  entityId: string;
  state: "posting" | "posted" | "unknown";
  splitwiseExpenseId: string | null;
  remoteUpdatedAt?: string | null;
  updatedAt: string;
}

const splitwiseLinkSchema = z.object({ kind: z.enum(["user", "group"]), id: idSchema });
const splitwiseSyncSchema = z.object({
  id: idSchema,
  entityId: idSchema,
  lastPulledAt: updatedAtSchema,
  updatedAt: updatedAtSchema,
});
const splitwiseInboxSchema = z.object({
  id: idSchema,
  splitwiseExpenseId: idSchema,
  entityId: idSchema,
  date: bankDateSchema,
  description: z.string(),
  costCents: centsSchema.nonnegative(),
  yourPaidCents: centsSchema.nonnegative(),
  yourOwedCents: centsSchema.nonnegative(),
  isPayment: z.boolean(),
  status: z.enum(["new", "changed", "deleted", "done", "dismissed"]),
  updatedAt: updatedAtSchema,
  previous: z.object({
    date: bankDateSchema,
    description: z.string(),
    costCents: centsSchema.nonnegative(),
    yourPaidCents: centsSchema.nonnegative(),
    yourOwedCents: centsSchema.nonnegative(),
  }).optional(),
});
const splitwisePostSchema = z.object({
  id: idSchema,
  entryId: idSchema,
  entityId: idSchema,
  state: z.enum(["posting", "posted", "unknown"]),
  splitwiseExpenseId: idSchema.nullable(),
  remoteUpdatedAt: updatedAtSchema.nullable().optional(),
  updatedAt: updatedAtSchema,
});

const entitySchema = z.object({
  id: idSchema,
  kind: z.enum(["self", "house", "person", "group"]),
  name: z.string().min(1, "must not be empty"),
  archived: z.boolean(),
  updatedAt: updatedAtSchema,
  splitwise: splitwiseLinkSchema.optional(),
});

const accountSchema = z.object({
  id: idSchema,
  name: z.string().min(1, "must not be empty"),
  type: z.enum(["asset", "credit"]),
  payerEntityId: idSchema,
  mappingId: idSchema.optional(),
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
    refundOf: idSchema.nullable().optional(),
    bankRowIds: z.array(idSchema).default([]),
    categoryId: idSchema.nullable().default(null),
    tags: z.array(z.string()).default([]),
    note: z.string().default(""),
    extraReimbursable: z.boolean().default(false),
    countsTowardDebt: z.boolean(),
    updatedAt: updatedAtSchema,
    splitwiseExpenseId: idSchema.nullable().optional(),
    source: z.enum(["manual", "bank", "splitwise", "rule", "memory", "history"]).optional(),
    ruleId: idSchema.optional(),
    displayName: z.string().optional(),
  })
  .superRefine((entry, context) => {
    if ((entry.kind === "spend" || entry.kind === "refund") && !validateSpend({ ...entry, kind: "spend" })) {
      context.addIssue({
        code: "custom",
        message: "Spend and refund portions must be unique, positive, and sum to the amount.",
        path: ["portions"],
      });
    }
    if (entry.kind === "refund" && !entry.refundOf) {
      context.addIssue({ code: "custom", message: "A refund must reference a spend.", path: ["refundOf"] });
    }
  });

const baselineSchema = z.object({
  id: idSchema,
  entityId: idSchema,
  amountCents: centsSchema,
  updatedAt: updatedAtSchema,
});

const settlementSchema = z.object({
  id: idSchema,
  date: bankDateSchema,
  entityId: idSchema,
  direction: z.enum(["theyPaidYou", "youPaidThem"]),
  amountCents: centsSchema.positive(),
  bankRowIds: z.array(idSchema).default([]),
  note: z.string(),
  splitwisePaymentId: idSchema.nullable().default(null),
  updatedAt: updatedAtSchema,
});

const importSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  mappingId: idSchema,
  fileName: z.string(),
  contentHash: z.string(),
  dateFrom: bankDateSchema.nullable(),
  dateTo: bankDateSchema.nullable(),
  countsTowardDebt: z.boolean(),
  importedAt: updatedAtSchema,
  updatedAt: updatedAtSchema,
});

const bankRowSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  importId: idSchema,
  line: z.number().int().positive(),
  date: bankDateSchema,
  description: z.string(),
  amountCents: centsSchema,
  balanceCents: centsSchema.nullable(),
  raw: z.array(z.string()),
  entryId: idSchema.nullable(),
  settlementId: idSchema.nullable(),
  skipped: z.boolean().default(false),
  dismissedTransferIds: z.array(idSchema).default([]),
  updatedAt: updatedAtSchema,
});

const checkpointSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  date: bankDateSchema,
  balanceCents: centsSchema,
  note: z.string(),
  updatedAt: updatedAtSchema,
});

const categorySchema = z.object({
  id: idSchema,
  name: z.string().min(1, "must not be empty"),
  archived: z.boolean(),
  updatedAt: updatedAtSchema,
});

const categoryMemorySchema = z.object({
  id: idSchema,
  key: z.string(),
  categoryId: idSchema,
  entityId: idSchema.nullable(),
  updatedAt: updatedAtSchema,
});

const splitPresetSchema: z.ZodType<SplitPreset> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("payer") }),
  z.object({ kind: z.literal("halfHouse") }),
  z.object({ kind: z.literal("allHouse") }),
  z.object({ kind: z.literal("entity"), entityId: idSchema }),
  z.object({ kind: z.literal("equal"), entityIds: z.array(idSchema).min(1) }),
]);

const ruleSchema: z.ZodType<EntryRule> = z.object({
  id: idSchema,
  name: z.string().min(1, "must not be empty"),
  order: z.number().int(),
  enabled: z.boolean(),
  match: z.object({
    text: z.string(),
    mode: z.enum(["contains", "startsWith"]),
    accountId: idSchema.nullable(),
    sign: z.enum(["out", "in", "any"]),
    minCents: centsSchema.nonnegative().nullable(),
    maxCents: centsSchema.nonnegative().nullable(),
  }),
  action: z.object({
    displayName: z.string().nullable(),
    categoryId: idSchema.nullable(),
    split: splitPresetSchema.nullable(),
    tags: z.array(z.string()),
  }),
  autoConfirm: z.boolean().default(false),
  updatedAt: updatedAtSchema,
});

type PersistedLedger = Omit<Ledger, "accounts" | "entries"> & {
  accounts: (Ledger["accounts"][number] & { mappingId?: string })[];
  entries: (Ledger["entries"][number] & { bankRowIds: string[] })[];
  mappings: CsvMapping[];
  imports: z.infer<typeof importSchema>[];
  bankRows: z.infer<typeof bankRowSchema>[];
  settlements: z.infer<typeof settlementSchema>[];
  checkpoints: z.infer<typeof checkpointSchema>[];
  categories: Category[];
  categoryMemory: CategoryMemory[];
};

const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(entitySchema).default([]),
  accounts: z.array(accountSchema).default([]),
  entries: z.array(entrySchema).default([]),
  baselines: z.array(baselineSchema).default([]),
  settlements: z.array(settlementSchema).default([]),
  mappings: z.array(csvMappingSchema).default([]),
  imports: z.array(importSchema).default([]),
  bankRows: z.array(bankRowSchema).default([]),
  checkpoints: z.array(checkpointSchema).default([]),
  splitwiseSync: z.array(splitwiseSyncSchema).default([]),
  splitwiseInbox: z.array(splitwiseInboxSchema).default([]),
  splitwisePosts: z.array(splitwisePostSchema).default([]),
  categories: z.array(categorySchema).default([]),
  categoryMemory: z.array(categoryMemorySchema).default([]),
  rules: z.array(ruleSchema).default([]),
  lastSplitByAccount: z.record(z.string(), splitPresetSchema).optional(),
}).superRefine((ledger, context) => {
  for (const entry of ledger.entries) {
    if (entry.kind === "refund" && entry.refundOf) {
      const original = ledger.entries.find((candidate) => candidate.id === entry.refundOf);
      if (original?.kind !== "spend") {
        context.addIssue({ code: "custom", message: "A refund must reference an existing spend.", path: ["entries"] });
      }
    }
    if (entry.kind !== "spend" || !entry.bankRowIds.length) continue;
    const linkedRows = ledger.bankRows.filter((row) => entry.bankRowIds.includes(row.id));
    if (linkedRows.length && Math.abs(linkedRows.reduce((total, row) => total + row.amountCents, 0)) !== entry.amountCents && !entry.note.trim()) {
      context.addIssue({ code: "custom", message: "A note is required when a spend amount differs from its bank rows.", path: ["entries"] });
    }
  }
});

export function emptyLedger(): PersistedLedger {
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
    settlements: [],
    mappings: [],
    imports: [],
    bankRows: [],
    checkpoints: [],
    categories: [],
    categoryMemory: [],
    rules: [],
  };
}

function formatValidationError(message: string, issues: z.ZodIssue[]): Error {
  const details = issues
    .map((issue) => `${issue.path.join(".") || "ledger"}: ${issue.message}`)
    .join("; ");
  return new Error(`${message}: ${details}`);
}

export function parseLedger(text: string): PersistedLedger {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The ledger file is not valid JSON.");
  }

  const result = ledgerSchema.safeParse(migrate(value));
  if (!result.success) {
    throw formatValidationError("The ledger file is invalid", result.error.issues);
  }
  return result.data;
}

function migrate(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version === 1) return raw;
  if (typeof version === "number" && version > 1) {
    throw new Error(`This ledger uses schema version ${version}, which this app does not support.`);
  }
  return raw;
}

export function ledgerProblem(ledger: Ledger): string | null {
  const result = ledgerSchema.safeParse(ledger);
  return result.success
    ? null
    : formatValidationError("The ledger cannot be saved", result.error.issues).message;
}

export function stringifyLedger(ledger: Ledger): string {
  const result = ledgerSchema.safeParse(ledger);
  if (!result.success) {
    throw formatValidationError("The ledger cannot be saved", result.error.issues);
  }
  return JSON.stringify(result.data, null, 2);
}