import { centsSchema, sumCents } from "./value";
import type { CsvMapping } from "../adapters/csv-mapping";
import type { EntryRule } from "./rules";
import type { HistoryMapping } from "./history-import";

export const SELF_ENTITY_ID = "self";
export const HOUSE_ENTITY_ID = "house";

export type EntityKind = "self" | "house" | "person" | "group";
export type GroupType = "household" | "trip" | "friends" | "project" | "other";
export type AccountType = "asset" | "credit";
export type EntryKind = "spend" | "transfer" | "income" | "refund";
export type EntryOrigin = "manual" | "bank" | "splitwise" | "rule" | "memory" | "history";
export type CategoryNature = "essential" | "discretionary" | "oneOff" | "reimbursable" | "business" | "savings";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  archived: boolean;
  updatedAt: string;
  groupType?: GroupType;
  members?: { entityId: string; weight: number }[];
  defaultAllocation?: { mode: "shares" } | { mode: "percent"; yourPercent: number };
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  payerEntityId: string;
  mappingId?: string;
  updatedAt: string;
}

export interface Portion {
  entityId: string;
  amountCents: number;
  treatment?: "claim" | "writeOff" | "gift" | "reportOnly";
}

export type SplitPreset =
  | { kind: "payer" }
  | { kind: "halfHouse" }
  | { kind: "allHouse" }
  | { kind: "entity"; entityId: string }
  | { kind: "equal"; entityIds: string[] }
  | { kind: "shares"; shares: { entityId: string; weight: number }[] }
  | { kind: "percentEntity"; entityId: string; yourPercent: number };

export interface Category {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
  parentId?: string;
  nature?: CategoryNature;
}

export interface CategoryMemory {
  id: string;
  key: string;
  categoryId: string;
  entityId: string | null;
  updatedAt: string;
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
  refundOf?: string | null;
  bankRowIds?: string[];
  source?: EntryOrigin;
  ruleId?: string;
  displayName?: string;
  categoryId?: string | null;
  tags?: string[];
  note?: string;
  extraReimbursable?: boolean;
  chargedCents?: number;
  historyKey?: string;
  countsTowardDebt: boolean;
  updatedAt: string;
}

export interface LedgerImport {
  id: string;
  accountId: string;
  mappingId: string;
  fileName: string;
  contentHash: string;
  dateFrom: string | null;
  dateTo: string | null;
  countsTowardDebt: boolean;
  importedAt: string;
  updatedAt: string;
}

export interface BalanceCheckpoint {
  id: string;
  accountId: string;
  date: string;
  balanceCents: number;
  note: string;
  updatedAt: string;
}

export interface BankRow {
  id: string;
  accountId: string;
  importId: string;
  line: number;
  date: string;
  description: string;
  amountCents: number;
  balanceCents: number | null;
  raw: string[];
  entryId: string | null;
  settlementId: string | null;
  skipped: boolean;
  dismissedTransferIds: string[];
  updatedAt: string;
}

export interface Baseline {
  id: string;
  entityId: string;
  amountCents: number;
  updatedAt: string;
}

export type SettlementDirection = "theyPaidYou" | "youPaidThem";

export interface Settlement {
  id: string;
  date: string;
  entityId: string;
  direction: SettlementDirection;
  amountCents: number;
  bankRowIds: string[];
  note: string;
  splitwisePaymentId: string | null;
  updatedAt: string;
}

export interface Ledger {
  schemaVersion: 1;
  entities: Entity[];
  accounts: Account[];
  entries: Entry[];
  baselines: Baseline[];
  settlements?: Settlement[];
  mappings?: CsvMapping[];
  imports?: LedgerImport[];
  bankRows?: BankRow[];
  checkpoints?: BalanceCheckpoint[];
  categories?: Category[];
  categoryMemory?: CategoryMemory[];
  rules?: EntryRule[];
  lastSplitByAccount?: Record<string, SplitPreset>;
  historyMapping?: HistoryMapping;
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

export interface OpenItem {
  id: string;
  date: string;
  description: string;
  source: "baseline" | "entry";
  amountCents: number;
  openAmountCents: number;
}

export interface EntityOpenItems {
  theyOweYou: OpenItem[];
  youOweThem: OpenItem[];
}

export interface CoverageRange {
  from: string;
  to: string;
}

export interface AccountCoverage {
  ranges: CoverageRange[];
  gaps: CoverageRange[];
}

export interface CheckpointDifference {
  earlier: BalanceCheckpoint;
  later: BalanceCheckpoint;
  bankRowsCents: number;
  differenceCents: number;
}

export function splitPreset(amountCents: number, payerEntityId: string, preset: SplitPreset): Portion[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new RangeError("Split amount must be a positive whole number of cents.");
  }

