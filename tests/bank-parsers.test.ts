import { expect, it } from "vitest";
import { parseBankCsv } from "../src/adapters/banks/parse-bank";

it("parses the four supported profiles without losing signed cents or raw fields", () => {
  const ing = parseBankCsv(
    "Date,Description,Credit,Debit,Balance\n3/10/2026,Synthetic groceries,,-0.01,100.00",
    "ing",
  );
  expect(ing.issues).toEqual([]);
  expect(ing.rows[0]).toMatchObject({
    date: "2026-10-03",
    amountCents: -1,
    balanceCents: 10000,
  });
  const hsbc = parseBankCsv(
    'Transaction Date,Description,Amount,Balance,\n 3 Oct 2026,Synthetic\u00a0purchase,"-1,000.01",',
    "hsbc",
  );
  expect(hsbc.issues).toEqual([]);
  expect(hsbc.rows[0]).toMatchObject({
    amountCents: -100001,
    balanceCents: null,
    description: "Synthetic\u00a0purchase",
    comparisonDescription: "Synthetic purchase",
  });
  for (const profile of ["anz-credit", "anz-transaction"] as const) {
    const anz = parseBankCsv(
      "3/10/2026,-15.18,TYPE,Synthetic merchant,-123456789,Message,,",
      profile,
    );
    expect(anz.issues).toEqual([]);
    expect(anz.rows[0].rawFields).toHaveLength(8);
    expect(anz.rows[0].rawFields[4]).toBe("-123456789");
    expect(anz.rows[0].amountCents).toBe(-1518);
    expect(anz.candidates).toEqual(["anz-credit", "anz-transaction"]);
  }
});

it("blocks conflicts, invalid dates, unexpected columns and malformed CSV without silent skips", () => {
  expect(
    parseBankCsv(
      "Date,Description,Credit,Debit\n31/2/2026,Synthetic,,1.00",
      "ing",
    ).issues,
  ).toHaveLength(1);
  expect(
    parseBankCsv(
      "Date,Description,Credit,Debit\n3/10/2026,Synthetic,1.00,-1.00",
      "ing",
    ).issues,
  ).toHaveLength(1);
  expect(
    parseBankCsv(
      "Transaction Date,Description,Amount,Balance,\n3 Oct 2026,Synthetic,-1.00,,unexpected",
      "hsbc",
    ).issues,
  ).toHaveLength(1);
  expect(
    parseBankCsv('3/10/2026,-1.00,"unclosed', "anz-credit").issues.length,
  ).toBeGreaterThan(0);
});
