import { describe, expect, it } from "vitest";
import { balances, report, type Entry, type Ledger } from "../src/domain/ledger";

function makeLedger(entry: Entry): Ledger {
  return {
    schemaVersion: 1,
    entities: [
      { id: "self", kind: "self", name: "You", archived: false, updatedAt: "now" },
      { id: "house", kind: "house", name: "House", archived: false, updatedAt: "now" },
    ],
    accounts: [],
    entries: [entry],
    baselines: [],
  };
}

describe("ledger spending rules", () => {
  it("tracks House owing you on your card and splits the personal report", () => {
    const entry: Entry = {
      id: "spend-1",
      kind: "spend",
      date: "2026-10-25",
      description: "Groceries",
      amountCents: 15_000,
      payerEntityId: "self",
      accountId: "card",
      portions: [
        { entityId: "house", amountCents: 10_000 },
        { entityId: "self", amountCents: 5_000 },
      ],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(entry);

    expect(balances(ledger).byEntity.house).toBe(10_000);
    expect(report(ledger.entries, "2026-10-01", "2026-10-31").personalCents).toBe(10_000);
  });

  it("tracks you owing House on a House account", () => {
    const entry: Entry = {
      id: "spend-2",
      kind: "spend",
      date: "2026-10-25",
      description: "Utilities",
      amountCents: 4_000,
      payerEntityId: "house",
      accountId: "house-account",
      portions: [{ entityId: "self", amountCents: 4_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(entry);

    expect(balances(ledger).byEntity.house).toBe(-4_000);
    expect(report(ledger.entries, "2026-10-01", "2026-10-31").personalCents).toBe(4_000);
  });
});