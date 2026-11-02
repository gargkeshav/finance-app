import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("reports start at the first recent spend month and export plain decimals", async ({ app, page }) => {
  const ledger = scenario.full();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const earliestAllowedDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const earliestAllowedMonth = `${earliestAllowedDate.getFullYear()}-${String(earliestAllowedDate.getMonth() + 1).padStart(2, "0")}`;
  const firstEntryMonth = ledger.entries
    .filter((entry) => entry.kind === "spend" || entry.kind === "refund" || entry.kind === "income")
    .map((entry) => entry.date.slice(0, 7))
    .filter((month) => month <= currentMonth)
    .sort()[0];
  const expectedStartMonth = firstEntryMonth
    ? firstEntryMonth > earliestAllowedMonth ? firstEntryMonth : earliestAllowedMonth
    : currentMonth;

  await app.goto();
  await app.openLedger(ledger);
  await app.goToView("Reports");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  await app.checkA11y();
  await expect(page.getByRole("textbox", { name: "Report start date" })).toHaveValue(`${expectedStartMonth}-01`);
  const monthlyPanel = page.getByRole("tabpanel", { name: "Monthly" });
  await expect(monthlyPanel.getByRole("button", { name: /\$\d+\.\d{2}/ }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "Report start date" }).fill(`${earliestAllowedMonth}-01`);
  const rowsWithoutEmptyMonths = await monthlyPanel.getByRole("row").count();
  await page.getByRole("switch", { name: "Show empty months" }).click();
  await expect(page.getByRole("switch", { name: "Show empty months" })).toBeChecked();
  const rowsWithEmptyMonths = await monthlyPanel.getByRole("row").count();
  expect(rowsWithEmptyMonths).toBeGreaterThan(rowsWithoutEmptyMonths);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).press("Enter");
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).not.toContain("$");
  expect(csv).toMatch(/"-?\d+\.\d{2}"/);
});

test("reports stay readable at mobile, tablet and desktop widths", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Reports");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Monthly" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Report start date" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await app.checkA11y();
  }
});
