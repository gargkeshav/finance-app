import { centsSchema, sumCents } from "./value";
import type { CsvMapping } from "../adapters/csv-mapping";
import type { EntryRule } from "./rules";
import type { HistoryMapping } from "./history-import";
import { cleanMerchantKey } from "./merchants";

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

export interface MerchantName {
  id: string;
  key: string;
  displayName: string;
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
  /** Set when `entityId` paid this entity instead of you, e.g. House paying out Trisha. */
  paidToEntityId?: string;
  /** Entries this payment settles. Their debt between the two parties closes first. */
  entryIds?: string[];
  /** Statement lines the payment was worked out from, such as a row of a settle-up sheet. */
  lines?: SettlementLine[];
  /** What happens to the payment minus the linked items: kept as credit or shortfall, or written off. Defaults to carry. */
  remainder?: "carry" | "writeOff";
}

export interface SettlementLine {
  label: string;
  amountCents: number;
  entryIds: string[];
  note?: string;
}

export function isBetweenOthers(settlement: Settlement): boolean {
  return Boolean(settlement.paidToEntityId);
}

export function linkedEntryIds(settlement: Settlement): string[] {
  return [...new Set([...(settlement.entryIds ?? []), ...(settlement.lines ?? []).flatMap((line) => line.entryIds)])];
}

/** The two parties as debtor and creditor: whoever paid owed the other. */
function settlementParties(settlement: Settlement, selfId: string): { debtorId: string; creditorId: string } {
  if (settlement.paidToEntityId) return { debtorId: settlement.entityId, creditorId: settlement.paidToEntityId };
  return settlement.direction === "theyPaidYou"
    ? { debtorId: settlement.entityId, creditorId: selfId }
    : { debtorId: selfId, creditorId: settlement.entityId };
}

/** Signed debt an entry carries from the settlement's payer to its payee. Uncounted entries carry none. */
function linkedDebtCents(entry: Entry, settlement: Settlement, bankRows: readonly BankRow[], selfId: string): number {
  const { debtorId, creditorId } = settlementParties(settlement, selfId);
  return sumCents(debtsOf(entry, bankRows).map((debt) => {
    if (debt.debtorId === debtorId && debt.creditorId === creditorId) return debt.amountCents;
    if (debt.debtorId === creditorId && debt.creditorId === debtorId) return -debt.amountCents;
    return 0;
  }));
}

/** Amount of an entry that belongs to the settlement's payer, counted or not. Used to show what a payment covered. */
function linkedShareCents(entry: Entry, settlement: Settlement, selfId: string): number {
  const { debtorId, creditorId } = settlementParties(settlement, selfId);
  if (entry.payerEntityId !== creditorId && entry.payerEntityId !== debtorId) return 0;
  const sign = entry.kind === "refund" ? -1 : 1;
  const owing = entry.payerEntityId === creditorId ? debtorId : creditorId;
  const direction = entry.payerEntityId === creditorId ? 1 : -1;
  return sign * direction * sumCents(entry.portions
    .filter((portion) => portion.entityId === owing && (portion.treatment ?? "claim") === "claim")
    .map((portion) => portion.amountCents));
}

export interface SettlementCoverageItem {
  entry: Entry;
  shareCents: number;
}

export interface SettlementCoverage {
  items: SettlementCoverageItem[];
  linkedCents: number;
  differenceCents: number;
  lines: { line: SettlementLine; items: SettlementCoverageItem[]; itemsCents: number }[];
}

/** What a payment covered: linked items, their total, and how far the payment is over (+) or under (-) it. */
export function settlementCoverage(ledger: Ledger, settlement: Settlement): SettlementCoverage {
  const selfId = ledger.entities.find((entity) => entity.kind === "self")?.id ?? SELF_ENTITY_ID;
  const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const itemFor = (id: string): SettlementCoverageItem[] => {
    const entry = entriesById.get(id);
    return entry ? [{ entry, shareCents: linkedShareCents(entry, settlement, selfId) }] : [];
  };
  const items = linkedEntryIds(settlement).flatMap(itemFor);
  const linkedCents = sumCents(items.map((item) => item.shareCents));
  const lines = (settlement.lines ?? []).map((line) => {
    const lineItems = line.entryIds.flatMap(itemFor);
    return { line, items: lineItems, itemsCents: sumCents(lineItems.map((item) => item.shareCents)) };
  });
  const statedCents = lines.length ? sumCents(lines.map(({ line }) => line.amountCents)) : linkedCents;
  return { items, linkedCents, differenceCents: settlement.amountCents - statedCents, lines };
}

/** Settlements that list this entry as one of the items they paid. */
export function settlementsForEntry(ledger: Ledger, entryId: string): Settlement[] {
  return (ledger.settlements ?? []).filter((settlement) => linkedEntryIds(settlement).includes(entryId));
}

