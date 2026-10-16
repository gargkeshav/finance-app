import { describe, expect, it } from "vitest";
import {
  accountSchema,
  commandSchema,
  expenseSchema,
} from "../src/application/contracts";
import {
  formatAud,
  formatAudTotal,
  isBankDate,
  parseAud,
  sumCents,
} from "../src/domain/value";

describe("AUD boundary", () => {
  it("converts exact cents without floating-point arithmetic", () => {
    expect(parseAud("586.32")).toBe(58632);
    expect(parseAud("-0.01")).toBe(-1);
    expect(sumCents([41940, 16692])).toBe(58632);
    expect(formatAud(1518)).toBe("AUD 15.18");
  });
  it.each(["1.001", "NaN", "1e3", "1,000", "", " 2", "90071992547409.92"])(
    "rejects invalid money %s",
    (text) => {
      expect(() => parseAud(text)).toThrow();
    },
  );
  it("rejects overflow in totals", () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it("formats large ledger aggregates exactly without a render-time overflow", () => {
    expect(formatAudTotal([Number.MAX_SAFE_INTEGER, 1])).toBe(
      "AUD 90071992547409.92",
    );
    expect(formatAudTotal([-1])).toBe("AUD -0.01");
  });
});

describe("date-only boundary", () => {
  it.each(["2024-02-29", "2026-10-03", "2000-02-29"])(
    "accepts %s without timezone conversion",
    (date) => {
      expect(isBankDate(date)).toBe(true);
    },
  );
  it.each([
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "03/10/2026",
    "2026-10-03T00:00:00Z",
  ])("rejects %s", (date) => {
    expect(isBankDate(date)).toBe(false);
  });
});

describe("command boundary", () => {
  it("rejects uppercase UUIDs just like the native boundary", () => {
    expect(
      accountSchema.safeParse({
        id: "ABCDEFAB-1234-4ABC-8ABC-ABCDEFABCDEF",
        name: "Synthetic",
        kind: "asset",
        role: "personal",
        currency: "AUD",
        openingBalanceCents: null,
        openingDate: null,
        version: 1,
      }).success,
    ).toBe(false);
  });
  const expense = {
    id: "00000000-0000-4000-8000-000000000001",
    accountId: "00000000-0000-4000-8000-000000000002",
    date: "2026-10-03",
    description: "Synthetic purchase",
    currency: "AUD",
    amountCents: 12000,
    allocations: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        bucket: "house",
        personId: null,
        amountCents: 12000,
      },
    ],
    version: 1,
  };
  it("accepts a balanced manual expense", () => {
    expect(expenseSchema.parse(expense).amountCents).toBe(12000);
  });
  it("rejects unbalanced allocations and unsupported currency", () => {
    expect(
      expenseSchema.safeParse({ ...expense, amountCents: 12001 }).success,
    ).toBe(false);
    expect(
      expenseSchema.safeParse({ ...expense, currency: "USD" }).success,
    ).toBe(false);
  });
  it("does not expose arbitrary SQL or filesystem operations", () => {
    expect(
      commandSchema.safeParse({
        commandId: expense.id,
        expectedRevision: 0,
        operation: { type: "sql", sql: "DELETE FROM accounts" },
      }).success,
    ).toBe(false);
  });
});
