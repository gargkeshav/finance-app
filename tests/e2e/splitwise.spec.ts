import { expect, type Page } from "@playwright/test";
import { test, type AppFixture } from "./fixtures/app";
import type { Entity, Ledger } from "../../src/domain/ledger";

const user = { id: 7, first_name: "Jamie", last_name: "Tester" };
const friend = { id: 8, first_name: "Alex", last_name: "Example" };

function ledger(entities: Entity[] = []): Ledger {
  return {
    schemaVersion: 1,
    entities,
    accounts: [],
    entries: [],
    baselines: [],
    settlements: [],
  };
}

async function openPeople(
  page: Page,
  app: AppFixture,
  entities: Entity[] = [],
) {
  await app.goto();
  await app.openLedger(ledger(entities));
  await app.goToView("Activity");
  await app.checkA11y();
  await app.goToView("People");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
}

async function mockSession(page: Page, initiallyConnected: boolean) {
  let connected = initiallyConnected;
  await page.route("**/__splitwise/session", async (route) => {
    const method = route.request().method();
    if (method === "POST") connected = true;
    if (method === "DELETE") connected = false;
    await route.fulfill({
      status: method === "DELETE" ? 204 : 200,
      contentType: "application/json",
      body: method === "DELETE"
        ? ""
        : JSON.stringify({ connected, headerNames: connected ? ["Accept"] : [] }),
    });
  });
}

async function mockApi(page: Page, expired = false) {
  await page.route("**/splitwise-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/get_current_user")) {
      await route.fulfill(expired
        ? { status: 401, contentType: "application/json", body: JSON.stringify({ error: "expired" }) }
        : { status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
      return;
    }
    if (path.endsWith("/get_friends")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ friends: [friend] }) });
      return;
    }
    if (path.endsWith("/get_groups")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ groups: [] }) });
      return;
    }
    if (path.endsWith("/get_expenses")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          expenses: [{
            id: 125,
            group_id: null,
            description: "Cafe lunch",
            date: "2026-10-25T12:00:00Z",
            cost: "12.00",
            currency_code: "AUD",
            payment: false,
            updated_at: "2026-10-25T12:30:00Z",
            deleted_at: null,
            users: [
              { user_id: 7, paid_share: "12.00", owed_share: "0.00" },
              { user_id: 8, paid_share: "0.00", owed_share: "12.00" },
            ],
          }],
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("connects with a copied cURL and shows the Splitwise user", async ({ page, app }) => {
  await mockSession(page, false);
  await mockApi(page);
  await openPeople(page, app);

  await page.getByLabel("Paste a request copied as cURL from splitwise.com").fill(
    "curl 'https://secure.splitwise.com/api/v3.0/get_current_user' -H 'Accept: application/json'",
  );
  await page.getByRole("button", { name: "Connect", exact: true }).press("Enter");

  await expect(page.getByText("Connected as Jamie Tester")).toBeVisible();
  await expect(page.getByText("Request headers: Accept")).toBeVisible();
});

test("pulls a linked friend's expenses into Review", async ({ page, app }) => {
  await mockSession(page, true);
  await mockApi(page);
  const linkedFriend: Entity = {
    id: "friend-1",
    kind: "person",
    name: "Alex Example",
    archived: false,
    updatedAt: "2026-10-25T00:00:00.000Z",
    splitwise: { kind: "user", id: String(friend.id) },
  };
  await openPeople(page, app, [linkedFriend]);

  await expect(page.getByText("Connected as Jamie Tester")).toBeVisible();
  await page.getByLabel("First pull since").fill("2026-10-24");
  await page.getByRole("button", { name: "Pull", exact: true }).press("Enter");
  await app.goToView("Review");
  await expect(page.getByText("Cafe lunch", { exact: true })).toBeVisible();
});

test("shows Reconnect when the Splitwise session has expired", async ({ page, app }) => {
  await mockSession(page, true);
  await mockApi(page, true);
  await openPeople(page, app);

  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
});
