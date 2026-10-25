import { describe, expect, it } from "vitest";
import {
  balances,
  openItems,
  report,
  type BankRow,
  type Entry,
  type Ledger,
  type Settlement,
} from "../src/domain/ledger";
import { confirmTransfer } from "../src/domain/transfers";

const updatedAt = "2026-10-25T00:00:00.000Z";

function baseLedger(entries: Entry[] = []): Ledger {
  return {
    schemaVersion: 1,
    entities: [
      { id: "self", kind: "self", name: "You", archived: false, updatedAt },
      { id: "house", kind: "house", name: "House", archived: false, updatedAt },
      { id: "friend", kind: "person", name: "Friend", archived: false, updatedAt },
    ],
    accounts: [],
    entries,
    baselines: [],
    settlements: [],
    bankRows: [],
  };
}

function spend(
  id: string,
  payerEntityId: string,
  amountCents: number,
  portions: Entry["portions"],
  options: Partial<Entry> = {},
): Entry {
  return {
    id,
    kind: "spend",
    date: "2026-10-20",
    description: id,
    amountCents,
    payerEntityId,
    accountId: null,
    portions,
    countsTowardDebt: true,
    updatedAt,
    ...options,
  };
}

function bankRow(id: string, accountId: string, amountCents: number, entryId: string | null = null): BankRow {
  return {
    id,
    accountId,
    importId: "import",
    line: 1,
    date: "2026-10-20",
    description: id,
    amountCents,
    balanceCents: null,
    raw: [],
    entryId,
    settlementId: null,
    skipped: false,
    dismissedTransferIds: [],
    updatedAt,
  };
}

function settlement(
  id: string,
  entityId: string,
  direction: Settlement["direction"],
  amountCents: number,
  date = "2026-10-25",
): Settlement {
  return {
    id,
    date,
    entityId,
    direction,
    amountCents,
    bankRowIds: [],
    note: "",
    splitwisePaymentId: null,
    updatedAt,
  };
}

interface MoneyCase {
  case: number;
  label: string;
  ledger: Ledger;
  personalCents?: number;
  balances: Record<string, number>;
  betweenEntities?: { debtorId: string; creditorId: string; amountCents: number }[];
  openItems?: ReturnType<typeof openItems>;
}

