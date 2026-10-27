import { expect } from "@playwright/test";
import { scenario } from "./fixtures/ledger";
import { test } from "./fixtures/app";

async function openActivityView(page: import("@playwright/test").Page) {
  const activity = page.getByRole("button", { name: "Activity", exact: true });
  if (!(await activity.isVisible())) {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  }
  await activity.click();
  await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
}

async function openMobileSidebar(page: import("@playwright/test").Page) {
  if (await page.evaluate(() => window.innerWidth < 768)) {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  }
}

async function selectFileAction(page: import("@playwright/test").Page, action: string) {
  const fileActions = page.getByRole("button", { name: "Ledger file actions" });
  const menuItem = page.getByRole("menuitem", { name: action, exact: true });
  if (await page.evaluate(() => window.innerWidth < 768)) {
    await fileActions.press("Enter");
    await menuItem.press("Enter");
  } else {
    await fileActions.click();
    await menuItem.click();
  }
}

async function activityEntry(page: import("@playwright/test").Page, description: string) {
  if (await page.evaluate(() => window.innerWidth < 640)) {
    return page.getByRole("article").filter({ hasText: description }).getByRole("button");
  }
  return page.getByRole("table").getByText(description, { exact: true });
}

test("a ledger can be opened and saved through the file controls", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.basic());
  await openActivityView(page);
  await app.checkA11y();
  await openMobileSidebar(page);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await selectFileAction(page, "Save");
  const status = page.getByRole("region", { name: "Ledger file" }).getByRole("status");
  await expect(status).toHaveText("Saving…");
  await expect(status).toHaveText("Saved");

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await app.failNextWrite();
  const description = page.getByRole("textbox", { name: "Fuel description" });
  await description.fill("Fuel and parking");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  await openMobileSidebar(page);
  await expect(status).toHaveText("Not saved · retrying", { timeout: 5000 });
  await expect.poll(async () => (await app.savedLedger()).entries.some((entry) => entry.description === "Fuel and parking")).toBe(true);
  await expect(status).toHaveText("Saved", { timeout: 5000 });

  await openActivityView(page);
  const saved = await app.savedLedger();
  expect(saved.schemaVersion).toBe(1);
  expect(saved.entries).toHaveLength(3);

  await (await activityEntry(page, "Fuel and parking")).click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  const confirmDelete = page.getByRole("alertdialog");
  await expect(confirmDelete).toBeVisible();
  await confirmDelete.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
});

test("the app offers to reopen the last file after reload", async ({ app, page }) => {
  await app.goto();
  await app.openLedger(scenario.basic());
  await page.reload();
  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  await openActivityView(page);
  await app.checkA11y();
});

test("unsaved work without an open file is marked not saved", async ({ app, page }) => {
  await app.goto();
  const status = page.getByRole("region", { name: "Ledger file" }).getByRole("status");
  await openMobileSidebar(page);
  await expect(status).toHaveText("Saved");
  await openActivityView(page);
  await app.checkA11y();
  await page.getByRole("button", { name: "Add spend", exact: true }).click();
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Unfiled spend");
  await page.getByRole("textbox", { name: "Amount (AUD)", exact: true }).fill("10.00");
  await page.getByRole("button", { name: "All to You", exact: true }).click();
  await page.getByRole("button", { name: "Save spend", exact: true }).click();
  await openMobileSidebar(page);
  await expect(status).toHaveText("Not saved");
});
