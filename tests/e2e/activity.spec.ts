import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

test("activity filters, edits, and deletes entries through the sheet", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.full());
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
  await app.checkA11y();

  const search = page.getByRole("textbox", { name: "Search" });
  await search.fill("Coffee with Jo");
  const isMobile = await page.evaluate(() => window.innerWidth < 640);
  const coffeeEntry = (description = "Coffee with Jo") => isMobile
    ? page.getByRole("article").filter({ hasText: description }).getByRole("button")
    : page.getByRole("table").getByText(description, { exact: true });
  await expect(coffeeEntry()).toBeVisible();
  await expect(page.getByText("Trip group dinner")).toHaveCount(0);
  const beforeEdit = await app.savedLedger();
  const coffee = beforeEdit.entries.find((entry) => entry.description === "Coffee with Jo");
  expect(coffee).toBeDefined();
  const historyCount = beforeEdit.history?.length ?? 0;

  const description = page.getByRole("textbox", { name: "Coffee with Jo description" });
  await description.fill("Coffee with Jo in town");
  await page.waitForTimeout(1200);
  const beforeBlur = await app.savedLedger();
  expect(beforeBlur.entries.find((entry) => entry.id === coffee?.id)?.description).toBe("Coffee with Jo");
  expect(beforeBlur.history?.length ?? 0).toBe(historyCount);
  await page.keyboard.press("Enter");
  await expect.poll(async () => {
    const saved = await app.savedLedger();
    return saved.entries.find((entry) => entry.id === coffee?.id)?.description;
  }).toBe("Coffee with Jo in town");
  await expect.poll(async () => (await app.savedLedger()).history?.length ?? 0).toBeGreaterThan(historyCount);

  await search.fill("Coffee with Jo in town");
  await coffeeEntry(coffee?.displayName || "Coffee with Jo in town").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Edit entry", exact: true }).click();
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Coffee by the park");
  await page.getByRole("button", { name: "Save spend", exact: true }).click();
  await expect.poll(async () => (await app.savedLedger()).entries.find((entry) => entry.id === coffee?.id)?.displayName).toBe("Coffee by the park");

  await search.fill("Coffee by the park");
  const renamedEntry = isMobile
    ? page.getByRole("article").filter({ hasText: "Coffee by the park" }).getByRole("button")
    : page.getByRole("table").getByText("Coffee by the park", { exact: true });
  await renamedEntry.click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  const deleteDialog = page.getByRole("alertdialog");
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();

  await search.fill("Coffee with Jo in town");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Search" })).toHaveValue("Coffee with Jo in town");
});

test("an amended spend shows the amount line once", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.amended());
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
  await app.checkA11y();

  const isMobile = await page.evaluate(() => window.innerWidth < 640);
  const amendedEntry = isMobile
    ? page.getByRole("article").filter({ hasText: "Amended grocery purchase" }).getByRole("button")
    : page.getByRole("table").getByText("Amended grocery purchase", { exact: true });
  await amendedEntry.click();
  await page.getByRole("button", { name: "Edit entry", exact: true }).click();
  await expect(page.getByText(/Entry amount:/)).toHaveCount(1);
});