const moneyCases: MoneyCase[] = [
  {
    case: 1,
    label: "$150 on your card: $100 House, $50 you",
    ledger: baseLedger([spend("card-split", "self", 15_000, [
      { entityId: "house", amountCents: 10_000 },
      { entityId: "self", amountCents: 5_000 },
    ])]),
    personalCents: 10_000,
    balances: { house: 10_000 },
  },
  {
    case: 2,
    label: "$60 on the House account, all House",
    ledger: baseLedger([spend("house-own", "house", 6_000, [{ entityId: "house", amountCents: 6_000 }])]),
    personalCents: 3_000,
    balances: { house: 0 },
  },
  {
    case: 3,
    label: "$40 on the House account, all you",
    ledger: baseLedger([spend("house-personal", "house", 4_000, [{ entityId: "self", amountCents: 4_000 }])]),
    personalCents: 4_000,
    balances: { house: -4_000 },
  },
  {
    case: 4,
    label: "$50 on your card, all for a friend",
    ledger: baseLedger([spend("friend-card", "self", 5_000, [{ entityId: "friend", amountCents: 5_000 }])]),
    personalCents: 0,
    balances: { friend: 5_000 },
  },
  {
    case: 5,
    label: "Friend paid $90 dinner, your share $30",
    ledger: baseLedger([spend("friend-dinner", "friend", 9_000, [
      { entityId: "self", amountCents: 3_000 },
      { entityId: "friend", amountCents: 6_000 },
    ])]),
    personalCents: 3_000,
    balances: { friend: -3_000 },
  },
  {
    case: 6,
    label: "$150 split between House and friend; friend pays $20",
    ledger: {
      ...baseLedger([spend("shared-card", "self", 15_000, [
        { entityId: "house", amountCents: 10_000 },
        { entityId: "friend", amountCents: 5_000 },
      ])]),
      settlements: [settlement("friend-payment", "friend", "theyPaidYou", 2_000)],
    },
    personalCents: 5_000,
    balances: { house: 10_000, friend: 3_000 },
  },
  {
    case: 7,
    label: "$15.18 House spend linked to a $5.18 bank row",
    ledger: {
      ...baseLedger([spend("amended-house", "self", 1_518, [{ entityId: "house", amountCents: 1_518 }], {
        bankRowIds: ["house-row"],
      })]),
      bankRows: [bankRow("house-row", "card", -518, "amended-house")],
    },
    personalCents: 759,
    balances: { house: 518 },
  },
  {
    case: 8,
    label: "$586.32 spend: $419.40 House, remainder you",
    ledger: baseLedger([spend("large-split", "self", 58_632, [
      { entityId: "house", amountCents: 41_940 },
      { entityId: "self", amountCents: 16_692 },
    ])]),
    personalCents: 37_662,
    balances: { house: 41_940 },
  },
  {
    case: 9,
    label: "$0.01 House spend",
    ledger: baseLedger([spend("odd-cent", "self", 1, [{ entityId: "house", amountCents: 1 }])]),
    personalCents: 1,
    balances: { house: 1 },
  },
  {
    case: 10,
    label: "House owes $100, then $20, and pays $110",
    ledger: {
      ...baseLedger([
        spend("first-house-debt", "self", 10_000, [{ entityId: "house", amountCents: 10_000 }], {
          date: "2026-10-20",
        }),
        spend("second-house-debt", "self", 2_000, [{ entityId: "house", amountCents: 2_000 }], {
          date: "2026-10-21",
        }),
      ]),
      settlements: [settlement("house-payment", "house", "theyPaidYou", 11_000)],
    },
    balances: { house: 1_000 },
    openItems: {
      theyOweYou: [{
        id: "second-house-debt",
        date: "2026-10-21",
        description: "second-house-debt",
        source: "entry",
        amountCents: 2_000,
        openAmountCents: 1_000,
      }],
      youOweThem: [],
    },
  },
  {
    case: 11,
    label: "$100 House portion settled, then $30 refund to your card",
    ledger: {
      ...baseLedger([
        spend("settled-house-spend", "self", 10_000, [{ entityId: "house", amountCents: 10_000 }]),
        {
          ...spend("house-refund", "self", 3_000, [{ entityId: "house", amountCents: 3_000 }]),
          kind: "refund",
          refundOf: "settled-house-spend",
          date: "2026-10-25",
        },
      ]),
      settlements: [settlement("full-house-payment", "house", "theyPaidYou", 10_000, "2026-10-24")],
    },
    personalCents: 3_500,
    balances: { house: -3_000 },
    openItems: {
      theyOweYou: [],
      youOweThem: [{
        id: "house-refund",
        date: "2026-10-25",
        description: "house-refund",
        source: "entry",
        amountCents: 3_000,
        openAmountCents: 3_000,
      }],
    },
  },
  {
    case: 12,
    label: "$200 moved from your account to House as a contribution",
    ledger: (() => {
      const ledger = baseLedger();
      const outgoing = bankRow("self-out", "self-account", -20_000);
      const incoming = bankRow("house-in", "house-account", 20_000);
      ledger.accounts = [
        { id: "self-account", name: "Your account", type: "asset", payerEntityId: "self", updatedAt },
        { id: "house-account", name: "House account", type: "asset", payerEntityId: "house", updatedAt },
      ];
      ledger.bankRows = [outgoing, incoming];
      const confirmed = confirmTransfer(ledger, outgoing, incoming, "contribution");
      if (!confirmed) throw new Error("Expected the contribution transfer to be confirmed.");
      return confirmed;
    })(),
    personalCents: 0,
    balances: { house: 0 },
  },
  {
    case: 13,
    label: "House account pays a friend's $30 ticket",
    ledger: baseLedger([spend("house-friend-ticket", "house", 3_000, [{ entityId: "friend", amountCents: 3_000 }])]),
    personalCents: 0,
    balances: { house: 0, friend: 0 },
    betweenEntities: [{ debtorId: "friend", creditorId: "house", amountCents: 3_000 }],
  },
  {
    case: 14,
    label: "$80 imported House spend kept out of balances",
    ledger: baseLedger([spend("excluded-import", "self", 8_000, [{ entityId: "house", amountCents: 8_000 }], {
      bankRowIds: ["excluded-row"],
      countsTowardDebt: false,
    })]),
    personalCents: 4_000,
    balances: { house: 0 },
  },
];

describe("agreed money cases", () => {
  it.each(moneyCases)("case $case: $label", ({ ledger, personalCents, balances: expectedBalances, betweenEntities, openItems: expectedOpenItems }) => {
    const result = balances(ledger);

    for (const [entityId, amountCents] of Object.entries(expectedBalances)) {
      expect(result.byEntity[entityId]).toBe(amountCents);
    }
    expect(result.betweenEntities).toEqual(betweenEntities ?? []);
    if (personalCents !== undefined) {
      expect(report(ledger.entries, "2026-10-01", "2026-10-31").personalCents).toBe(personalCents);
    }
    if (expectedOpenItems) expect(openItems(ledger, "house")).toEqual(expectedOpenItems);
  });
});