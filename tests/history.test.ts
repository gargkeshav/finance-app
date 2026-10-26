import { describe, expect, it } from "vitest";
import { buildChangeSet, revertChangeSet } from "../src/domain/history";
import type { Entry, Ledger } from "../src/domain/ledger";

const entry: Entry = {
  id: "entry-1",
  kind: "spend",
  date: "2026-10-01",
  description: "Market",
  amountCents: 1000,
  payerEntityId: "self",
  accountId: null,
  portions: [{ entityId: "self", amountCents: 1000 }],
  countsTowardDebt: true,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function ledger(entries: Entry[]): Ledger {
  return {
    schemaVersion: 1,
    entities: [],
    accounts: [],
    entries,
    baselines: [],
  };
}

describe("change history", () => {
  it("reverts additions and changes, while skipping records changed again", () => {
    const changed = { ...entry, categoryId: "food" };
    const added = { ...entry, id: "entry-2", description: "Coffee" };
    const before = ledger([entry]);
    const after = ledger([changed, added]);
    const changeSet = buildChangeSet(before, after, "Categorize purchases", "you");

    expect(changeSet?.records).toHaveLength(2);
    expect(changeSet?.records.every((record) => record.collection === "entries")).toBe(true);
    expect(changeSet?.records.filter((record) => record.before === null)).toHaveLength(1);

    const reverted = revertChangeSet(after, changeSet!);
    expect(reverted.ledger.entries).toEqual([entry]);
    expect(reverted.skipped).toBe(0);

    const editedAgain = { ...changed, categoryId: "groceries" };
    const conflicted = revertChangeSet(ledger([editedAgain, added]), changeSet!);
    expect(conflicted.skipped).toBe(1);
    expect(conflicted.ledger.entries).toEqual([editedAgain]);
  });
});