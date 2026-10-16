import Decimal from "decimal.js";
import { z } from "zod";

export const centsSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const currencySchema = z.literal("AUD");

export function parseAud(text: string): number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Enter an AUD amount with at most two decimal places.");
  }
  const cents = new Decimal(text).times(100);
  if (!cents.isInteger() || cents.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is outside the supported range.");
  }
  return centsSchema.parse(cents.toNumber());
}

export function formatAud(cents: number): string {
  centsSchema.parse(cents);
  return `AUD ${new Decimal(cents).dividedBy(100).toFixed(2)}`;
}

export function sumCents(amounts: readonly number[]): number {
  const total = amounts.reduce(
    (sum, amount) => sum + BigInt(centsSchema.parse(amount)),
    0n,
  );
  return centsSchema.parse(Number(total));
}

export function formatAudTotal(amounts: readonly number[]): string {
  const total = amounts.reduce(
    (sum, amount) => sum + BigInt(centsSchema.parse(amount)),
    0n,
  );
  return formatAudBigInt(total);
}

export function formatAudBigInt(total: bigint): string {
  const absolute = total < 0n ? -total : total;
  return `AUD ${total < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function isBankDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1900 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]
  );
}

export const bankDateSchema = z
  .string()
  .refine(isBankDate, "Enter a valid date from 1900 onward (YYYY-MM-DD).");
