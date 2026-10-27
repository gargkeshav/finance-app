import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("recording a settlement changes the balance and appears in History", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("Review");
  const bankRow = page.getByRole("row", { name: /Payment received/ });
  await bankRow.hover();
  await bankRow.getByText("More", { exact: true }).press("Enter");
  await page.getByRole("button", { name: /settlement/i }).press("Enter");
  await expect(page.getByRole("heading", { name: "Settle", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Who" }).selectOption({ label: "Alex" });
  await page.getByRole("combobox", { name: "Direction" }).selectOption({ label: "They paid me" });
  await page.getByRole("textbox", { name: "Amount" }).fill("100.00");
  await page.getByRole("textbox", { name: "Note" }).fill("Playwright settlement");
  await page.getByRole("button", { name: "Record", exact: true }).press("Enter");
  await expect(page.getByText("Playwright settlement")).toBeVisible();
  await expect.poll(async () => (await app.savedLedger()).settlements?.length).toBe(2);
  await app.goToView("History");
  await expect(page.getByRole("cell", { name: "Record settlement" })).toBeVisible();
});
