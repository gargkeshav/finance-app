import { describe, expect, it } from "vitest";
import { headerNames, parseCurl } from "../src/adapters/curl-capture";
import { buildExpense, buildPayment, pullIntoInbox, type SplitwiseExpense } from "../src/adapters/splitwise";
import type { Entry, Entity, Ledger, Settlement } from "../src/domain/ledger";

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

describe("parseCurl", () => {
  it("parses a multi-line Chrome request without exposing header values", () => {
    const parsed = parseCurl(`curl 'https://secure.splitwise.com/api/v3.0/create_expense' \\
      -H 'Accept: application/json' \\
      -H 'X-Requested-With: XMLHttpRequest' \\
      -b 'session=fake-session; route=test' \\
      --data-raw '{"description":"Cafe"}'`);

    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://secure.splitwise.com/api/v3.0/create_expense");
    expect(headerNames(parsed)).toEqual(["Accept", "X-Requested-With", "Cookie"]);
    expect(parsed.headers).toEqual({
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    });
    expect(parsed.cookies).toBe("session=fake-session; route=test");
    expect(headerNames(parsed).join(" ")).not.toContain("fake-session");
  });

  it("rejects a request to another host", () => {
    expect(() => parseCurl("curl 'https://example.test/api/v3.0/get_current_user'"))
      .toThrow("Only requests to https://secure.splitwise.com are supported.");
  });
});

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

  it("seeds a posted expense remote timestamp without marking it changed", () => {
    const expense: SplitwiseExpense = {
      id: 123,
      group_id: 42,
      description: "Dinner",
      date: "2026-10-25T12:00:00Z",
      cost: "90.00",
      currency_code: "AUD",
      payment: false,
      updated_at: "2026-10-25T12:30:00Z",
      deleted_at: null,
      users: [
        { user_id: 7, paid_share: "90.00", owed_share: "30.00" },
        { user_id: 8, paid_share: "0.00", owed_share: "60.00" },
      ],
    };
    const ledger = {
      schemaVersion: 1,
      entities: [group],
      accounts: [],
      entries: [],
      baselines: [],
      splitwisePosts: [{
        id: "post-1",
        entryId: "entry-1",
        entityId: group.id,
        state: "posted" as const,
        splitwiseExpenseId: "123",
        remoteUpdatedAt: null,
        updatedAt: "2026-10-25T12:00:00Z",
      }],
    } as Ledger & { splitwisePosts: Array<{ id: string; entryId: string; entityId: string; state: "posted"; splitwiseExpenseId: string; remoteUpdatedAt: string | null; updatedAt: string }> };

    const pulled = pullIntoInbox(ledger, group, [expense], 7, "2026-10-25T12:31:00Z") as typeof ledger;

    expect(pulled.splitwiseInbox).toEqual([]);
    expect(pulled.splitwisePosts[0].remoteUpdatedAt).toBe(expense.updated_at);
  });
});

describe("buildPayment", () => {
  it("builds the confirmed shares for a they-paid-you settlement", () => {
    const settlement: Settlement = {
      id: "settlement-1",
      date: "2026-10-25",
      entityId: "friend-1",
      direction: "theyPaidYou",
      amountCents: 2500,
      bankRowIds: [],
      note: "Repayment",
      splitwisePaymentId: null,
      updatedAt: "2026-10-25T00:00:00.000Z",
    };
    const friend: Entity = { ...group, id: "friend-1", kind: "person", splitwise: { kind: "user", id: "8" } };
    const draft = buildPayment(settlement, friend, 8, 7);

    expect(draft.payment).toBe(true);
    expect(draft.shares).toEqual([
      { userId: 8, name: "Dinner group", paidCents: 2500, owedCents: 0 },
      { userId: 7, name: "You", paidCents: 0, owedCents: 2500 },
    ]);
  });
});
