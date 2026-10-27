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
  await expect(page.getByText("Edit description")).toBeVisible();
  await app.checkA11y();
  await page.getByRole("button", { name: /Revert/i }).press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Revert", exact: true }).click();
  await app.goToView("Activity");
  await app.checkA11y();
  const isMobile = await page.evaluate(() => window.innerWidth < 640);
  if (isMobile) {
    await expect(page.getByRole("article").filter({ hasText: "Dinner with Alex" })).toBeVisible();
  } else {
    await expect(page.getByRole("textbox", { name: "Dinner with Alex description" })).toHaveValue("Dinner with Alex");
  }
});