/** How much a settlement moves the balance: the full amount, or only its linked debt when the rest is written off. */
export function settlementEffectCents(ledger: Ledger, settlement: Settlement, selfId: string = SELF_ENTITY_ID): number {
  if (settlement.remainder !== "writeOff") return settlement.amountCents;
  const ids = new Set(linkedEntryIds(settlement));
  return sumCents(ledger.entries.filter((entry) => ids.has(entry.id))
    .map((entry) => linkedDebtCents(entry, settlement, ledger.bankRows ?? [], selfId)));
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
  merchantNames?: MerchantName[];
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
  source: "baseline" | "entry" | "credit";
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
  return `${accountId}:${cleanMerchantKey(description)}`;
}

export function merchantNameAfterSpend(ledger: Ledger, entry: Entry, updatedAt: string): MerchantName[] {
  const merchantNames = ledger.merchantNames ?? [];
  const displayName = entry.displayName?.trim();
  if (entry.kind !== "spend" || !displayName) return merchantNames;

  const key = cleanMerchantKey(entry.description);
  const existing = merchantNames.find((merchant) => merchant.key === key);
  const merchant: MerchantName = {
    id: existing?.id ?? crypto.randomUUID(),
    key,
    displayName,
    updatedAt,
  };
  return [...merchantNames.filter((candidate) => candidate.key !== key), merchant];
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
  const addPairDebt = (debtorId: string, creditorId: string, amount: bigint) => {
    const firstId = debtorId < creditorId ? debtorId : creditorId;
    const secondId = debtorId < creditorId ? creditorId : debtorId;
    const key = `${firstId}\u0000${secondId}`;
    const current = pairBig.get(key) ?? { firstId, secondId, amount: 0n };
    current.amount += amount * (debtorId === firstId ? 1n : -1n);
    pairBig.set(key, current);
  };

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
        addPairDebt(debt.debtorId, debt.creditorId, BigInt(debt.amountCents));
      }
    }
  }

  for (const settlement of ledger.settlements ?? []) {
    const effect = BigInt(settlementEffectCents(ledger, settlement, selfEntityId ?? SELF_ENTITY_ID));
    if (settlement.paidToEntityId) {
      addPairDebt(settlement.paidToEntityId, settlement.entityId, effect);
      continue;
    }
    const amount = effect;
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
  const sortItems = () => {
    theyOweYou.sort(oldestFirst);
    youOweThem.sort(oldestFirst);
  };
  sortItems();

  // Same-day payments apply in the order they were recorded.
  const settlements = [...(ledger.settlements ?? [])]
    .filter((settlement) => settlement.entityId === entityId && !settlement.paidToEntityId)
    .sort((first, second) => first.date.localeCompare(second.date));
  // A linked payment closes what is still open on its items, in date order, then spreads any
  // remainder oldest first. Written-off history closes its items outright before anything else.
  const closeLinked = (settlement: Settlement, ids: Set<string>): number => {
    const items = settlement.direction === "theyPaidYou" ? theyOweYou : youOweThem;
    const opposite = settlement.direction === "theyPaidYou" ? youOweThem : theyOweYou;
    let remaining = settlement.amountCents;
    for (const item of items) {
      if (item.source !== "entry" || !ids.has(item.id)) continue;
      remaining -= item.openAmountCents;
      item.openAmountCents = 0;
    }
    for (const item of opposite) {
      if (item.source !== "entry" || !ids.has(item.id)) continue;
      remaining += item.openAmountCents;
      item.openAmountCents = 0;
    }
    return remaining;
  };
  for (const settlement of settlements) {
    if (settlement.remainder === "writeOff") closeLinked(settlement, new Set(linkedEntryIds(settlement)));
  }

  for (const settlement of settlements) {
    if (settlement.remainder === "writeOff") continue;
    const items = settlement.direction === "theyPaidYou" ? theyOweYou : youOweThem;
    const ids = new Set(linkedEntryIds(settlement));
    let remaining = ids.size ? closeLinked(settlement, ids) : settlement.amountCents;
    if (remaining < 0) {
      items.push({
        id: settlement.id,
        date: settlement.date,
        description: `Short on ${settlement.date} payment`,
        source: "credit",
        amountCents: -remaining,
        openAmountCents: -remaining,
      });
      sortItems();
      continue;
    }
    if (remaining === 0) continue;
    for (const item of items) {
      const applied = Math.min(item.openAmountCents, remaining);
      item.openAmountCents -= applied;
      remaining -= applied;
      if (remaining === 0) break;
    }
    if (remaining > 0) {
      const credits = settlement.direction === "theyPaidYou" ? youOweThem : theyOweYou;
      credits.push({
        id: settlement.id,
        date: settlement.date,
        description: `Credit from ${settlement.date} payment`,
        source: "credit",
        amountCents: remaining,
        openAmountCents: remaining,
      });
      sortItems();
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