  if (preset.kind === "payer") return [{ entityId: payerEntityId, amountCents }];
  if (preset.kind === "halfHouse") {
    const selfCents = Math.ceil(amountCents / 2);
    const houseCents = amountCents - selfCents;
    return [
      { entityId: SELF_ENTITY_ID, amountCents: selfCents },
      ...(houseCents > 0 ? [{ entityId: HOUSE_ENTITY_ID, amountCents: houseCents }] : []),
    ];
  }
  if (preset.kind === "allHouse") return [{ entityId: HOUSE_ENTITY_ID, amountCents }];
  if (preset.kind === "entity") return [{ entityId: preset.entityId, amountCents }];
  if (preset.kind === "percentEntity") {
    if (!Number.isInteger(preset.yourPercent) || preset.yourPercent < 0 || preset.yourPercent > 100) {
      throw new RangeError("Your percentage must be a whole number from 0 to 100.");
    }
    const selfCents = Number((BigInt(amountCents) * BigInt(preset.yourPercent) + 99n) / 100n);
    const entityCents = amountCents - selfCents;
    return [
      ...(selfCents > 0 ? [{ entityId: SELF_ENTITY_ID, amountCents: selfCents }] : []),
      ...(entityCents > 0 ? [{ entityId: preset.entityId, amountCents: entityCents }] : []),
    ];
  }
  if (preset.kind === "shares") {
    if (
      !preset.shares.length ||
      preset.shares.some((share) => !Number.isSafeInteger(share.weight) || share.weight <= 0) ||
      new Set(preset.shares.map((share) => share.entityId)).size !== preset.shares.length
    ) {
      throw new RangeError("Weighted split requires distinct entities with positive whole-number weights.");
    }
    const totalWeight = preset.shares.reduce((total, share) => total + BigInt(share.weight), 0n);
    const allocations = preset.shares.map((share) => ({
      entityId: share.entityId,
      weight: share.weight,
      amount: BigInt(amountCents) * BigInt(share.weight) / totalWeight,
    }));
    let remainder = BigInt(amountCents) - allocations.reduce((total, share) => total + share.amount, 0n);
    const remainderOrder = [...allocations].sort((first, second) =>
      second.weight - first.weight || first.entityId.localeCompare(second.entityId),
    );
    for (let index = 0; remainder > 0n; index += 1, remainder -= 1n) {
      remainderOrder[index % remainderOrder.length].amount += 1n;
    }
    return allocations
      .map((share) => ({ entityId: share.entityId, amountCents: Number(share.amount) }))
      .filter((share) => share.amountCents > 0);
  }

  if (!preset.entityIds.length || new Set(preset.entityIds).size !== preset.entityIds.length) {
    throw new RangeError("Equal split requires distinct entities.");
  }
  const baseCents = Math.floor(amountCents / preset.entityIds.length);
  const leftoverCents = amountCents % preset.entityIds.length;
  return preset.entityIds
    .map((entityId, index) => ({ entityId, amountCents: baseCents + (index < leftoverCents ? 1 : 0) }))
    .filter((portion) => portion.amountCents > 0);
}

export function defaultSplitPreset(entity: Entity, _amountCents: number): SplitPreset | null {
  if (entity.kind === "house" && !entity.defaultAllocation) return { kind: "halfHouse" };
  if (entity.kind !== "group" || !entity.defaultAllocation) return null;
  if (entity.defaultAllocation.mode === "percent") {
    return { kind: "percentEntity", entityId: entity.id, yourPercent: entity.defaultAllocation.yourPercent };
  }
  if (!entity.members?.length) return null;
  const shares = [...entity.members];
  if (!shares.some((share) => share.entityId === SELF_ENTITY_ID)) {
    shares.push({ entityId: SELF_ENTITY_ID, weight: 1 });
  }
  return { kind: "shares", shares };
}

export function categoryMemoryKey(accountId: string, description: string): string {
  const normalizedDescription = description.toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
  return `${accountId}:${normalizedDescription}`;
}

