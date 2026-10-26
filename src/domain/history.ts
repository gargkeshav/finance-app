import type { Ledger } from "./ledger";

export type ChangeActor = "you" | "rule" | "import" | "splitwise" | "matcher" | "system";

export interface ChangeRecord {
  collection: string;
  id: string;
  before: unknown | null;
  after: unknown | null;
}

export interface ChangeSet {
  id: string;
  at: string;
  actor: ChangeActor;
  reason: string;
  records: ChangeRecord[];
}

const collections = [
  "entities",
  "accounts",
  "entries",
  "baselines",
  "settlements",
  "bankRows",
  "categories",
  "rules",
] as const;

type IdentifiedRecord = { id: string };

export function diffCollection(
  collection: string,
  before: readonly IdentifiedRecord[],
  after: readonly IdentifiedRecord[],
): ChangeRecord[] {
  const beforeById = new Map(before.map((record) => [record.id, record]));
  const afterById = new Map(after.map((record) => [record.id, record]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changes: ChangeRecord[] = [];

  for (const id of ids) {
    const previous = beforeById.get(id);
    const next = afterById.get(id);
    if (!previous) {
      changes.push({ collection, id, before: null, after: next ?? null });
    } else if (!next) {
      changes.push({ collection, id, before: previous, after: null });
    } else if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes.push({ collection, id, before: previous, after: next });
    }
  }

  return changes;
}

export function buildChangeSet(
  before: Ledger,
  after: Ledger,
  reason: string,
  actor: ChangeActor,
): ChangeSet | null {
  const records = collections.flatMap((collection) => {
    const previous = (before[collection] ?? []) as IdentifiedRecord[];
    const next = (after[collection] ?? []) as IdentifiedRecord[];
    return diffCollection(collection, previous, next);
  });

  if (!records.length) return null;
  return { id: crypto.randomUUID(), at: new Date().toISOString(), actor, reason, records };
}

export function revertChangeSet(ledger: Ledger, changeSet: ChangeSet): { ledger: Ledger; skipped: number } {
  const reverted = { ...ledger } as Ledger & Record<string, unknown>;
  let skipped = 0;

  for (const change of changeSet.records) {
    const records = ((reverted[change.collection] as IdentifiedRecord[] | undefined) ?? []).slice();
    const index = records.findIndex((record) => record.id === change.id);
    const current = index < 0 ? undefined : records[index];
    const matchesAfter = change.after === null
      ? current === undefined
      : current !== undefined && JSON.stringify(current) === JSON.stringify(change.after);

    if (!matchesAfter) {
      skipped += 1;
      continue;
    }

    if (change.before === null) {
      if (index >= 0) records.splice(index, 1);
    } else if (index >= 0) {
      records[index] = change.before as IdentifiedRecord;
    } else {
      records.push(change.before as IdentifiedRecord);
    }
    reverted[change.collection] = records;
  }

  return { ledger: reverted, skipped };
}