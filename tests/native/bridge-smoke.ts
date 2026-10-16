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
      const houseExpenseId = crypto.randomUUID();
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
      const sourceEventId = crypto.randomUUID();
      const sourceImportId = crypto.randomUUID();
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
            id: sourceImportId,
            accountId,
            profile: "ing",
            fileName: "synthetic-native.csv",
            contentHash,
            headers: preview.headers,
            originalBase64: null,
            reconciliations: [],
            rows: preview.rows.map((observation) => ({
              observation,
              eventId: sourceEventId,
              decision: "new",
              rejectedEventIds: [],
            })),
          },
        },
      });
      const overlapCsv =
        "Date,Description,Credit,Debit,Balance\n3/10/2026,Synthetic  imported groceries,,-15.18,\n";
      const overlapPreview = parseBankCsv(overlapCsv, "ing");
      if (overlapPreview.issues.length)
        throw new Error("Synthetic overlap CSV parsing failed.");
      const overlapEventId = crypto.randomUUID();
      const overlapImportId = crypto.randomUUID();
      const overlapHash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(overlapCsv),
          ),
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
            id: overlapImportId,
            accountId,
            profile: "ing",
            fileName: "synthetic-native-overlap.csv",
            contentHash: overlapHash,
            headers: overlapPreview.headers,
            originalBase64: null,
            reconciliations: [],
            rows: overlapPreview.rows.map((observation) => ({
              observation,
              eventId: overlapEventId,
              decision: "new",
              rejectedEventIds: [sourceEventId],
            })),
          },
        },
      });
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation: {
          type: "reconcileImport",
          importId: overlapImportId,
          ordinal: overlapPreview.rows[0].ordinal,
          expectedEventId: overlapEventId,
          candidateEventId: sourceEventId,
          reason: "Synthetic duplicate confirmed",
        },
      });
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation: {
          type: "createExpense",
          expense: {
            id: houseExpenseId,
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
                fundingSources: [
                  {
                    id: crypto.randomUUID(),
                    kind: "account",
                    accountId,
                    label: "Synthetic native account",
                    amountCents: 12000,
                  },
                ],
              },
            ],
            version: 1,
          },
        },
      });
      const commonAccountId = crypto.randomUUID();
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation: {
          type: "createAccount",
          account: {
            id: commonAccountId,
            name: "Synthetic native common account",
            kind: "asset",
            role: "common",
            currency: "AUD",
            openingBalanceCents: null,
            openingDate: null,
            version: 1,
          },
        },
      });
      snapshot = await ledger.execute({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation: {
          type: "applyHousePayment",
          payment: {
            id: crypto.randomUUID(),
            accountId: commonAccountId,
            date: "2026-10-10",
            description: "Synthetic native partial reimbursement",
            amountCents: 2000,
            applications: [{ expenseId: houseExpenseId, amountCents: 2000 }],
          },
        },
      });
    }
    if (
      snapshot.revision !== 7 ||
      snapshot.auditCount !== 7 ||
      snapshot.bankEvents[0]?.amountCents !== -1518 ||
      snapshot.bankEvents.length !== 1 ||
      snapshot.imports[1]?.rows[0]?.eventId !==
        snapshot.imports[0]?.rows[0]?.eventId ||
      snapshot.imports[1]?.reconciliations[0]?.reason !==
        "Synthetic duplicate confirmed" ||
      snapshot.imports[0]?.rows[0]?.observation.rawFields[3] !== "-15.18" ||
      snapshot.expenses[0]?.amountCents !== 12000 ||
      snapshot.housePayments[0]?.applications[0]?.amountCents !== 2000 ||
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
