import { expect, it } from "vitest";
import { SyntheticLedger } from "../src/adapters/synthetic-ledger";
import {
  commandSchema,
  type LedgerCommand,
} from "../src/application/contracts";

it("resolves the same normalized input that execution persisted", async () => {
  const ledger = new SyntheticLedger();
  const command: LedgerCommand = {
    commandId: crypto.randomUUID(),
    expectedEpoch: (await ledger.read()).epoch,
    expectedRevision: 0,
    operation: {
      type: "createAccount",
      account: {
        id: crypto.randomUUID(),
        name: " Synthetic trimmed ",
        kind: "asset",
        role: "personal",
        currency: "AUD",
        openingBalanceCents: null,
        openingDate: null,
        version: 1,
      },
    },
  };
  await ledger.execute(command);
  expect((await ledger.resolve(command))?.accounts[0].name).toBe(
    "Synthetic trimmed",
  );
});

it("matches native account-version, allocation-identity, and exact retry constraints", async () => {
  const ledger = new SyntheticLedger();
  const epoch = (await ledger.read()).epoch;
  const account = {
    id: crypto.randomUUID(),
    name: "Synthetic account",
    kind: "asset",
    role: "personal",
    currency: "AUD",
    openingBalanceCents: null,
    openingDate: null,
    version: 1,
  };
  const command = commandSchema.parse({
    commandId: crypto.randomUUID(),
    expectedEpoch: epoch,
    expectedRevision: 0,
    operation: { type: "createAccount", account },
  });
  expect(
    commandSchema.safeParse({
      ...command,
      operation: { type: "createAccount", account: { ...account, version: 2 } },
    }).success,
  ).toBe(false);
  expect(await ledger.resolve(command)).toBeNull();
  await ledger.execute(command);
  expect((await ledger.execute(command)).auditCount).toBe(1);
  expect((await ledger.resolve(command))?.auditCount).toBe(1);
  const allocationId = crypto.randomUUID();
  const makeExpense = (expectedRevision: number): LedgerCommand =>
    commandSchema.parse({
      commandId: crypto.randomUUID(),
      expectedEpoch: epoch,
      expectedRevision,
      operation: {
        type: "createExpense",
        expense: {
          id: crypto.randomUUID(),
          accountId: account.id,
          date: "2026-10-03",
          description: "Synthetic expense",
          currency: "AUD",
          amountCents: 100,
          allocations: [
            {
              id: allocationId,
              bucket: "personal",
              personId: null,
              amountCents: 100,
            },
          ],
          version: 1,
        },
      },
    });
  await ledger.execute(makeExpense(1));
  await expect(ledger.execute(makeExpense(2))).rejects.toThrow(
    "Allocation already exists",
  );
  expect((await ledger.read()).revision).toBe(2);
});
