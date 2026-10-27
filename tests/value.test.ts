import { describe, expect, it } from "vitest";
import {
  formatMoney,
  isBankDate,
  parseAud,
  sumCents,
} from "../src/domain/value";

describe("AUD boundary", () => {
  it("converts exact cents without floating-point arithmetic", () => {
    expect(parseAud("586.32")).toBe(58632);
    expect(parseAud("-0.01")).toBe(-1);
    expect(sumCents([41940, 16692])).toBe(58632);
    expect(formatMoney(1518)).toBe("$15.18");
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
