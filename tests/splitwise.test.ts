import { describe, expect, it } from "vitest";
import { buildExpense } from "../src/adapters/splitwise";
import type { Entry, Entity } from "../src/domain/ledger";

const entry: Entry = {
  id: "entry-1",
  kind: "spend",
  date: "2026-10-25",
  description: "Dinner",
  amountCents: 9000,
  payerEntityId: "self",
  accountId: null,
  portions: [
    { entityId: "self", amountCents: 3000 },
    { entityId: "group-1", amountCents: 6000 },
  ],
  countsTowardDebt: true,
  updatedAt: "2026-10-25T00:00:00.000Z",
};

const group: Entity = {
  id: "group-1",
  kind: "group",
  name: "Dinner group",
  archived: false,
  updatedAt: "2026-10-25T00:00:00.000Z",
  splitwise: { kind: "group", id: "42" },
};

describe("buildExpense", () => {
  it("splits a group portion across its other members", () => {
    const draft = buildExpense(entry, entry.portions[1], group, [
      { id: 7, first_name: "You", last_name: "" },
      { id: 8, first_name: "Alex", last_name: "" },
      { id: 9, first_name: "Sam", last_name: "" },
      { id: 10, first_name: "Lee", last_name: "" },
    ], 7);

    expect(draft.costCents).toBe(9000);
    expect(draft.shares.map((share) => share.owedCents)).toEqual([3000, 2000, 2000, 2000]);
  });
});
