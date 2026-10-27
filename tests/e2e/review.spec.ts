import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("review separates rows that need attention from waiting rows", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("Review");
  await expect(page.getByRole("heading", { name: /Review 2 need you \+1 waiting/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Waiting on another account" })).toContainText("1");
});

test("skipping a bank row removes it from Review", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("Review");
  const isMobile = await page.evaluate(() => window.innerWidth < 640);
  const row = isMobile
    ? page.getByRole("article").filter({ hasText: /Payment received/ })
    : page.getByRole("row", { name: /Payment received/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Skip", exact: true }).press("Enter");
  await expect(row).toHaveCount(0);
});

test("spending a bank row adds it to Activity", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("Review");
  const isMobile = await page.evaluate(() => window.innerWidth < 640);
  const row = isMobile
    ? page.getByRole("article").filter({ hasText: /Card payment/ })
    : page.getByRole("row", { name: /Card payment/ });
  await row.getByRole("button", { name: "Spend", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Save spend", exact: true }).press("Enter");
  await expect(row).toHaveCount(0);
  await app.goToView("Activity");
  await app.checkA11y();
  if (isMobile) {
    await expect(page.getByRole("article").filter({ hasText: "Card payment" })).toBeVisible();
  } else {
    await expect(page.getByRole("textbox", { name: "Card payment description" })).toBeVisible();
  }
});
