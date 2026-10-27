import { expect } from "@playwright/test";
import { suggestRuleFromHistory } from "../../src/domain/rules";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("create a suggested rule, preview it, and apply it", async ({ app, page }) => {
  await app.goto();
  const ledger = scenario.ruleSuggestion();
  expect(suggestRuleFromHistory(ledger.entries, ledger.rules ?? [])).not.toBeNull();
  await app.openLedger(ledger);
  await app.goToView("Rules");
  await expect(page.getByRole("heading", { name: "Rules", exact: true }).first()).toBeVisible();
  await page.getByText("Ledger opened.").waitFor({ state: "hidden" });
  await app.checkA11y();
  await expect(page.getByText("Suggested rule", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add rule", exact: true })).toBeVisible();
  await page.getByLabel("Scope").selectOption("existingEntries");
  await page.getByLabel("Protect manual edits").uncheck();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText(/\d+ matching items/)).toBeVisible();
  await app.checkA11y();

  await page.getByRole("button", { name: "Apply rules", exact: true }).click();
  await expect(page.getByText(/\d+ matching items/)).toBeHidden();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Synthetic cafe", exact: true })).toBeVisible();
});
