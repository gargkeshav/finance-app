import { centsSchema, sumCents } from "./value";

export const SELF_ENTITY_ID = "self";
export const HOUSE_ENTITY_ID = "house";

export type EntityKind = "self" | "house" | "person" | "group";
export type AccountType = "asset" | "credit";
export type EntryKind = "spend" | "transfer" | "income" | "refund";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  archived: boolean;
  updatedAt: string;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  payerEntityId: string;
  updatedAt: string;
}

export interface Portion {
  entityId: string;
  amountCents: number;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  date: string;
  description: string;
  amountCents: number;
  payerEntityId: string;
  accountId: string | null;
  portions: Portion[];
  countsTowardDebt: boolean;
  updatedAt: string;
}

export interface Baseline {
  id: string;
  entityId: string;
  amountCents: number;
  updatedAt: string;
}

export interface Ledger {
  schemaVersion: 1;
  entities: Entity[];
  accounts: Account[];
  entries: Entry[];
  baselines: Baseline[];
}

export interface Debt {
  debtorId: string;
  creditorId: string;
  amountCents: number;
}

export interface BalanceReport {
  byEntity: Record<string, number>;
  betweenEntities: Debt[];
}

export function validateSpend(entry: Entry): boolean {
  if (entry.kind !== "spend" || !Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) {
    return false;
  }

  const entityIds = new Set<string>();
  let portionTotal = 0n;
  for (const portion of entry.portions) {
    if (
      entityIds.has(portion.entityId) ||
      !Number.isSafeInteger(portion.amountCents) ||
      portion.amountCents <= 0
    ) {
      return false;
    }
    entityIds.add(portion.entityId);
    portionTotal += BigInt(portion.amountCents);
  }

  return portionTotal === BigInt(entry.amountCents);
}

export function debtsOf(entry: Entry): Debt[] {
  if (entry.kind !== "spend" || !entry.countsTowardDebt) return [];

  return entry.portions
    .filter((portion) => portion.entityId !== entry.payerEntityId)
    .map((portion) => ({
      debtorId: portion.entityId,
      creditorId: entry.payerEntityId,
      amountCents: portion.amountCents,
    }));
}

export function report(
  entries: readonly Entry[],
  from: string,
  to: string,
): { entries: Entry[]; personalCents: number; houseCents: number } {
  const spends = entries.filter(
    (entry) => entry.kind === "spend" && entry.date >= from && entry.date <= to,
  );
  const personalAmounts: number[] = [];
  const houseAmounts: number[] = [];

  for (const entry of spends) {
    for (const portion of entry.portions) {
      if (portion.entityId === SELF_ENTITY_ID) personalAmounts.push(portion.amountCents);
      if (portion.entityId === HOUSE_ENTITY_ID) {
        houseAmounts.push(portion.amountCents);
        personalAmounts.push(Math.ceil(portion.amountCents / 2));
      }
    }
  }

  return {
    entries: spends,
    personalCents: sumCents(personalAmounts),
    houseCents: sumCents(houseAmounts),
  };
}

export function balances(ledger: Ledger): BalanceReport {
  const selfEntityId = ledger.entities.find((entity) => entity.kind === "self")?.id;
  const nonSelfIds = ledger.entities
    .filter((entity) => entity.kind !== "self")
    .map((entity) => entity.id);
  const byEntityBig = new Map(nonSelfIds.map((id) => [id, 0n]));
  const pairBig = new Map<string, { firstId: string; secondId: string; amount: bigint }>();

  for (const baseline of ledger.baselines) {
    if (baseline.entityId !== selfEntityId) {
      byEntityBig.set(
        baseline.entityId,
        (byEntityBig.get(baseline.entityId) ?? 0n) + BigInt(baseline.amountCents),
      );
    }
  }

  for (const entry of ledger.entries) {
    for (const debt of debtsOf(entry)) {
      if (debt.debtorId === selfEntityId && debt.creditorId !== selfEntityId) {
        byEntityBig.set(
          debt.creditorId,
          (byEntityBig.get(debt.creditorId) ?? 0n) - BigInt(debt.amountCents),
        );
      } else if (debt.creditorId === selfEntityId && debt.debtorId !== selfEntityId) {
        byEntityBig.set(
          debt.debtorId,
          (byEntityBig.get(debt.debtorId) ?? 0n) + BigInt(debt.amountCents),
        );
      } else if (debt.debtorId !== selfEntityId && debt.creditorId !== selfEntityId) {
        const firstId = debt.debtorId < debt.creditorId ? debt.debtorId : debt.creditorId;
        const secondId = debt.debtorId < debt.creditorId ? debt.creditorId : debt.debtorId;
        const key = `${firstId}\u0000${secondId}`;
        const current = pairBig.get(key) ?? { firstId, secondId, amount: 0n };
        const direction = debt.debtorId === firstId ? 1n : -1n;
        current.amount += BigInt(debt.amountCents) * direction;
        pairBig.set(key, current);
      }
    }
  }

  const byEntity = Object.fromEntries(
    [...byEntityBig].map(([id, amount]) => [id, centsSchema.parse(Number(amount))]),
  );
  const betweenEntities = [...pairBig.values()]
    .filter((pair) => pair.amount !== 0n)
    .map((pair) => ({
      debtorId: pair.amount > 0n ? pair.firstId : pair.secondId,
      creditorId: pair.amount > 0n ? pair.secondId : pair.firstId,
      amountCents: centsSchema.parse(Number(pair.amount > 0n ? pair.amount : -pair.amount)),
    }));

  return { byEntity, betweenEntities };
}