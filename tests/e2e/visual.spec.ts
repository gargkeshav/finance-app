import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

const views = [
  "Home",
  "Activity",
  "Import",
  "Review",
  "Settle",
  "Accounts",
  "People",
  "Balances",
  "Reports",
  "Data",
  "Rules",
  "Health",
  "History",
] as const;

test("all views fit and pass accessibility in light and dark mode", async ({ app, page }, testInfo) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await page.getByText("Ledger opened.").waitFor({ state: "hidden" });

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const view of views) {
      await app.goToView(view);
      await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await app.checkA11y();
      const fileName = view.toLowerCase().replaceAll(" ", "-");
      await page.screenshot({
        path: `test-results/views/${testInfo.project.name}/${colorScheme}/${fileName}.png`,
        fullPage: true,
      });
    }
  }
});
