import { describe, expect, it } from "vitest";
import { balances, defaultSplitPreset, openItems, report, splitPreset, type BankRow, type Entry, type Ledger } from "../src/domain/ledger";
import { confirmTransfer, suggestTransfers } from "../src/domain/transfers";
import { filterEntries } from "../src/domain/query";
import { monthly } from "../src/domain/reports";
import { findIssues } from "../src/domain/health";
import { canAutoConfirm, firstRule, type EntryRule } from "../src/domain/rules";
import { createSplitwiseSpend, pullIntoInbox, type SplitwiseExpense } from "../src/adapters/splitwise";
import { applyHistoryImport, planHistoryImport } from "../src/domain/history-import";

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
  it("imports history splits with settled debt and skips duplicate history keys", async () => {
    const ledger = makeLedger({
      id: "history-seed",
      kind: "income",
      date: "2026-10-20",
      description: "Seed",
      amountCents: 1,
      payerEntityId: "self",
      accountId: null,
      portions: [],
      countsTowardDebt: false,
      updatedAt: "now",
    });
    ledger.entries = [];
    ledger.accounts = [{ id: "anz-credit", name: "ANZ Credit", type: "credit", payerEntityId: "self", updatedAt: "now" }];
    const text = [
      "Date,Description,Debit($AUD),Status,SubType,Group,Our share,Share",
      "25/5/2026,Synthetic groceries,30.00,Settled,Groceries,,10.00,Personal",
      "25/5/2026,Synthetic groceries,30.00,Settled,Groceries,,10.00,Personal",
    ].join("\n");

    const settledPlan = await planHistoryImport(text, ledger, "anz-credit");
    const settled = applyHistoryImport(settledPlan, ledger);
    expect(settled.entries[0]).toMatchObject({
      kind: "spend",
      amountCents: 3_000,
      countsTowardDebt: false,
      portions: [
        { entityId: "house", amountCents: 1_000 },
        { entityId: "self", amountCents: 2_000 },
      ],
    });
    expect(settled.entries).toHaveLength(2);
    expect(balances(settled).byEntity.house).toBe(0);
    expect(applyHistoryImport(await planHistoryImport(text, settled, "anz-credit"), settled).entries).toHaveLength(2);

    const openPlan = await planHistoryImport(text.replace(",Settled,", ",,"), ledger, "anz-credit");
    const open = applyHistoryImport(openPlan, ledger);
    expect(open.entries[0].countsTowardDebt).toBe(true);
    expect(balances(open).byEntity.house).toBe(1_000);
  });

  it("reports a review row and a checkpoint difference", () => {
    const ledger = makeLedger({
      id: "health-entry",
      kind: "income",
      date: "2026-10-20",
      description: "Income",
      amountCents: 1_000,
      payerEntityId: "self",
      accountId: "card",
      portions: [],
      countsTowardDebt: false,
      updatedAt: "now",
    });
    ledger.accounts = [{ id: "card", name: "Card", type: "credit", payerEntityId: "self", updatedAt: "now" }];
    ledger.bankRows = [{
      id: "review-row",
      accountId: "card",
      importId: "import",
      line: 1,
      date: "2026-10-24",
      description: "Pending",
      amountCents: -500,
      balanceCents: null,
      raw: [],
      entryId: null,
      settlementId: null,
      skipped: false,
      dismissedTransferIds: [],
      updatedAt: "now",
    }];
    ledger.checkpoints = [
      { id: "before", accountId: "card", date: "2026-10-01", balanceCents: 0, note: "", updatedAt: "now" },
      { id: "after", accountId: "card", date: "2026-10-24", balanceCents: 0, note: "", updatedAt: "now" },
    ];

    expect(findIssues(ledger, "2026-10-25")).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "Rows waiting in review", count: 1, view: "Review" }),
      expect.objectContaining({ kind: "Checkpoint differences", count: 1, view: "Accounts", detail: expect.stringContaining("$5.00") }),
    ]));
  });

  it("reports House spending by personal and household scope", () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-10`;
    const houseSpend: Entry = {
      id: "house-report-spend",
      kind: "spend",
      date,
      description: "House purchase",
      amountCents: 10_000,
      payerEntityId: "self",
      accountId: null,
      portions: [{ entityId: "house", amountCents: 10_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(houseSpend);
    ledger.entries.push({
      ...houseSpend,
      id: "self-report-spend",
      description: "Personal purchase",
      amountCents: 2_000,
      portions: [{ entityId: "self", amountCents: 2_000 }],
    });

    expect(monthly(ledger, "personal", 1)[0].spendingCents).toBe(7_000);
    expect(monthly(ledger, "household", 1)[0].spendingCents).toBe(12_000);
  });

  it("splits $10.00 evenly over three entities with the leftover cent first", () => {
    expect(splitPreset(1_000, "self", { kind: "equal", entityIds: ["self", "house", "alex"] })).toEqual([
      { entityId: "self", amountCents: 334 },
      { entityId: "house", amountCents: 333 },
      { entityId: "alex", amountCents: 333 },
    ]);
  });

  it("splits weighted shares and assigns leftover cents by weight", () => {
    const shares = [
      { entityId: "alex", weight: 2 },
      { entityId: "blair", weight: 1 },
      { entityId: "casey", weight: 1 },
    ];
    expect(splitPreset(10_000, "self", { kind: "shares", shares })).toEqual([
      { entityId: "alex", amountCents: 5_000 },
      { entityId: "blair", amountCents: 2_500 },
      { entityId: "casey", amountCents: 2_500 },
    ]);
    expect(splitPreset(101, "self", { kind: "shares", shares })).toEqual([
      { entityId: "alex", amountCents: 51 },
      { entityId: "blair", amountCents: 25 },
      { entityId: "casey", amountCents: 25 },
    ]);
  });

  it("uses the half-House default when House has no allocation", () => {
    expect(defaultSplitPreset({
      id: "house",
      kind: "house",
      name: "House",
      archived: false,
      updatedAt: "now",
    }, 1_000)).toEqual({ kind: "halfHouse" });
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

  it("filters debt entries by whether their balance is settled", () => {
    const base: Entry = {
      id: "debt-a",
      kind: "spend",
      date: "2026-10-20",
      description: "Shared expense",
      amountCents: 4_000,
      payerEntityId: "self",
      accountId: null,
      portions: [{ entityId: "entity-a", amountCents: 4_000 }],
      countsTowardDebt: true,
      updatedAt: "now",
    };
    const ledger = makeLedger(base);
    ledger.entities.push(
      { id: "entity-a", kind: "person", name: "Alex", archived: false, updatedAt: "now" },
      { id: "entity-b", kind: "person", name: "Blair", archived: false, updatedAt: "now" },
    );
    ledger.entries.push({ ...base, id: "debt-b", amountCents: 2_000, portions: [{ entityId: "entity-b", amountCents: 2_000 }] });
    ledger.settlements = [{
      id: "settlement-a",
      date: "2026-10-25",
      entityId: "entity-a",
      direction: "theyPaidYou",
      amountCents: 4_000,
      bankRowIds: [],
      note: "",
      splitwisePaymentId: null,
      updatedAt: "now",
    }];
    ledger.entries.push({ ...base, id: "no-debt", portions: [{ entityId: "self", amountCents: 4_000 }] });

    expect(filterEntries(ledger, { settled: true }).map((entry) => entry.id)).toEqual(["debt-a"]);
    expect(filterEntries(ledger, { settled: false }).map((entry) => entry.id)).toEqual(["debt-b"]);
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

describe("entry rules", () => {
  it("uses the lowest-order match and requires a split for auto-confirm", () => {
    const row: BankRow = {
      id: "row-rule",
      accountId: "account-rule",
      importId: "import",
      line: 1,
      date: "2026-10-25",
      description: "Corner Market",
      amountCents: -2_500,
      balanceCents: null,
      raw: [],
      entryId: null,
      settlementId: null,
      skipped: false,
      dismissedTransferIds: [],
      updatedAt: "now",
    };
    const rule = (id: string, order: number, split: EntryRule["action"]["split"]): EntryRule => ({
      id,
      name: id,
      order,
      enabled: true,
      match: { text: "market", mode: "contains", accountId: null, sign: "out", minCents: null, maxCents: null },
      action: { displayName: null, categoryId: null, split, tags: [] },
      autoConfirm: true,
      updatedAt: "now",
    });
    const lowerOrder = rule("lower", 1, null);
    const higherOrder = rule("higher", 2, { kind: "payer" });

    expect(firstRule([higherOrder, lowerOrder], row, { id: row.accountId, name: "Card", type: "asset", payerEntityId: "self", updatedAt: "now" })?.id)
      .toBe("lower");
    expect(canAutoConfirm(lowerOrder)).toBe(false);
    expect(canAutoConfirm(higherOrder)).toBe(true);
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