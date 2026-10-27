import { type Ledger, type Account, type BankRow, type BalanceCheckpoint, type Entity, type Entry, type Settlement } from "../../../src/domain/ledger";
import { emptyLedger, ledgerProblem } from "../../../src/adapters/file-ledger";

export type LedgerOptions = {
  accounts?: Account[];
  people?: Entity[];
  entries?: Entry[];
  bankRows?: BankRow[];
  settlements?: Settlement[];
  checkpointDifference?: { accountId?: string; differenceCents?: number };
};

function relativeDate(offsetDays: number): string {
  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays));
  return date.toISOString().slice(0, 10);
}

function baseTimestamp(): string {
  return new Date().toISOString();
}

export function buildLedger(options: LedgerOptions = {}): Ledger {
  const ledger = emptyLedger();
  const now = baseTimestamp();
  const defaultPeople: Entity[] = [
    { id: "alex", kind: "person", name: "Alex", archived: false, updatedAt: now },
    { id: "jo", kind: "person", name: "Jo", archived: false, updatedAt: now },
    { id: "trip", kind: "group", name: "Trip Group", archived: false, updatedAt: now, groupType: "trip" },
  ];
  const defaultAccounts: Account[] = [
    { id: "everyday", name: "Everyday", type: "asset", payerEntityId: "self", updatedAt: now },
    { id: "joint", name: "Joint", type: "asset", payerEntityId: "self", updatedAt: now },
    { id: "card", name: "Card", type: "credit", payerEntityId: "self", updatedAt: now },
  ];
  const defaultEntries: Entry[] = [
    {
      id: "entry-groceries",
      kind: "spend",
      date: relativeDate(-3),
      description: "Groceries",
      amountCents: 1850,
      payerEntityId: "self",
      accountId: "card",
      portions: [{ entityId: "self", amountCents: 1850 }],
      bankRowIds: [],
      countsTowardDebt: true,
      updatedAt: now,
    },
    {
      id: "entry-dinner",
      kind: "spend",
      date: relativeDate(-1),
      description: "Dinner with Alex",
      amountCents: 5000,
      payerEntityId: "self",
      accountId: "card",
      portions: [
        { entityId: "self", amountCents: 3000 },
        { entityId: "alex", amountCents: 2000 },
      ],
      bankRowIds: [],
      countsTowardDebt: true,
      updatedAt: now,
    },
    {
      id: "entry-income",
      kind: "income",
      date: relativeDate(-10),
      description: "Pay",
      amountCents: 3000,
      payerEntityId: "self",
      accountId: "card",
      portions: [{ entityId: "self", amountCents: 3000 }],
      bankRowIds: [],
      countsTowardDebt: false,
      updatedAt: now,
    },
  ];
  const defaultBankRows: BankRow[] = [
    {
      id: "bank-row-1",
      accountId: "card",
      importId: "import-1",
      line: 1,
      date: relativeDate(-1),
      description: "Dinner with Alex",
      amountCents: -5000,
      balanceCents: null,
      raw: ["Dinner with Alex", "-50.00"],
      entryId: null,
      settlementId: null,
      skipped: false,
      dismissedTransferIds: [],
      updatedAt: now,
    },
  ];

  ledger.entities.push(...(options.people ?? defaultPeople));
  ledger.accounts.push(...(options.accounts ?? defaultAccounts));
  const normalizedEntries = ((options.entries ?? defaultEntries) as Entry[]).map((entry) => ({
    ...entry,
    bankRowIds: entry.bankRowIds ?? [],
  })) as (Entry & { bankRowIds: string[] })[];
  ledger.entries.push(...normalizedEntries);
  ledger.bankRows = options.bankRows ?? defaultBankRows;
  ledger.settlements = options.settlements ?? [];
  if (options.checkpointDifference) {
    const accountId = options.checkpointDifference.accountId ?? ledger.accounts[0]?.id;
    if (!accountId || !ledger.accounts.some((account) => account.id === accountId)) {
      throw new Error("A checkpoint difference requires an existing account.");
    }
    const differenceCents = options.checkpointDifference.differenceCents ?? 1000;
    const checkpoints: BalanceCheckpoint[] = [
      { id: "checkpoint-before", accountId, date: relativeDate(-20), balanceCents: 10000, note: "Before", updatedAt: now },
      { id: "checkpoint-after", accountId, date: relativeDate(-10), balanceCents: 10000 + differenceCents, note: "After", updatedAt: now },
    ];
    ledger.checkpoints = checkpoints;
  }

  const problem = ledgerProblem(ledger);
  if (problem) {
    throw new Error(problem);
  }
  return ledger;
}

