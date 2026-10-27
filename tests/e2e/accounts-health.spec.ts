import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";
import type { Account, BankRow, Entry } from "../../src/domain/ledger";

function healthScenario() {
  const ledger = scenario.full();
  const now = new Date().toISOString();
  const date = new Date().toISOString().slice(0, 10);
  ledger.entities.push({
    id: "batch40-test-group",
    kind: "group",
    name: "Batch 40 group",
    archived: false,
    updatedAt: now,
  });

  const card: Account = {
    id: "batch40-test-card",
    name: "Ahead card",
    type: "credit",
    payerEntityId: "self",
    updatedAt: now,
  };
  const asset: Account = {
    id: "batch40-test-asset",
    name: "Payment account",
    type: "asset",
    payerEntityId: "self",
    updatedAt: now,
  };
  ledger.accounts.push(card, asset);

  const firstRowId = "batch40-transfer-row-one";
  const secondRowId = "batch40-transfer-row-two";
  const transfer: Entry = {
    id: "batch40-card-payment-one",
    kind: "transfer",
    date,
    description: "Ahead card payment",
    amountCents: 5000,
    payerEntityId: "self",
    accountId: card.id,
    portions: [],
    bankRowIds: [firstRowId, secondRowId],
    source: "bank",
    countsTowardDebt: false,
    updatedAt: now,
  };
  const duplicate: Entry = {
    ...transfer,
    id: "batch40-card-payment-two",
    bankRowIds: [],
    source: "manual",
    updatedAt: now,
  };
  const charge: Entry = {
    id: "batch40-card-charge",
    kind: "spend",
    date,
    description: "Ahead card charge",
    amountCents: 2500,
    payerEntityId: "self",
    accountId: card.id,
    portions: [{ entityId: "self", amountCents: 2500 }],
    countsTowardDebt: true,
    updatedAt: now,
  };
  ledger.entries.push(charge, transfer, duplicate);

  const rows: BankRow[] = [firstRowId, secondRowId].map((id, index) => ({
    id,
    accountId: asset.id,
    importId: "batch40-test-import",
    line: index + 1,
    date,
    description: "Linked card payment row",
    amountCents: 1000,
    balanceCents: null,
    raw: [],
    entryId: transfer.id,
    settlementId: null,
    skipped: false,
    dismissedTransferIds: [],
    updatedAt: now,
  }));
  ledger.bankRows = [...(ledger.bankRows ?? []), ...rows];
  return ledger;
}

test("card payment health and payer choices use shadcn views", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(healthScenario());

  await app.goToView("Accounts");
  await app.checkA11y();
  await expect(page.getByText("In credit", { exact: false })).toBeVisible();
  await expect(page.getByText("Possible duplicate", { exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "Add account", exact: true }).press("Enter");
  await page.getByRole("combobox", { name: "Paid by" }).click();
  await expect(page.getByRole("option", { name: "Batch 40 group" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "You" })).toBeVisible();
  await page.getByRole("combobox", { name: "Paid by" }).press("Escape");
  await page.getByRole("button", { name: "Cancel", exact: true }).press("Enter");

  await app.goToView("Health");
  await app.checkA11y();
  await expect(page.getByText("Amended amounts without a note", { exact: true })).toHaveCount(0);
});
