import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("home shows owed, owe and monthly totals", async ({ app, page }) => {
  await app.goto();
  const viewport = page.viewportSize();
  await expect(page.getByText("Ledger opened.")).toBeHidden();
  if (!viewport || viewport.width >= 640) await app.checkA11y();
  await app.openLedger(scenario.full());
  await app.goToView("Home");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Owed to you").first()).toBeVisible();
  await expect(page.getByText("You owe")).toBeVisible();
  await expect(page.getByText("This month")).toBeVisible();
  await expect(page.getByText("$45.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$88.50", { exact: true })).toBeVisible();
  await app.checkA11y();
});

test("home stays readable at mobile, tablet and desktop widths", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Home");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review next item" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await app.checkA11y();
  }
});
