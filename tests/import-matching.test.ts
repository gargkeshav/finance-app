import { expect, it } from "vitest";
import {
  bankImportSchema,
  type BankEvent,
  type BankImport,
  type BankObservation,
} from "../src/application/import-contracts";
import { rankImportMatches } from "../src/domain/import-matching";

const accountId = "00000000-0000-4000-8000-000000000001";

function observation(
  ordinal: number,
  description: string,
  amountCents: number,
  rawValue: string,
  balanceCents: number | null = null,
): BankObservation {
  return {
    ordinal,
    rawFields: [rawValue],
    date: "2026-10-03",
    description,
    comparisonDescription: description,
    amountCents,
    balanceCents,
    currency: "AUD",
  };
}

function event(
  id: string,
  description: string,
  amountCents: number,
  balanceCents: number | null = null,
): BankEvent {
  return {
    id,
    accountId,
    date: "2026-10-03",
    description,
    comparisonDescription: description,
    amountCents,
    balanceCents,
    currency: "AUD",
  };
}

function priorImport(
  id: string,
  rows: Array<{
    observation: BankObservation;
    eventId: string;
    rejectedEventIds?: string[];
  }>,
  profile: BankImport["profile"] = "ing",
): BankImport {
  return {
    id,
    accountId,
    profile,
    fileName: `${id}.csv`,
    contentHash: id.padEnd(64, "0"),
    headers: null,
    originalBase64: null,
    rows: rows.map(({ observation: source, eventId, rejectedEventIds }) => ({
      observation: source,
      eventId,
      decision: "new",
      rejectedEventIds: rejectedEventIds ?? [],
    })),
  };
}

it("ranks matching adjacent sequence and balance evidence first", () => {
  const neighbor = observation(2, "Synthetic sequence anchor", -100, "anchor");
  const candidateRow = observation(
    3,
    "Synthetic repeated charge",
    -999,
    "current-source-row",
    10000,
  );
  const currentNeighbor = observation(
    2,
    "Synthetic sequence anchor",
    -100,
    "current-anchor",
  );
  const currentRow = observation(
    3,
    "Synthetic repeated charge",
    -999,
    "current-source-row",
    10000,
  );
  const firstEventId = "00000000-0000-4000-8000-000000000011";
  const secondEventId = "00000000-0000-4000-8000-000000000012";
  const firstNeighborId = "00000000-0000-4000-8000-000000000013";
  const secondNeighborId = "00000000-0000-4000-8000-000000000014";
  const events = [
    event(firstEventId, "Synthetic repeated charge", -999, 10000),
    event(secondEventId, "Synthetic repeated charge", -999, 9000),
    event(firstNeighborId, "Synthetic sequence anchor", -100),
    event(secondNeighborId, "Different prior neighbor", -100),
  ];
  const imports = [
    priorImport("first", [
      { observation: neighbor, eventId: firstNeighborId },
      { observation: candidateRow, eventId: firstEventId },
    ]),
    priorImport("second", [
      {
        observation: observation(2, "Different prior neighbor", -100, "other"),
        eventId: secondNeighborId,
      },
      {
        observation: observation(
          3,
          "Synthetic repeated charge",
          -999,
          "other-row",
          9000,
        ),
        eventId: secondEventId,
      },
    ]),
  ];

  const ranked = rankImportMatches(
    [currentNeighbor, currentRow],
    accountId,
    "ing",
    events,
    imports,
  ).get(currentRow.ordinal);

  expect(ranked?.map((candidate) => candidate.event.id)).toEqual([
    firstEventId,
    secondEventId,
  ]);
  expect(ranked?.[0]).toMatchObject({
    exactSourceFields: true,
    balanceEvidence: "same",
    matchingNeighbors: 1,
  });
  expect(ranked?.[1]).toMatchObject({
    balanceEvidence: "different",
    matchingNeighbors: 0,
  });
});

it("preserves equally supported repeated transactions as separate choices", () => {
  const row = observation(2, "Synthetic repeated charge", -999, "same");
  const firstId = "00000000-0000-4000-8000-000000000021";
  const secondId = "00000000-0000-4000-8000-000000000022";
  const ranked = rankImportMatches(
    [row],
    accountId,
    "ing",
    [
      event(firstId, row.description, row.amountCents),
      event(secondId, row.description, row.amountCents),
    ],
    [],
  ).get(row.ordinal);

  expect(ranked?.map((candidate) => candidate.event.id)).toEqual([
    firstId,
    secondId,
  ]);
  expect(ranked?.every((candidate) => !candidate.exactSourceFields)).toBe(true);
  expect(ranked?.every((candidate) => candidate.matchingNeighbors === 0)).toBe(
    true,
  );
});

it("does not treat another profile's raw fields as matching evidence", () => {
  const row = observation(2, "Synthetic charge", -250, "same-fields");
  const eventId = "00000000-0000-4000-8000-000000000031";
  const ranked = rankImportMatches(
    [row],
    accountId,
    "ing",
    [event(eventId, row.description, row.amountCents)],
    [priorImport("other-profile", [{ observation: row, eventId }], "hsbc")],
  ).get(row.ordinal);

  expect(ranked?.[0]).toMatchObject({
    exactSourceFields: false,
    matchingNeighbors: 0,
  });
});

it("marks a previously rejected candidate while keeping it available", () => {
  const row = observation(2, "Synthetic charge", -250, "source-row");
  const eventId = "00000000-0000-4000-8000-000000000041";
  const ranked = rankImportMatches(
    [row],
    accountId,
    "ing",
    [event(eventId, row.description, row.amountCents)],
    [
      priorImport("rejected", [
        {
          observation: row,
          eventId: "00000000-0000-4000-8000-000000000042",
          rejectedEventIds: [eventId],
        },
      ]),
    ],
  ).get(row.ordinal);

  expect(ranked).toHaveLength(1);
  expect(ranked?.[0].event.id).toBe(eventId);
  expect(ranked?.[0].previouslyRejected).toBe(true);
});

it("defaults rejected candidate provenance for existing schema-3 imports", () => {
  const row = observation(2, "Synthetic charge", -250, "source-row");
  const eventId = "00000000-0000-4000-8000-000000000051";
  const current = {
    ...priorImport("legacy", [{ observation: row, eventId }]),
    id: "00000000-0000-4000-8000-000000000061",
    contentHash: "a".repeat(64),
  };
  const legacyRow: Record<string, unknown> = { ...current.rows[0] };
  delete legacyRow.rejectedEventIds;
  const parsed = bankImportSchema.parse({ ...current, rows: [legacyRow] });

  expect(parsed.rows[0].rejectedEventIds).toEqual([]);
});