export function categoryNature(categories: readonly Category[], categoryId: string | null | undefined): CategoryNature | undefined {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  let category = categoryId ? categoriesById.get(categoryId) : undefined;
  for (let steps = 0; category && steps < categories.length; steps += 1) {
    if (category.nature) return category.nature;
    category = category.parentId ? categoriesById.get(category.parentId) : undefined;
  }
  return undefined;
}

export function linkedBankAmountCents(entry: Pick<Entry, "bankRowIds">, bankRows: readonly BankRow[]): number | null {
  if (!entry.bankRowIds?.length) return null;
  const linkedRows = bankRows.filter((row) => entry.bankRowIds?.includes(row.id));
  if (!linkedRows.length) return null;
  return Math.abs(sumCents(linkedRows.map((row) => row.amountCents)));
}

export function categoryMemoryAfterSpend(ledger: Ledger, entry: Entry, updatedAt: string): CategoryMemory[] {
  const memories = ledger.categoryMemory ?? [];
  if (entry.kind !== "spend" || !entry.bankRowIds?.length || !entry.categoryId) return memories;

  const key = categoryMemoryKey(entry.accountId ?? "", entry.description);
  const existing = memories.find((memory) => memory.key === key);
  const wholeEntity = entry.portions.length === 1 && entry.portions[0].amountCents === entry.amountCents;
  const memory: CategoryMemory = {
    id: existing?.id ?? crypto.randomUUID(),
    key,
    categoryId: entry.categoryId,
    entityId: wholeEntity ? entry.portions[0].entityId : null,
    updatedAt,
  };
  return [...memories.filter((candidate) => candidate.key !== key), memory];
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

export function debtsOf(entry: Entry, bankRows: readonly BankRow[] = []): Debt[] {
  if ((entry.kind !== "spend" && entry.kind !== "refund") || !entry.countsTowardDebt) return [];

  const debts = entry.portions
    .filter((portion) => (portion.treatment ?? "claim") === "claim" && portion.entityId !== entry.payerEntityId)
    .map((portion) => ({
      debtorId: portion.entityId,
      creditorId: entry.payerEntityId,
      amountCents: entry.kind === "refund" ? -portion.amountCents : portion.amountCents,
    }));

  const bankAmountCents = entry.kind === "spend" && !entry.extraReimbursable
    ? linkedBankAmountCents(entry, bankRows)
    : null;
  if (bankAmountCents === null || bankAmountCents >= entry.amountCents || !debts.length) return debts;

  const amount = BigInt(entry.amountCents);
  const bankAmount = BigInt(bankAmountCents);
  const totalDebt = debts.reduce((total, debt) => total + BigInt(debt.amountCents), 0n);
  const scaled = debts.map((debt, index) => ({
    ...debt,
    amount: BigInt(debt.amountCents) * bankAmount / amount,
    index,
  }));
  const targetTotal = totalDebt * bankAmount / amount;
  const remaining = targetTotal - scaled.reduce((total, debt) => total + debt.amount, 0n);
  const largestDebt = scaled.reduce((largest, debt) =>
    BigInt(debt.amountCents) > BigInt(largest.amountCents) ? debt : largest,
  );
  largestDebt.amount += remaining;

  return scaled.map(({ amount: debtAmount, index: _index, ...debt }) => ({
    ...debt,
    amountCents: centsSchema.parse(Number(debtAmount)),
  }));
}

export function report(
  entries: readonly Entry[],
  from: string,
  to: string,
): { entries: Entry[]; personalCents: number; houseCents: number } {
  const spends = entries.filter(
    (entry) => (entry.kind === "spend" || entry.kind === "refund") && entry.date >= from && entry.date <= to,
  );
  const personalAmounts: number[] = [];
  const houseAmounts: number[] = [];

  for (const entry of spends) {
    for (const portion of entry.portions) {
      const signedAmount = entry.kind === "refund" ? -portion.amountCents : portion.amountCents;
      if (portion.entityId === SELF_ENTITY_ID) personalAmounts.push(signedAmount);
      if (portion.entityId === HOUSE_ENTITY_ID) {
        houseAmounts.push(signedAmount);
        personalAmounts.push(Math.sign(signedAmount) * Math.ceil(Math.abs(signedAmount) / 2));
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
    for (const debt of debtsOf(entry, ledger.bankRows ?? [])) {
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

  for (const settlement of ledger.settlements ?? []) {
    const amount = BigInt(settlement.amountCents);
    const balanceChange = settlement.direction === "theyPaidYou" ? -amount : amount;
    byEntityBig.set(
      settlement.entityId,
      (byEntityBig.get(settlement.entityId) ?? 0n) + balanceChange,
    );
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

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function accountCoverage(ledger: Ledger, accountId: string): AccountCoverage {
  const ranges = (ledger.imports ?? [])
    .filter((item) => item.accountId === accountId && item.dateFrom !== null && item.dateTo !== null)
    .map((item) => ({ from: item.dateFrom!, to: item.dateTo! }))
    .sort((first, second) => first.from.localeCompare(second.from) || first.to.localeCompare(second.to));
  const merged: CoverageRange[] = [];

  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > addDays(previous.to, 1)) {
      merged.push({ ...range });
    } else if (range.to > previous.to) {
      previous.to = range.to;
    }
  }

  const gaps = merged.slice(1).map((range, index) => ({
    from: addDays(merged[index].to, 1),
    to: addDays(range.from, -1),
  }));
  return { ranges: merged, gaps };
}

export function checkpointDifferences(ledger: Ledger, accountId: string): CheckpointDifference[] {
  const checkpoints = (ledger.checkpoints ?? [])
    .filter((checkpoint) => checkpoint.accountId === accountId)
    .sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
  const differences: CheckpointDifference[] = [];

  for (let index = 1; index < checkpoints.length; index += 1) {
    const earlier = checkpoints[index - 1];
    const later = checkpoints[index];
    const bankRowsCents = sumCents((ledger.bankRows ?? [])
      .filter((row) => row.accountId === accountId && row.date > earlier.date && row.date <= later.date)
      .map((row) => row.amountCents));
    differences.push({
      earlier,
      later,
      bankRowsCents,
      differenceCents: later.balanceCents - earlier.balanceCents - bankRowsCents,
    });
  }
  return differences;
}

export function openItems(ledger: Ledger, entityId: string): EntityOpenItems {
  const theyOweYou: OpenItem[] = [];
  const youOweThem: OpenItem[] = [];

  for (const baseline of ledger.baselines) {
    if (baseline.entityId !== entityId || baseline.amountCents === 0) continue;
    const item: OpenItem = {
      id: baseline.id,
      date: "",
      description: "Opening balance",
      source: "baseline",
      amountCents: Math.abs(baseline.amountCents),
      openAmountCents: Math.abs(baseline.amountCents),
    };
    (baseline.amountCents > 0 ? theyOweYou : youOweThem).push(item);
  }

  for (const entry of ledger.entries) {
    for (const debt of debtsOf(entry, ledger.bankRows ?? [])) {
      if (debt.amountCents === 0) continue;
      const item = {
        id: entry.id,
        date: entry.date,
        description: entry.description,
        source: "entry" as const,
        amountCents: Math.abs(debt.amountCents),
        openAmountCents: Math.abs(debt.amountCents),
      };
      const debtorId = debt.amountCents > 0 ? debt.debtorId : debt.creditorId;
      const creditorId = debt.amountCents > 0 ? debt.creditorId : debt.debtorId;
      if (debtorId === entityId && creditorId === SELF_ENTITY_ID) {
        theyOweYou.push(item);
      } else if (debtorId === SELF_ENTITY_ID && creditorId === entityId) {
        youOweThem.push(item);
      }
    }
  }

  const oldestFirst = (first: OpenItem, second: OpenItem) =>
    first.date.localeCompare(second.date) || first.id.localeCompare(second.id);
  theyOweYou.sort(oldestFirst);
  youOweThem.sort(oldestFirst);

  const settlements = [...(ledger.settlements ?? [])]
    .sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
  for (const settlement of settlements) {
    const items = settlement.direction === "theyPaidYou" ? theyOweYou : youOweThem;
    if (settlement.entityId !== entityId) continue;
    let remaining = settlement.amountCents;
    for (const item of items) {
      const applied = Math.min(item.openAmountCents, remaining);
      item.openAmountCents -= applied;
      remaining -= applied;
      if (remaining === 0) break;
    }
  }

  return {
    theyOweYou: theyOweYou.filter((item) => item.openAmountCents > 0),
    youOweThem: youOweThem.filter((item) => item.openAmountCents > 0),
  };
}

export function openEntryIds(ledger: Ledger): Set<string> {
  const ids = new Set<string>();
  for (const entity of ledger.entities) {
    if (entity.kind === "self") continue;
    const items = openItems(ledger, entity.id);
    for (const item of [...items.theyOweYou, ...items.youOweThem]) {
      if (item.source === "entry" && item.openAmountCents > 0) ids.add(item.id);
    }
  }
  return ids;
}