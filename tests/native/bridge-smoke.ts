import { invoke } from "@tauri-apps/api/core";
import { NativeLedger } from "../../src/adapters/native-ledger";
import { parseBankCsv } from "../../src/adapters/banks/parse-bank";

function rendered(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (document.querySelector("main")?.textContent?.includes(text)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Native view did not render."));
    }, 15_000);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    check();
  });
}

export async function runNativeSmoke() {
  try {
    const ledger = new NativeLedger();
    let snapshot = await ledger.read();
    if (snapshot.revision === 0) {
      const accountId = crypto.randomUUID();
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: 0,
        operation: {
          type: "createAccount",
          account: {
            id: accountId,
            name: "Synthetic native account",
            kind: "asset",
            role: "personal",
            currency: "AUD",
            openingBalanceCents: null,
            openingDate: null,
            version: 1,
          },
        },
      });
      const csv =
        "Date,Description,Credit,Debit,Balance\n3/10/2026,Synthetic imported groceries,,-15.18,\n";
      const preview = parseBankCsv(csv, "ing");
      if (preview.issues.length)
        throw new Error("Synthetic CSV parsing failed.");
      const contentHash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation: {
          type: "commitImport",
          import: {
            id: crypto.randomUUID(),
            accountId,
            profile: "ing",
            fileName: "synthetic-native.csv",
            contentHash,
            headers: preview.headers,
            originalBase64: null,
            rows: preview.rows.map((observation) => ({
              observation,
              eventId: crypto.randomUUID(),
              decision: "new",
            })),
          },
        },
      });
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation: {
          type: "createExpense",
          expense: {
            id: crypto.randomUUID(),
            accountId,
            date: "2026-10-03",
            description: "Synthetic native groceries",
            currency: "AUD",
            amountCents: 12000,
            allocations: [
              {
                id: crypto.randomUUID(),
                bucket: "house",
                personId: null,
                amountCents: 12000,
              },
            ],
            version: 1,
          },
        },
      });
    }
    if (
      snapshot.revision !== 3 ||
      snapshot.auditCount !== 3 ||
      snapshot.bankEvents[0]?.amountCents !== -1518 ||
      snapshot.imports[0]?.rows[0]?.observation.rawFields[3] !== "-15.18" ||
      snapshot.expenses[0]?.amountCents !== 12000 ||
      snapshot.accounts[0]?.openingBalanceCents !== null
    ) {
      throw new Error("Native persistence invariant failed.");
    }
    await rendered("Overview");
    document
      .querySelector<HTMLButtonElement>('[aria-label="Reload ledger"]')
      ?.click();
    await rendered("Synthetic native account");
    await rendered("AUD 120.00");
    await invoke("finish_native_smoke", { success: true });
  } catch {
    await invoke("finish_native_smoke", { success: false });
  }
}
