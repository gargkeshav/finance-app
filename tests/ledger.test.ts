import { describe, expect, it } from "vitest";
import { balances, openItems, report, splitPreset, type BankRow, type Entry, type Ledger } from "../src/domain/ledger";
import { confirmTransfer, suggestTransfers } from "../src/domain/transfers";
import { filterEntries } from "../src/domain/query";
import { createSplitwiseSpend, pullIntoInbox, type SplitwiseExpense } from "../src/adapters/splitwise";

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
  it("splits $10.00 evenly over three entities with the leftover cent first", () => {
    expect(splitPreset(1_000, "self", { kind: "equal", entityIds: ["self", "house", "alex"] })).toEqual([
      { entityId: "self", amountCents: 334 },
      { entityId: "house", amountCents: 333 },
      { entityId: "alex", amountCents: 333 },
    ]);
  });

  it("filters entries by an entity and date range", () => {
    const entry: Entry = {
      id: "entity-filter",
      kind: "spend",
      date: "2026-10-20",
      description: "Shared costs",
      amountCents: 5_000,
      payerEntityId: "self",
      accountId: null,
      portions: [{ entityId: "person-1", amountCents: 5_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(entry);
    ledger.entities.push({ id: "person-1", kind: "person", name: "Alex", archived: false, updatedAt: "now" });
    ledger.entries.push(
      { ...entry, id: "payer-match", date: "2026-10-18", payerEntityId: "person-1", portions: [{ entityId: "self", amountCents: 5_000 }] },
      { ...entry, id: "before-range", date: "2026-10-09" },
      { ...entry, id: "after-range", date: "2026-11-01" },
      { ...entry, id: "other-entity", date: "2026-10-20", portions: [{ entityId: "house", amountCents: 5_000 }] },
    );

    expect(filterEntries(ledger, { entityId: "person-1", from: "2026-10-10", to: "2026-10-31" })
      .map((candidate) => candidate.id))
      .toEqual(["entity-filter", "payer-match"]);
  });

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

  it("scales House debt to the bank amount unless the extra is reimbursable", () => {
    const entry: Entry = {
      id: "amended-house-spend",
      kind: "spend",
      date: "2026-10-25",
      description: "House purchase",
      amountCents: 1_518,
      payerEntityId: "self",
      accountId: "card",
      portions: [{ entityId: "house", amountCents: 1_518 }],
      bankRowIds: ["bank-row"],
      note: "Includes an additional reimbursable item",
      extraReimbursable: false,
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(entry);
    ledger.bankRows = [{
      id: "bank-row",
      accountId: "card",
      importId: "import",
      line: 1,
      date: entry.date,
      description: entry.description,
      amountCents: -518,
      balanceCents: null,
      raw: [],
      entryId: entry.id,
      settlementId: null,
      skipped: false,
      dismissedTransferIds: [],
      updatedAt: "now",
    }];

    expect(balances(ledger).byEntity.house).toBe(518);
    expect(report(ledger.entries, "2026-10-01", "2026-10-31").personalCents).toBe(759);
    expect(balances({ ...ledger, entries: [{ ...entry, extraReimbursable: true }] }).byEntity.house).toBe(1_518);
  });

  it("applies House payments to the oldest debt first", () => {
    const firstSpend: Entry = {
      id: "spend-baseline-followup",
      kind: "spend",
      date: "2026-10-20",
      description: "Later spend",
      amountCents: 2_000,
      payerEntityId: "self",
      accountId: "card",
      portions: [{ entityId: "house", amountCents: 2_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(firstSpend);
    ledger.baselines = [{ id: "opening-house", entityId: "house", amountCents: 10_000, updatedAt: "now" }];
    ledger.settlements = [{
      id: "payment-house",
      date: "2026-10-25",
      entityId: "house",
      direction: "theyPaidYou",
      amountCents: 11_000,
      bankRowIds: [],
      note: "",
      splitwisePaymentId: null,
      updatedAt: "now",
    }];

    expect(openItems(ledger, "house").theyOweYou).toEqual([{
      id: "spend-baseline-followup",
      date: "2026-10-20",
      description: "Later spend",
      source: "entry",
      amountCents: 2_000,
      openAmountCents: 1_000,
    }]);
    expect(balances(ledger).byEntity.house).toBe(1_000);
  });

  it("applies out-of-order settlements against the oldest debt first", () => {
    const firstSpend: Entry = {
      id: "spend-first",
      kind: "spend",
      date: "2026-10-20",
      description: "First spend",
      amountCents: 3_000,
      payerEntityId: "self",
      accountId: null,
      portions: [{ entityId: "person-1", amountCents: 3_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(firstSpend);
    ledger.entities.push({ id: "person-1", kind: "person", name: "Alex", archived: false, updatedAt: "now" });
    ledger.entries.push({
      ...firstSpend,
      id: "spend-second",
      date: "2026-10-21",
      description: "Second spend",
    });
    ledger.settlements = [
      {
        id: "settlement-later",
        date: "2026-10-25",
        entityId: "person-1",
        direction: "theyPaidYou",
        amountCents: 2_000,
        bankRowIds: [],
        note: "Later",
        splitwisePaymentId: null,
        updatedAt: "now",
      },
      {
        id: "settlement-earlier",
        date: "2026-10-22",
        entityId: "person-1",
        direction: "theyPaidYou",
        amountCents: 1_000,
        bankRowIds: [],
        note: "Earlier",
        splitwisePaymentId: null,
        updatedAt: "now",
      },
    ];

    expect(openItems(ledger, "person-1").theyOweYou).toEqual([{
      id: "spend-second",
      date: "2026-10-21",
      description: "Second spend",
      source: "entry",
      amountCents: 3_000,
      openAmountCents: 3_000,
    }]);
  });

  it("makes you owe House for a refund after House settled the original spend", () => {
    const spend: Entry = {
      id: "spend-refunded",
      kind: "spend",
      date: "2026-10-20",
      description: "House groceries",
      amountCents: 10_000,
      payerEntityId: "self",
      accountId: "card",
      portions: [{ entityId: "house", amountCents: 10_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const refund: Entry = {
      id: "refund-1",
      kind: "refund",
      refundOf: spend.id,
      date: "2026-10-25",
      description: "House groceries refund",
      amountCents: 3_000,
      payerEntityId: "self",
      accountId: "card",
      portions: [{ entityId: "house", amountCents: 3_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(spend);
    ledger.accounts = [{ id: "card", name: "Card", type: "credit", payerEntityId: "self", updatedAt: "now" }];
    ledger.entries.push(refund);
    ledger.settlements = [{
      id: "house-payment",
      date: "2026-10-24",
      entityId: "house",
      direction: "theyPaidYou",
      amountCents: 10_000,
      bankRowIds: [],
      note: "",
      splitwisePaymentId: null,
      updatedAt: "now",
    }];

    expect(balances(ledger).byEntity.house).toBe(-3_000);
    expect(openItems(ledger, "house").youOweThem).toEqual([{
      id: refund.id,
      date: refund.date,
      description: refund.description,
      source: "entry",
      amountCents: 3_000,
      openAmountCents: 3_000,
    }]);
  });
});

describe("transfer suggestions", () => {
  function bankRow(id: string, accountId: string, amountCents: number): BankRow {
    return {
      id,
      accountId,
      importId: "import",
      line: 1,
      date: "2026-10-25",
      description: "Transfer",
      amountCents,
      balanceCents: null,
      raw: [],
      entryId: null,
      settlementId: null,
      skipped: false,
      dismissedTransferIds: [],
      updatedAt: "now",
    };
  }

  it("does not suggest ambiguous same-day pairs", () => {
    const ledger = makeLedger({
      id: "unused",
      kind: "income",
      date: "2026-10-25",
      description: "",
      amountCents: 1,
      payerEntityId: "self",
      accountId: null,
      portions: [],
      countsTowardDebt: false,
      updatedAt: "now",
    });
    ledger.accounts = [
      { id: "checking", name: "Checking", type: "asset", payerEntityId: "self", updatedAt: "now" },
      { id: "savings", name: "Savings", type: "asset", payerEntityId: "self", updatedAt: "now" },
    ];
    ledger.bankRows = [
      bankRow("out-1", "checking", -5_000),
      bankRow("out-2", "checking", -5_000),
      bankRow("in-1", "savings", 5_000),
      bankRow("in-2", "savings", 5_000),
    ];

    expect(suggestTransfers(ledger)).toEqual([]);
  });

  it("reduces House debt when a House-to-self move is confirmed as settlement", () => {
    const ledger = makeLedger({
      id: "unused",
      kind: "income",
      date: "2026-10-25",
      description: "",
      amountCents: 1,
      payerEntityId: "self",
      accountId: null,
      portions: [],
      countsTowardDebt: false,
      updatedAt: "now",
    });
    ledger.accounts = [
      { id: "house-account", name: "House", type: "asset", payerEntityId: "house", updatedAt: "now" },
      { id: "checking", name: "Checking", type: "asset", payerEntityId: "self", updatedAt: "now" },
    ];
    ledger.baselines = [{ id: "house-debt", entityId: "house", amountCents: 8_000, updatedAt: "now" }];
    const outgoing = bankRow("house-out", "house-account", -5_000);
    const incoming = bankRow("self-in", "checking", 5_000);
    ledger.bankRows = [outgoing, incoming];

    const confirmed = confirmTransfer(ledger, outgoing, incoming, "settlement");

    expect(confirmed).not.toBeNull();
    expect(balances(confirmed!).byEntity.house).toBe(3_000);
    expect(confirmed!.bankRows?.every((row) => row.settlementId !== null)).toBe(true);
  });
});

describe("Splitwise expense mapping", () => {
  it("creates the owed portion once when a friend paid the expense", () => {
    const ledger = makeLedger({
      id: "placeholder",
      kind: "income",
      date: "2026-10-25",
      description: "",
      amountCents: 1,
      payerEntityId: "self",
      accountId: null,
      portions: [],
      countsTowardDebt: false,
      updatedAt: "now",
    });
    const friend = { id: "friend", kind: "person" as const, name: "Friend", archived: false, updatedAt: "now", splitwise: { kind: "user" as const, id: "42" } };
    ledger.entities.push(friend);
    const expense: SplitwiseExpense = {
      id: 123,
      group_id: null,
      description: "Dinner",
      date: "2026-10-24T12:00:00Z",
      cost: "60.00",
      currency_code: "AUD",
      payment: false,
      updated_at: "2026-10-24T12:00:00Z",
      deleted_at: null,
      users: [
        { user_id: 42, paid_share: "60.00", owed_share: "35.00" },
        { user_id: 7, paid_share: "0.00", owed_share: "25.00" },
      ],
    };
    const inboxLedger = pullIntoInbox(ledger, friend, [expense], 7);
    const item = inboxLedger.splitwiseInbox![0];

    const mapped = createSplitwiseSpend(inboxLedger, item);
    const duplicate = createSplitwiseSpend(mapped, item);
    const spend = mapped.entries.find((entry) => entry.splitwiseExpenseId === "123")!;

    expect(spend.kind).toBe("spend");
    expect(spend.payerEntityId).toBe("friend");
    expect(spend.amountCents).toBe(6_000);
    expect(spend.portions).toEqual([
      { entityId: "self", amountCents: 2_500 },
      { entityId: "friend", amountCents: 3_500 },
    ]);
    expect(balances(mapped).byEntity.friend).toBe(-2_500);
    expect(duplicate.entries.filter((entry) => entry.splitwiseExpenseId === "123")).toHaveLength(1);
  });
});