import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("synthetic manual account and expense journey remains exact and accessible", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Synthetic preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  await page.getByLabel("Account name").fill("Synthetic everyday");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByText("No opening balance")).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Description").fill("Synthetic groceries");
  await page.getByLabel("Posting date").fill("2026-10-03");
  await page.getByLabel("Expense total").fill("586.32");
  await page.getByLabel("House portion").fill("419.40");
  await page.getByLabel("I confirm").check();
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(
    page.getByRole("cell", { name: "AUD 586.32", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Personal AUD 166.92")).toBeVisible();
  await expect(page.getByText("House AUD 419.40")).toBeVisible();
  await expect(page.getByText("2 audited commands")).toBeVisible();
  await page.getByRole("button", { name: /^Transactions/ }).click();
  await page.getByLabel("Search transactions").fill("missing");
  await expect(
    page.getByRole("heading", { name: "No transactions" }),
  ).toBeVisible();
  await page.getByLabel("Search transactions").fill("groceries");
  await expect(page.getByText("Synthetic groceries")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/ledger-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Add expense", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/ledger-narrow.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Synthetic groceries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transaction details" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Correct entry", exact: true })
    .click();
  await expect(page.getByLabel("Expense total")).toHaveValue("586.32");
  await page.getByLabel("Description").fill("Corrected synthetic groceries");
  await page.getByLabel("Expense total").fill("600.32");
  await page.getByLabel("Correction reason").fill("Corrected manual amount");
  await page.getByLabel("I confirm").check();
  await page.getByRole("button", { name: "Confirm correction" }).click();
  await expect(
    page.getByRole("cell", { name: "AUD 600.32", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Corrected synthetic groceries", exact: true })
    .click();
  await page.getByLabel("Reversal reason").fill("Entered twice manually");
  await page.getByLabel("Remove this entry from spending totals").check();
  await page
    .getByRole("button", { name: "Reverse entry", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Reversed / original retained")).toHaveCount(2);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByLabel("Manual ledger totals").getByText("AUD 0.00"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("cell", { name: "AUD 586.32", exact: true }),
  ).toBeVisible();
});

test("Sharing shows personal-funded House claims but excludes common funding", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  await page.getByLabel("Account name").fill("Personal account");
  await page.getByRole("button", { name: "Save account" }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Description").fill("Personal House purchase");
  await page.getByLabel("Posting date").fill("2026-10-03");
  await page
    .getByLabel("Paid from")
    .selectOption({ label: "Personal account" });
  await page.getByLabel("Expense total").fill("120.00");
  await page.getByLabel("House portion").fill("120.00");
  await page.getByLabel("I confirm").check();
  await page.getByRole("button", { name: "Save expense" }).click();

  await page.getByRole("button", { name: /^Sharing/ }).click();
  await expect(
    page.getByRole("heading", { name: "House reimbursement claims" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "AUD 120.00", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name").fill("House common account");
  await page.getByLabel("Ownership").selectOption("common");
  await page.getByRole("button", { name: "Save account" }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Description").fill("Common House purchase");
  await page.getByLabel("Posting date").fill("2026-10-04");
  await page
    .getByLabel("Paid from")
    .selectOption({ label: "House common account" });
  await page.getByLabel("Expense total").fill("80.00");
  await page.getByLabel("House portion").fill("80.00");
  await page.getByLabel("I confirm").check();
  await page.getByRole("button", { name: "Save expense" }).click();

  await page.getByRole("button", { name: /^Sharing/ }).click();
  await expect(
    page.getByRole("cell", { name: "AUD 120.00", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("cell", { name: "Common House purchase" }),
  ).toHaveCount(0);
});

test("invalid money does not save, Escape restores focus, and preview cannot persist", async ({
  page,
}) => {
  await page.goto("/");
  const add = page
    .getByRole("button", { name: "Add account", exact: true })
    .first();
  await add.click();
  await page.getByLabel("Account name").fill("Synthetic account");
  await page.getByLabel("Opening balance (AUD, optional)").fill("1.001");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("alert")).toContainText("at most two decimal");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  await page.getByLabel("Account name").fill("Synthetic account");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByText("1 audited commands")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.reload();
  await expect(page.getByText("0 audited commands")).toBeVisible();
});

test("an uncertain save retries only the original immutable command", async ({
  page,
}) => {
  await page.goto("/tests/e2e/recovery.html");
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  await page.getByLabel("Account name").fill("Synthetic recovery account");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "status check unavailable",
  );
  await expect(page.getByLabel("Account name")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry original command" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("1 audited commands")).toBeVisible();
  await expect(page.getByText("Synthetic recovery account")).toHaveCount(1);
});
