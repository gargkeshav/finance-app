import { test as base, expect, type Page } from "@playwright/test";
import type { Ledger } from "../../../src/domain/ledger";

export interface AppFixture {
  goto: () => Promise<void>;
  openLedger: (ledger: Ledger) => Promise<void>;
  goToView: (view: string) => Promise<void>;
  savedLedger: () => Promise<Ledger>;
  failNextWrite: () => Promise<void>;
  checkA11y: () => Promise<void>;
}

const stateKey = "__financeTestState";

type TestState = {
  opened: string;
  saved: string;
  fileName: string;
  failNextWrite: boolean;
};

async function patchFilePickers(page: Page) {
  await page.addInitScript(() => {
    const key = "__financeTestState";
    const state: TestState = {
      opened: JSON.stringify({ schemaVersion: 1, entities: [], accounts: [], entries: [], baselines: [], settlements: [] }),
      saved: "",
      fileName: "test.finance.json",
      failNextWrite: false,
    };
    window.sessionStorage.setItem(key, JSON.stringify(state));
    const indexedDbPut = IDBObjectStore.prototype.put;
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      configurable: true,
      value: function (value: unknown, objectKey?: IDBValidKey) {
        let persistedValue = value;
        if (typeof value === "object" && value !== null && "name" in value && "getFile" in value) {
          persistedValue = { name: typeof value.name === "string" ? value.name : "" };
        }
        return Reflect.apply(indexedDbPut, this, objectKey === undefined ? [persistedValue] : [persistedValue, objectKey]);
      },
    });

    const readState = (): TestState => {
      const value = window.sessionStorage.getItem(key);
      if (!value) throw new Error("Test state has not been initialized.");
      return JSON.parse(value) as TestState;
    };

    class FakeHandle {
      constructor(readonly name: string, private readonly content: string) {}

      async getFile() {
        return new File([this.content], this.name, { type: "application/json" });
      }

      async createWritable() {
        return {
          async write(data: string | ArrayBuffer | Uint8Array) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const text = typeof data === "string" ? data : new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));
            const testState = readState();
            if (testState.failNextWrite) {
              testState.failNextWrite = false;
              window.sessionStorage.setItem(key, JSON.stringify(testState));
              throw new Error("Synthetic save failure.");
            }
            testState.saved = text;
            window.sessionStorage.setItem(key, JSON.stringify(testState));
          },
          async close() { return undefined; },
          async abort() { return undefined; },
        };
      }

      async queryPermission() { return "granted" as const; }
      async requestPermission() { return "granted" as const; }
    }

    const makeHandle = (name: string, content: string) => new FakeHandle(name, content);

    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => {
        const testState = readState();
        return [makeHandle(testState.fileName, testState.opened)];
      },
    });

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        const testState = readState();
        return makeHandle(testState.fileName, testState.saved || JSON.stringify({ schemaVersion: 1, entities: [], accounts: [], entries: [], baselines: [], settlements: [] }));
      },
    });
  });
}

export const test = base.extend<{ app: AppFixture }>({
  app: async ({ page }, use) => {
    await patchFilePickers(page);
    const app: AppFixture = {
      async goto() {
        await page.goto("/");
      },
      async openLedger(ledger: Ledger) {
        await page.evaluate(({ key, value }) => {
          const serialized = window.sessionStorage.getItem(key);
          if (!serialized) throw new Error("Test state has not been initialized.");
          const state = JSON.parse(serialized) as TestState;
          state.opened = JSON.stringify(value);
          state.fileName = "test.finance.json";
          window.sessionStorage.setItem(key, JSON.stringify(state));
        }, { key: stateKey, value: ledger });
        const fileActions = page.getByRole("button", { name: "Ledger file actions" });
        const mobileViewport = await page.evaluate(() => window.innerWidth < 768);
        if (mobileViewport) {
          await page.getByRole("button", { name: "Toggle navigation" }).click();
          await fileActions.press("Enter");
          await page.getByRole("menuitem", { name: "Open", exact: true }).press("Enter");
        } else {
          await fileActions.click();
          await page.getByRole("menuitem", { name: "Open", exact: true }).click();
        }
        await page.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("financeApp", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const transaction = database.transaction("handles", "readwrite");
          transaction.objectStore("handles").put({ name: "test.finance.json" }, "last");
          await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          });
        });
      },
      async goToView(view: string) {
        const navigationButton = page.getByRole("button", { name: view, exact: true });
        const mobileViewport = await page.evaluate(() => window.innerWidth < 768);
        const sidebar = page.getByRole("dialog", { name: "Sidebar" });
        if (mobileViewport ? !(await sidebar.isVisible()) : !(await navigationButton.isVisible())) {
          await page.getByRole("button", { name: "Toggle navigation" }).click();
        }
        await navigationButton.click();
        await expect(sidebar).toBeHidden();
      },
      async savedLedger() {
        const text = await page.evaluate((key) => {
          const serialized = window.sessionStorage.getItem(key);
          if (!serialized) throw new Error("Test state has not been initialized.");
          const state = JSON.parse(serialized) as TestState;
          return state.saved || state.opened;
        }, stateKey);
        return JSON.parse(text) as Ledger;
      },
      async failNextWrite() {
        await page.evaluate((key) => {
          const serialized = window.sessionStorage.getItem(key);
          if (!serialized) throw new Error("Test state has not been initialized.");
          const state = JSON.parse(serialized) as TestState;
          state.failNextWrite = true;
          window.sessionStorage.setItem(key, JSON.stringify(state));
        }, stateKey);
      },
      async checkA11y() {
        const { default: AxeBuilder } = await import("@axe-core/playwright");
        const axe = await new AxeBuilder({ page }).exclude("[data-sonner-toaster]").analyze();
        expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
      },
    };
    await use(app);
  },
});
