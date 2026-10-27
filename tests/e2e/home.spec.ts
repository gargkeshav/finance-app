import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("home shows owed, owe and monthly totals", async ({ app, page }) => {
  await app.goto();
  const viewport = page.viewportSize();
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  if (!viewport || viewport.width >= 640) await app.checkA11y();
  await app.openLedger(scenario.full());
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Owed to you").first()).toBeVisible();
  await expect(page.getByText("You owe")).toBeVisible();
  await expect(page.getByText("This month")).toBeVisible();
  await expect(page.getByText("$45.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$88.50", { exact: true })).toBeVisible();
});
