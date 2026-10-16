import { expect, it } from "vitest";
import type { BankEvent } from "../src/application/import-contracts";
import { findPossibleTransfers } from "../src/domain/transfer-matching";

function event(
  id: string,
  accountId: string,
  date: string,
  amountCents: number,
): BankEvent {
  return {
    id,
    accountId,
    date,
    description: `Synthetic ${id}`,
    comparisonDescription: `Synthetic ${id}`,
    amountCents,
    balanceCents: null,
    currency: "AUD",
  };
}

it("suggests a unique exact-date opposite-sign cross-account pair", () => {
  const outgoing = event("outgoing", "account-a", "2026-10-03", -49036);
  const incoming = event("incoming", "account-b", "2026-10-03", 49036);

  expect(findPossibleTransfers([outgoing, incoming])).toEqual([
    { outgoing, incoming, amountCents: 49036 },
  ]);
});

it("does not suggest same-account, different-date, same-sign, or zero rows", () => {
  expect(
    findPossibleTransfers([
      event("same-account-out", "account-a", "2026-10-03", -1000),
      event("same-account-in", "account-a", "2026-10-03", 1000),
      event("different-date-in", "account-b", "2026-10-04", 1000),
      event("same-sign-in", "account-c", "2026-10-03", 1000),
      event("zero", "account-d", "2026-10-03", 0),
    ]),
  ).toEqual([]);
});

it("leaves repeated matching magnitudes unresolved instead of collapsing occurrences", () => {
  expect(
    findPossibleTransfers([
      event("out-a", "account-a", "2026-10-03", -1000),
      event("out-b", "account-b", "2026-10-03", -1000),
      event("in", "account-c", "2026-10-03", 1000),
    ]),
  ).toEqual([]);
});
