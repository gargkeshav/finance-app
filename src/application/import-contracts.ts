import { z } from "zod";
import { bankDateSchema, centsSchema } from "../domain/value";

export const bankProfileSchema = z.enum([
  "ing",
  "hsbc",
  "anz-credit",
  "anz-transaction",
]);
export type BankProfile = z.infer<typeof bankProfileSchema>;
export const bankProfileNames: Record<BankProfile, string> = {
  ing: "ING transaction",
  hsbc: "HSBC",
  "anz-credit": "ANZ credit card",
  "anz-transaction": "ANZ transaction",
};
export const observationSchema = z
  .object({
    ordinal: z.number().int().positive(),
    rawFields: z.array(z.string()).min(1).max(50),
    date: bankDateSchema,
    description: z.string(),
    comparisonDescription: z.string(),
    amountCents: centsSchema,
    balanceCents: centsSchema.nullable(),
    currency: z.literal("AUD"),
  })
  .strict();
export type BankObservation = z.infer<typeof observationSchema>;
const idSchema = z.uuidv4().refine((id) => id === id.toLowerCase());
export const bankEventSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    date: bankDateSchema,
    description: z.string(),
    comparisonDescription: z.string(),
    amountCents: centsSchema,
    balanceCents: centsSchema.nullable(),
    currency: z.literal("AUD"),
  })
  .strict();
export type BankEvent = z.infer<typeof bankEventSchema>;
export const bankImportSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    profile: bankProfileSchema,
    fileName: z.string().min(1).max(255),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    headers: z.array(z.string()).nullable(),
    originalBase64: z.string().max(7_000_000).nullable(),
    rows: z
      .array(
        z
          .object({
            observation: observationSchema,
            eventId: idSchema,
            decision: z.enum(["new", "existing"]),
            rejectedEventIds: z.array(idSchema).max(10_000).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      new Set(record.rows.map((row) => row.observation.ordinal)).size !==
        record.rows.length ||
      new Set(record.rows.map((row) => row.eventId)).size !== record.rows.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Each source occurrence must map to a distinct event within one import.",
      });
    }
    for (const [index, row] of record.rows.entries()) {
      if (
        new Set(row.rejectedEventIds).size !== row.rejectedEventIds.length ||
        row.rejectedEventIds.includes(row.eventId) ||
        (row.decision === "existing" && row.rejectedEventIds.length > 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["rows", index, "rejectedEventIds"],
          message:
            "Rejected candidates must be unique and distinct from the selected event.",
        });
      }
    }
  });
export type BankImport = z.infer<typeof bankImportSchema>;
export interface ParseIssue {
  row: number | null;
  message: string;
}
export interface BankPreview {
  profile: BankProfile;
  candidates: BankProfile[];
  headers: string[] | null;
  rows: BankObservation[];
  issues: ParseIssue[];
  warnings: string[];
}
