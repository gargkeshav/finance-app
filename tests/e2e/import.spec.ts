import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("a synthetic CSV imports into an account and its row appears in Review", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.basic());
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("Import");
  await expect(page.getByRole("heading", { name: "Import CSV" })).toBeVisible();
  const today = new Date();
  const date = `${today.getUTCDate()} ${new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" }).format(today)} ${today.getUTCFullYear()}`;
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "CSV file", exact: true }).click(),
  ]);
  await fileChooser.setFiles({
    name: "synthetic-bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Date,Description,Amount\n${date},Playwright coffee,-12.50\n`),
  });
  await page.getByRole("combobox", { name: "Format" }).selectOption({ label: "HSBC · Suggested" });
  await expect(page.getByRole("button", { name: /Import 1 row/ })).toBeEnabled();
  await page.getByRole("button", { name: /Import 1 row/ }).press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toContainText("Import complete: 1 row added.");
  await app.goToView("Review");
  await expect(page.getByRole("heading", { name: /^Review/ })).toBeVisible();
  await page.getByText("Waiting on another account 1").click();
  await expect(page.getByText("Playwright coffee")).toBeVisible();
});
