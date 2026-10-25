import { describe, expect, it } from "vitest";
import { BANK_PRESETS, findNewRows, parseWithMapping } from "../src/adapters/csv-mapping";

describe("CSV mappings", () => {
  it("parses the HSBC quoted amount and leading-space date", () => {
    const mapping = BANK_PRESETS.find((preset) => preset.id === "hsbc")!;
    const result = parseWithMapping(
      'Transaction Date,Description,Amount\n" 1 Jan 2024",Groceries,"1,234.56"',
      mapping,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        date: "2024-01-01",
        description: "Groceries",
        amountCents: 123456,
        balanceCents: null,
        raw: [" 1 Jan 2024", "Groceries", "1,234.56"],
      },
    ]);
  });

  it("matches duplicate rows by occurrence count", () => {
    const row = {
      line: 2,
      date: "2024-01-01",
      description: "Groceries",
      amountCents: -1234,
      balanceCents: null,
      raw: ["01/01/2024", "-12.34", "Groceries"],
    };
    const parsed = [row, { ...row, line: 3 }, { ...row, line: 4 }];

    expect(findNewRows([row, { ...row, line: 9 }], parsed)).toEqual([
      { ...row, line: 4 },
    ]);
  });
});