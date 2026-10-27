import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("review separates rows that need attention from waiting rows", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Activity");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  await app.checkA11y();
  await app.goToView("Review");
  await page.keyboard.press("Escape");
  await app.checkA11y();
  await expect(page.getByRole("tab", { name: /Needs you 2/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Waiting 1/ })).toBeVisible();
  await page.getByRole("tab", { name: /Waiting 1/ }).click();
  const waitingRow = page.getByRole("article").first();
  await expect(waitingRow).toBeVisible();
  const rowText = await waitingRow.innerText();
  const rowDate = rowText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  expect(rowDate).toBeTruthy();
  const expectedCoverageDate = new Date(`${rowDate}T00:00:00Z`);
  expectedCoverageDate.setUTCDate(expectedCoverageDate.getUTCDate() + 3);
  await expect(waitingRow).toContainText(`Waiting for another account's import to reach ${expectedCoverageDate.toISOString().slice(0, 10)}`);
});

test("skipping a bank row removes it from Review and offers Undo", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Review");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  await app.checkA11y();
  const row = page.getByRole("row").filter({ hasText: /Payment received/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Skip row" }).press("Enter");
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("keyboard shortcuts spend, move and skip rows", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Review");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  await app.checkA11y();
  const spendButton = page.getByRole("button", { name: "Spend row" }).first();
  await spendButton.focus();
  await page.keyboard.press("s");
  await expect(page.getByRole("heading", { name: "Review spend" })).toBeVisible();
  await page.getByRole("button", { name: "Save spend", exact: true }).press("Enter");
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await expect(page.getByText("All caught up.")).toBeVisible();
});

test("spending a bank row adds it to Activity", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Review");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  await app.checkA11y();
  const row = page.locator("[data-review-row]").filter({ hasText: /\bCard payment\b/ }).first();
  await page.getByRole("button", { name: "Spend row" }).click();
  await page.getByRole("button", { name: "Save spend", exact: true }).click();
  await expect(row).toHaveCount(0);
  await app.goToView("Activity");
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Card payment/).first()).toBeAttached();
});
