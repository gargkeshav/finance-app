import { describe, expect, it } from "vitest";
import type { BankRow, Ledger } from "../src/domain/ledger";
import { existingEntryFor, isWaitingOnOtherAccount } from "../src/domain/transfers";

function bankRow(id: string, accountId: string, date: string, amountCents: number): BankRow {
  return {
    id,
    accountId,
    importId: "import-1",
    line: 1,
    date,
    description: "Bank transaction",
    amountCents,
    balanceCents: null,
    raw: [],
    entryId: null,
    settlementId: null,
    skipped: false,
    dismissedTransferIds: [],
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function baseLedger(): Ledger {
  return {
    schemaVersion: 1,
    entities: [
      { id: "self", kind: "self", name: "Self", archived: false, updatedAt: "" },
      { id: "house", kind: "house", name: "House", archived: false, updatedAt: "" },
    ],
    accounts: [
      { id: "A", name: "Account A", type: "asset", payerEntityId: "self", updatedAt: "" },
      { id: "B", name: "Account B", type: "asset", payerEntityId: "house", updatedAt: "" },
      { id: "C", name: "Card C", type: "credit", payerEntityId: "self", updatedAt: "" },
    ],
    entries: [],
    baselines: [],
    imports: [],
    bankRows: [],
  };
}

function historyEntry(id: string, date = "2024-01-03") {
  return {
    id,
    kind: "spend" as const,
    date,
    description: "History spend",
    amountCents: 1250,
    payerEntityId: "self",
    accountId: "A",
    portions: [{ entityId: "self", amountCents: 1250 }],
    source: "history" as const,
    countsTowardDebt: false,
    updatedAt: "",
  };
}

describe("review status helpers", () => {
  it("links a unique history entry and rejects ambiguous matches", () => {
    const ledger = baseLedger();
    const row = bankRow("row-a", "A", "2024-01-04", -1250);
    ledger.entries = [historyEntry("history-a")];
    expect(existingEntryFor(ledger, row)?.id).toBe("history-a");

    ledger.entries.push(historyEntry("history-b"));
    expect(existingEntryFor(ledger, row)).toBeNull();
  });

  it("matches a history card payment to its savings account row", () => {
    const ledger = baseLedger();
    ledger.accounts.push({ id: "savings", name: "Savings", type: "asset", payerEntityId: "self", updatedAt: "" });
    ledger.entries.push({
      id: "payment",
      kind: "transfer",
      date: "2024-02-01",
      description: "Card payment",
      amountCents: 50000,
      payerEntityId: "self",
      accountId: "C",
      portions: [],
      source: "history",
      tags: ["history", "card-payment"],
      countsTowardDebt: false,
      updatedAt: "",
    });

    expect(existingEntryFor(ledger, bankRow("savings-row", "savings", "2024-02-02", -50000))?.id).toBe("payment");
  });

  it("waits until another account is covered three days beyond the row", () => {
    const ledger = baseLedger();
    const row = bankRow("row-b", "B", "2024-01-04", -1250);
    ledger.imports = [{
      id: "import-a",
      accountId: "A",
      mappingId: "mapping-a",
      fileName: "account-a.csv",
      contentHash: "hash",
      dateFrom: "2024-01-01",
      dateTo: "2024-01-05",
      countsTowardDebt: true,
      importedAt: "",
      updatedAt: "",
    }];
    expect(isWaitingOnOtherAccount(ledger, row)).toBe(true);

    ledger.imports[0].dateTo = "2024-01-10";
    expect(isWaitingOnOtherAccount(ledger, row)).toBe(false);
  });
});