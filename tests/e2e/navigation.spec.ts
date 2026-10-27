import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

const views = [
  "Home", "Review", "Activity", "Settle", "Reports", "Balances", "Import",
  "Health", "Accounts", "People", "Rules", "Data", "History",
];

test("the sidebar opens every view without horizontal overflow", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
  await app.checkA11y();
  await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
  for (const view of views) {
    const navigationButton = page.getByRole("button", { name: view, exact: true });
    if (!(await navigationButton.isVisible())) {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    }
    await navigationButton.click();
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
    await expect(page.getByRole("heading", { name: new RegExp(`^${view}(?:\\s|$)`) }).first()).toBeVisible();
    if (await page.evaluate(() => window.innerWidth >= 768)) {
      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflows).toBe(false);
    }
  }

  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Search/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const mobileHealth = page.getByRole("button", { name: "Health", exact: true });
  await expect(mobileHealth).toBeVisible();
  await mobileHealth.click();
  await expect(page.getByRole("heading", { name: /^Health(?:\s|$)/ }).first()).toBeVisible();
});
