import { expect } from "@playwright/test";
import { parseLedger, stringifyLedger } from "../../src/adapters/file-ledger";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("reverting the latest change undoes it", async ({ app, page }) => {
  await app.goto();
  const ledger = parseLedger(stringifyLedger(scenario.full()));
  const originalEntry = ledger.entries.find((entry) => entry.id === "full-5");
  if (!originalEntry) throw new Error("The synthetic history entry is missing.");
  const before = { ...originalEntry, description: "Dinner with Alex", updatedAt: "2026-10-25T00:00:00.000Z" };
  const after = { ...originalEntry, description: "Dinner with Alex at the cafe", updatedAt: "2026-10-26T00:00:00.000Z" };
  const withLatestChange = {
    ...ledger,
    entries: ledger.entries.map((entry) => entry.id === originalEntry.id ? after : entry),
    history: [{
      id: "history-edit",
      at: new Date().toISOString(),
      actor: "you" as const,
      reason: "Edit description",
      records: [{
        collection: "entries",
        id: originalEntry.id,
        before,
        after,
      }],
    }],
  };
  await app.openLedger(withLatestChange);
  await app.goToView("History");
  await expect(page.locator("td:visible, h3:visible").filter({ hasText: /^Edit description$/ })).toBeVisible();
  await app.checkA11y();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.getByRole("button", { name: "Revert latest change" }).press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Revert", exact: true }).click();
  await app.goToView("Activity");
  await app.checkA11y();
  await expect.poll(async () => (await app.savedLedger()).entries.find((entry) => entry.id === originalEntry.id)?.description)
    .toBe(before.description);
});
