import { expect, test } from "@playwright/test";

test("import preserves multiplicity, exact retries and explicit overlapping occurrences", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  await page.getByLabel("Account name").fill("Synthetic import account");
  await page.getByRole("button", { name: "Save account" }).click();
  const header = "Date,Description,Credit,Debit,Balance\n";
  const row = "3/10/2026,Synthetic repeated purchase,,-9.99,\n";
  async function selectCsv(name: string, content: string) {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByLabel("Bank CSV", { exact: true }).setInputFiles({
      name,
      mimeType: "text/csv",
      buffer: Buffer.from(content),
    });
    await expect(
      page.getByRole("combobox", { name: /^Bank profile/ }),
    ).toHaveValue("ing");
    await page
      .getByLabel("Import account")
      .selectOption({ label: "Synthetic import account" });
  }
  async function commit() {
    await page.getByLabel("I confirm this account").check();
    await page
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await selectCsv("synthetic.csv", header + row.repeat(3));
  await expect(
    page.getByText("3 parsed rows / 3 new / 0 linked / 0 awaiting decision"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/import-preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/import-preview-narrow.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await commit();
  await expect(
    page.getByRole("cell", { name: "AUD -9.99", exact: true }),
  ).toHaveCount(3);
  await selectCsv("renamed-synthetic.csv", header + row.repeat(3));
  await expect(
    page.getByText("Exact file already imported", { exact: false }),
  ).toBeVisible();
  await commit();
  await expect(
    page.getByRole("cell", { name: "AUD -9.99", exact: true }),
  ).toHaveCount(3);
  await selectCsv("overlap-synthetic.csv", header + row.repeat(4));
  await expect(
    page.getByText("4 parsed rows / 0 new / 0 linked / 4 awaiting decision"),
  ).toBeVisible();
  const first = page.getByLabel("Occurrence decision for row 2", {
    exact: true,
  });
  const options = await first
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  await first.selectOption(options[2]);
  await page
    .getByLabel("Occurrence decision for row 3", { exact: true })
    .selectOption(options[3]);
  await page
    .getByLabel("Occurrence decision for row 4", { exact: true })
    .selectOption(options[4]);
  await page
    .getByLabel("Occurrence decision for row 5", { exact: true })
    .selectOption("new");
  await expect(
    page.getByText("4 parsed rows / 1 new / 3 linked / 0 awaiting decision"),
  ).toBeVisible();
  await commit();
  await expect(
    page.getByRole("cell", { name: "AUD -9.99", exact: true }),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByLabel("Manual ledger totals").getByText("AUD 0.00"),
  ).toHaveCount(2);
});

test("multi-file import confirms and commits each file independently", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  await page.getByLabel("Account name").fill("Batch import account");
  await page.getByRole("button", { name: "Save account" }).click();
  const header = "Date,Description,Credit,Debit,Balance\n";
  const files = ["first.csv", "second.csv"].map((name, index) => ({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(
      `${header}4/${index + 1}/2026,Synthetic batch ${index + 1},,-${index + 1}.00,\n`,
    ),
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("Bank CSV", { exact: true }).setInputFiles(files);
  await expect(
    page.getByText("2 files selected", { exact: false }),
  ).toBeVisible();

  for (const [index, name] of ["first.csv", "second.csv"].entries()) {
    await expect(page.getByText(name, { exact: false })).toBeVisible();
    await page
      .getByRole("combobox", { name: /^Bank profile/ })
      .selectOption("ing");
    await page
      .getByLabel("Import account")
      .selectOption({ label: "Batch import account" });
    await page.getByLabel("I confirm this account").check();
    await page.getByRole("button", { name: "Confirm import" }).click();
    if (index === 0) {
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByText("second.csv", { exact: false }),
      ).toBeVisible();
    }
  }
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "AUD -1.00", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("cell", { name: "AUD -2.00", exact: true }),
  ).toHaveCount(1);
});
