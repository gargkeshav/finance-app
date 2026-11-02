import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";
import { openItems } from "../../src/domain/ledger";

test("overpayments become credit, archived entities are hidden, and archive is confirmed", async ({ app, page }) => {
  await app.goto();
  const ledger = scenario.full();
  const alex = ledger.entities.find((entity) => entity.name === "Alex");
  expect(alex).toBeTruthy();
  const openAmount = openItems(ledger, alex!.id).theyOweYou.reduce((total, item) => total + item.openAmountCents, 0);
  expect(openAmount).toBeGreaterThan(0);
  ledger.entities.push({
    id: "archived-no-balance",
    kind: "person",
    name: "Archived no balance",
    archived: true,
    updatedAt: new Date().toISOString(),
  });
  await app.openLedger(ledger);
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("Review");
  const bankRow = page.getByRole("row", { name: /Payment received/ });
  await bankRow.hover();
  await bankRow.getByText("More actions", { exact: true }).press("Enter");
  await page.getByRole("button", { name: /settlement/i }).press("Enter");
  await expect(page.getByRole("heading", { name: "Settle", exact: true })).toBeVisible();
  await app.checkA11y();
  const who = page.getByRole("combobox", { name: "Who" });
  await who.click();
  await expect(page.getByRole("option", { name: "Archived no balance" })).toHaveCount(0);
  await page.getByRole("option", { name: /^Alex/ }).click();
  const direction = page.getByRole("combobox", { name: "Direction" });
  await direction.click();
  await page.getByRole("option", { name: "Alex paid you", exact: true }).click();
  const overpaymentCents = openAmount + 5000;
  const overpayment = `${Math.floor(overpaymentCents / 100)}.${String(overpaymentCents % 100).padStart(2, "0")}`;
  await page.getByRole("textbox", { name: "Amount" }).fill(overpayment);
  await page.getByRole("textbox", { name: "Note" }).fill("Playwright settlement");
  await page.getByRole("button", { name: "Record payment", exact: true }).press("Enter");
  await expect.poll(async () => (await app.savedLedger()).settlements?.some((settlement) => settlement.note === "Playwright settlement")).toBe(true);
  await expect(page.getByText("Credit", { exact: true })).toBeVisible();
  await expect(page.getByText("Credit from", { exact: false })).toBeVisible();
  await expect.poll(async () => (await app.savedLedger()).settlements?.length).toBe((ledger.settlements?.length ?? 0) + 1);
  await direction.click();
  await page.getByRole("option", { name: "You paid Alex", exact: true }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("50.00");
  await page.getByRole("button", { name: "Record payment", exact: true }).press("Enter");
  await expect(page.getByText(/Credit from .* payment/)).toHaveCount(0);
  await expect.poll(async () => (await app.savedLedger()).settlements?.length).toBe((ledger.settlements?.length ?? 0) + 2);

  await app.goToView("Balances");
  await app.checkA11y();
  await page.getByRole("button", { name: "Alex", exact: true }).click();
  await app.checkA11y();
  await expect(page.getByText(/includes .*50\.00 credit/)).toBeVisible();
  await page.getByText("Actions", { exact: true }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).press("Enter");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).press("Enter");

  await app.goToView("History");
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await expect.poll(async () => (await app.savedLedger()).history?.filter((change) => change.reason === "Record settlement").length).toBe(2);
});

test("settlement and balance workflows adapt at common viewport widths", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  const widths = [390, 768, 1280];

  await app.goToView("Settle");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Settle", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment", exact: true })).toBeVisible();
    if (width === 390) await app.checkA11y();
  }

  await app.goToView("Balances");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Balances", exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Alex", exact: true }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Alex", exact: true })).toBeVisible();
  }
});
