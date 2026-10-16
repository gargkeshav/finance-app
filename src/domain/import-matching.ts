import type {
  BankEvent,
  BankImport,
  BankObservation,
  BankProfile,
} from "../application/import-contracts";

export interface ImportMatchCandidate {
  event: BankEvent;
  exactSourceFields: boolean;
  balanceEvidence: "same" | "different" | "unknown";
  matchingNeighbors: number;
}

function occurrenceKey(
  row: Pick<BankObservation, "date" | "amountCents" | "comparisonDescription">,
) {
  return JSON.stringify([row.date, row.amountCents, row.comparisonDescription]);
}

interface PriorOccurrence {
  rawFields: string[];
  previousKey: string | null;
  nextKey: string | null;
}

export function rankImportMatches(
  rows: readonly BankObservation[],
  accountId: string,
  profile: BankProfile | "",
  events: readonly BankEvent[],
  imports: readonly BankImport[],
): Map<number, ImportMatchCandidate[]> {
  const candidatesByKey = new Map<string, BankEvent[]>();
  for (const event of events) {
    if (event.accountId !== accountId) continue;
    const key = occurrenceKey(event);
    const group = candidatesByKey.get(key) ?? [];
    group.push(event);
    candidatesByKey.set(key, group);
  }

  const priorByEvent = new Map<string, PriorOccurrence[]>();
  for (const record of imports) {
    if (record.accountId !== accountId || record.profile !== profile) continue;
    const priorRows = [...record.rows].sort(
      (left, right) => left.observation.ordinal - right.observation.ordinal,
    );
    priorRows.forEach((row, index) => {
      const occurrences = priorByEvent.get(row.eventId) ?? [];
      occurrences.push({
        rawFields: row.observation.rawFields,
        previousKey:
          index > 0 ? occurrenceKey(priorRows[index - 1].observation) : null,
        nextKey:
          index + 1 < priorRows.length
            ? occurrenceKey(priorRows[index + 1].observation)
            : null,
      });
      priorByEvent.set(row.eventId, occurrences);
    });
  }

  const rowPositions = new Map(rows.map((row, index) => [row.ordinal, index]));
  const result = new Map<number, ImportMatchCandidate[]>();
  for (const row of rows) {
    const position = rowPositions.get(row.ordinal) ?? -1;
    const previousKey = position > 0 ? occurrenceKey(rows[position - 1]) : null;
    const nextKey =
      position >= 0 && position + 1 < rows.length
        ? occurrenceKey(rows[position + 1])
        : null;
    const rawFields = JSON.stringify(row.rawFields);
    const ranked = (candidatesByKey.get(occurrenceKey(row)) ?? []).map(
      (event): ImportMatchCandidate => {
        const occurrences = priorByEvent.get(event.id) ?? [];
        return {
          event,
          exactSourceFields: occurrences.some(
            (prior) => JSON.stringify(prior.rawFields) === rawFields,
          ),
          balanceEvidence:
            row.balanceCents === null || event.balanceCents === null
              ? "unknown"
              : row.balanceCents === event.balanceCents
                ? "same"
                : "different",
          matchingNeighbors: Math.max(
            0,
            ...occurrences.map(
              (prior) =>
                Number(
                  previousKey !== null && prior.previousKey === previousKey,
                ) + Number(nextKey !== null && prior.nextKey === nextKey),
            ),
          ),
        };
      },
    );
    ranked.sort(
      (left, right) =>
        Number(right.exactSourceFields) - Number(left.exactSourceFields) ||
        Number(right.balanceEvidence === "same") -
          Number(left.balanceEvidence === "same") ||
        right.matchingNeighbors - left.matchingNeighbors ||
        Number(left.balanceEvidence === "different") -
          Number(right.balanceEvidence === "different"),
    );
    result.set(row.ordinal, ranked);
  }
  return result;
}