export const scenario = {
  basic: () => buildLedger({
    accounts: [{ id: "card", name: "Card", type: "credit", payerEntityId: "self", updatedAt: baseTimestamp() }],
    entries: [
      {
        id: "basic-1",
        kind: "spend",
        date: relativeDate(-3),
        description: "Groceries",
        amountCents: 1850,
        payerEntityId: "self",
        accountId: "card",
        portions: [{ entityId: "self", amountCents: 1850 }],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
      {
        id: "basic-2",
        kind: "spend",
        date: relativeDate(-2),
        description: "Fuel",
        amountCents: 3200,
        payerEntityId: "self",
        accountId: "card",
        portions: [{ entityId: "self", amountCents: 3200 }],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
      {
        id: "basic-3",
        kind: "spend",
        date: relativeDate(-1),
        description: "Dinner with Alex",
        amountCents: 5000,
        payerEntityId: "self",
        accountId: "card",
        portions: [
          { entityId: "self", amountCents: 3000 },
          { entityId: "alex", amountCents: 2000 },
        ],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
    ],
    people: [{ id: "alex", kind: "person", name: "Alex", archived: false, updatedAt: baseTimestamp() }],
  }),
  full: () => buildLedger({
    people: [
      { id: "alex", kind: "person", name: "Alex", archived: false, updatedAt: baseTimestamp() },
      { id: "jo", kind: "person", name: "Jo", archived: false, updatedAt: baseTimestamp() },
      { id: "trip", kind: "group", name: "Trip Group", archived: false, updatedAt: baseTimestamp(), groupType: "trip" },
    ],
    accounts: [
      { id: "card", name: "Card", type: "credit", payerEntityId: "self", updatedAt: baseTimestamp() },
      { id: "everyday", name: "Everyday", type: "asset", payerEntityId: "self", updatedAt: baseTimestamp() },
      { id: "joint", name: "Joint", type: "asset", payerEntityId: "self", updatedAt: baseTimestamp() },
    ],
    entries: [
      {
        id: "full-1",
        kind: "spend",
        date: relativeDate(-12),
        description: "Groceries",
        amountCents: 1850,
        payerEntityId: "self",
        accountId: "card",
        portions: [{ entityId: "self", amountCents: 1850 }],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
      {
        id: "full-2",
        kind: "spend",
        date: relativeDate(-7),
        description: "Trip group dinner",
        amountCents: 6000,
        payerEntityId: "self",
        accountId: "card",
        portions: [
          { entityId: "self", amountCents: 3000 },
          { entityId: "trip", amountCents: 3000 },
        ],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
      {
        id: "full-3",
        kind: "income",
        date: relativeDate(-20),
        description: "Pay",
        amountCents: 4000,
        payerEntityId: "self",
        accountId: "everyday",
        portions: [{ entityId: "self", amountCents: 4000 }],
        bankRowIds: [],
        countsTowardDebt: false,
        updatedAt: baseTimestamp(),
      },
      {
        id: "full-4",
        kind: "spend",
        date: relativeDate(-2),
        description: "Coffee with Jo",
        amountCents: 2000,
        payerEntityId: "self",
        accountId: "card",
        portions: [
          { entityId: "self", amountCents: 1000 },
          { entityId: "jo", amountCents: 1000 },
        ],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
      {
        id: "full-5",
        kind: "spend",
        date: relativeDate(-1),
        description: "Dinner with Alex",
        amountCents: 5000,
        payerEntityId: "self",
        accountId: "card",
        portions: [
          { entityId: "self", amountCents: 3000 },
          { entityId: "alex", amountCents: 2000 },
        ],
        bankRowIds: [],
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
    ],
    bankRows: [
      {
        id: "pending-row",
        accountId: "card",
        importId: "import-1",
        line: 1,
        date: relativeDate(-3),
        description: "Hardware shop",
        amountCents: -6500,
        balanceCents: null,
        raw: ["Hardware shop", "-65.00"],
        entryId: null,
        settlementId: null,
        skipped: false,
        dismissedTransferIds: [],
        updatedAt: baseTimestamp(),
      },
      {
        id: "pending-row-2",
        accountId: "everyday",
        importId: "import-1",
        line: 2,
        date: relativeDate(-4),
        description: "Card payment",
        amountCents: -10000,
        balanceCents: null,
        raw: ["Card payment", "-100.00"],
        entryId: null,
        settlementId: null,
        skipped: false,
        dismissedTransferIds: [],
        updatedAt: baseTimestamp(),
      },
      {
        id: "pending-row-3",
        accountId: "card",
        importId: "import-1",
        line: 3,
        date: relativeDate(-4),
        description: "Payment received",
        amountCents: 10000,
        balanceCents: null,
        raw: ["Payment received", "100.00"],
        entryId: null,
        settlementId: null,
        skipped: false,
        dismissedTransferIds: [],
        updatedAt: baseTimestamp(),
      },
    ],
    settlements: [
      {
        id: "settlement-1",
        date: relativeDate(-8),
        entityId: "alex",
        direction: "theyPaidYou",
        amountCents: 1500,
        bankRowIds: [],
        note: "Dinner refund",
        splitwisePaymentId: null,
        updatedAt: baseTimestamp(),
      },
    ],
    checkpointDifference: { accountId: "everyday", differenceCents: 2500 },
  }),
  amended: () => buildLedger({
    entries: [
      {
        id: "amended-spend",
        kind: "spend",
        date: relativeDate(-1),
        description: "Amended grocery purchase",
        amountCents: 6000,
        payerEntityId: "self",
        accountId: "card",
        portions: [{ entityId: "self", amountCents: 6000 }],
        bankRowIds: ["amended-bank-row"],
        note: "Removed an item after checkout.",
        countsTowardDebt: true,
        updatedAt: baseTimestamp(),
      },
    ],
    bankRows: [
      {
        id: "amended-bank-row",
        accountId: "card",
        importId: "amended-import",
        line: 1,
        date: relativeDate(-1),
        description: "Amended grocery purchase",
        amountCents: -6500,
        balanceCents: null,
        raw: ["Amended grocery purchase", "-65.00"],
        entryId: "amended-spend",
        settlementId: null,
        skipped: false,
        dismissedTransferIds: [],
        updatedAt: baseTimestamp(),
      },
    ],
  }),
};
