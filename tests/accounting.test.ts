import { describe, expect, it } from "vitest";
import { calculateSpendingSummary } from "../src/domain/accounting";

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
