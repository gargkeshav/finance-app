import { describe, expect, it } from "vitest";
import {
  calculateHouseClaims,
  calculateSpendingSummary,
} from "../src/domain/accounting";

describe("local spending attribution", () => {
  it("attributes half of House spending without creating a partner debt", () => {
    const summary = calculateSpendingSummary([
      {
        id: "personal-house",
        amountCents: 12000,
        allocations: [{ bucket: "house", amountCents: 12000 }],
      },
      {
        id: "common-house",
        amountCents: 12000,
        allocations: [{ bucket: "house", amountCents: 12000 }],
      },
      {
        id: "mixed",
        amountCents: 15000,
        allocations: [
          { bucket: "house", amountCents: 10000 },
          { bucket: "personal", amountCents: 5000 },
        ],
      },
    ]);
    expect(summary).toEqual({
      grossCents: 39000n,
      houseCents: 34000n,
      attributedCents: 22000n,
    });
  });

  it("excludes reversed expenses and assigns an aggregate residual cent consistently", () => {
    const summary = calculateSpendingSummary(
      [
        {
          id: "active",
          amountCents: 101,
          allocations: [{ bucket: "house", amountCents: 101 }],
        },
        {
          id: "reversed",
          amountCents: 500,
          allocations: [{ bucket: "personal", amountCents: 500 }],
        },
      ],
      new Set(["reversed"]),
    );
    expect(summary).toEqual({
      grossCents: 101n,
      houseCents: 101n,
      attributedCents: 51n,
    });
  });
});

describe("House reimbursement claim derivation", () => {
  it("claims personal-funded House portions, excludes common funding and reversals", () => {
    const accounts = [
      { id: "personal", role: "personal" as const },
      { id: "common", role: "common" as const },
    ];
    const claims = calculateHouseClaims(
      [
        {
          id: "personal-house",
          accountId: "personal",
          date: "2026-10-01",
          description: "House-only expense",
          allocations: [{ bucket: "house", amountCents: 12000 }],
        },
        {
          id: "mixed-house",
          accountId: "personal",
          date: "2026-10-02",
          description: "Mixed expense",
          allocations: [
            { bucket: "house", amountCents: 10000 },
            { bucket: "personal", amountCents: 5000 },
          ],
        },
        {
          id: "common-house",
          accountId: "common",
          date: "2026-10-03",
          description: "Common account expense",
          allocations: [{ bucket: "house", amountCents: 20000 }],
        },
        {
          id: "reversed-house",
          accountId: "personal",
          date: "2026-10-04",
          description: "Reversed expense",
          allocations: [{ bucket: "house", amountCents: 5000 }],
        },
      ],
      accounts,
      new Set(["reversed-house"]),
      [{ expenseId: "mixed-house", amountCents: 4000 }],
    );

    expect(
      claims.map((claim) => [
        claim.expenseId,
        claim.amountCents,
        claim.appliedCents,
        claim.outstandingCents,
      ]),
    ).toEqual([
      ["personal-house", 12000n, 0n, 12000n],
      ["mixed-house", 10000n, 4000n, 6000n],
    ]);
  });

  it("excludes a fully settled House claim", () => {
    expect(
      calculateHouseClaims(
        [
          {
            id: "settled",
            accountId: "personal",
            date: "2026-10-01",
            description: "Settled House expense",
            allocations: [{ bucket: "house", amountCents: 5000 }],
          },
        ],
        [{ id: "personal", role: "personal" }],
        new Set(),
        [{ expenseId: "settled", amountCents: 5000 }],
      ),
    ).toEqual([]);
  });

  it("claims only account-funded House portions of a mixed-source allocation", () => {
    const claims = calculateHouseClaims(
      [
        {
          id: "mixed-funding-house",
          accountId: "personal",
          date: "2026-10-01",
          description: "Synthetic mixed-funding House purchase",
          allocations: [
            {
              bucket: "house",
              amountCents: 1518,
              fundingSources: [
                {
                  kind: "account",
                  accountId: "personal",
                  amountCents: 518,
                },
                { kind: "other", accountId: null, amountCents: 1000 },
              ],
            },
          ],
        },
      ],
      [{ id: "personal", role: "personal" }],
    );

    expect(claims[0].amountCents).toBe(518n);
  });
});
