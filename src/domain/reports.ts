import { HOUSE_ENTITY_ID, SELF_ENTITY_ID, type Entry, type Ledger } from "./ledger";
import { sumCents } from "./value";

export type ReportScope = "personal" | "household";

export interface MonthlyReportRow {
  month: string;
  spendingCents: number;
  refundsCents: number;
  netCents: number;
  spendingEntryIds: string[];
  refundEntryIds: string[];
  entryIds: string[];
}

export interface CategoryReportRow {
  categoryId: string | null;
  categoryName: string;
  byMonth: Record<string, number>;
  monthEntryIds: Record<string, string[]>;
  totalCents: number;
  entryIds: string[];
}

export interface CategoryReport {
  months: string[];
  rows: CategoryReportRow[];
  columnTotals: Record<string, number>;
  totalCents: number;
}

export interface MerchantReportRow {
  merchant: string;
  totalCents: number;
  entryIds: string[];
}

export interface CashFlowDirection {
  inCents: number;
  outCents: number;
  inEntryIds: string[];
  outEntryIds: string[];
}

export interface CashFlowReport {
  income: CashFlowDirection;
  transfers: CashFlowDirection;
  settlements: CashFlowDirection;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthKeys(from: string, to: string): string[] {
  const firstMonth = monthKey(from);
  const lastMonth = monthKey(to);
  if (firstMonth > lastMonth) return [];

  const [firstYear, firstNumber] = firstMonth.split("-").map(Number);
  const [lastYear, lastNumber] = lastMonth.split("-").map(Number);
  const count = (lastYear - firstYear) * 12 + lastNumber - firstNumber + 1;
  return Array.from({ length: count }, (_, index) => {
    const monthIndex = firstNumber - 1 + index;
    const year = firstYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

function scopeAmount(entry: Entry, scope: ReportScope): number {
  if (entry.kind !== "spend" && entry.kind !== "refund") return 0;
  const sign = entry.kind === "refund" ? -1 : 1;
  const amounts: number[] = [];

  for (const portion of entry.portions) {
    if (portion.entityId === SELF_ENTITY_ID) amounts.push(sign * portion.amountCents);
    if (portion.entityId === HOUSE_ENTITY_ID) {
      const includedCents = scope === "household"
        ? portion.amountCents
        : Math.ceil(portion.amountCents / 2);
      amounts.push(sign * includedCents);
    }
  }

  return sumCents(amounts);
}

function entriesInRange(ledger: Ledger, from: string, to: string): Entry[] {
  return ledger.entries.filter((entry) => entry.date >= from && entry.date <= to);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthly(ledger: Ledger, scope: ReportScope, months: number): MonthlyReportRow[] {
  if (!Number.isSafeInteger(months) || months <= 0) return [];
  const [year, month] = currentMonth().split("-").map(Number);
  const rows = new Map<string, MonthlyReportRow>();

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const monthIndex = month - 1 - offset;
    const rowYear = year + Math.floor(monthIndex / 12);
    const rowMonth = ((monthIndex % 12) + 12) % 12 + 1;
    const key = `${rowYear}-${String(rowMonth).padStart(2, "0")}`;
    rows.set(key, {
      month: key,
      spendingCents: 0,
      refundsCents: 0,
      netCents: 0,
      spendingEntryIds: [],
      refundEntryIds: [],
      entryIds: [],
    });
  }

  for (const entry of ledger.entries) {
    const row = rows.get(monthKey(entry.date));
    if (!row) continue;
    const amount = scopeAmount(entry, scope);
    if (amount === 0) continue;
    row.entryIds.push(entry.id);
    if (entry.kind === "spend") {
      row.spendingCents += amount;
      row.spendingEntryIds.push(entry.id);
    } else if (entry.kind === "refund") {
      row.refundsCents += amount;
      row.refundEntryIds.push(entry.id);
    }
    row.netCents += amount;
  }

  return [...rows.values()];
}

export function byCategory(ledger: Ledger, scope: ReportScope, from: string, to: string): CategoryReport {
  const months = monthKeys(from, to);
  const categories = new Map((ledger.categories ?? []).map((category) => [category.id, category.name]));
  const rows = new Map<string, CategoryReportRow>();
  const columnAmounts = new Map(months.map((month) => [month, [] as number[]]));

  for (const entry of entriesInRange(ledger, from, to)) {
    if (entry.kind !== "spend" && entry.kind !== "refund") continue;
    const amount = scopeAmount(entry, scope);
    if (!amount) continue;
    const month = monthKey(entry.date);
    if (!columnAmounts.has(month)) continue;
    const categoryId = entry.categoryId ?? null;
    const rowKey = categoryId ?? "__uncategorized__";
    let row = rows.get(rowKey);
    if (!row) {
      row = {
        categoryId,
        categoryName: categoryId ? categories.get(categoryId) ?? "Uncategorized" : "Uncategorized",
        byMonth: Object.fromEntries(months.map((key) => [key, 0])),
        monthEntryIds: Object.fromEntries(months.map((key) => [key, [] as string[]])),
        totalCents: 0,
        entryIds: [],
      };
      rows.set(rowKey, row);
    }
    row.byMonth[month] += amount;
    row.monthEntryIds[month].push(entry.id);
    row.totalCents += amount;
    row.entryIds.push(entry.id);
    columnAmounts.get(month)?.push(amount);
  }

  const columnTotals = Object.fromEntries(months.map((month) => [month, sumCents(columnAmounts.get(month) ?? [])]));
  return {
    months,
    rows: [...rows.values()].sort((first, second) => first.categoryName.localeCompare(second.categoryName)),
    columnTotals,
    totalCents: sumCents(Object.values(columnTotals)),
  };
}

function merchantName(entry: Entry): string {
  return entry.displayName?.trim() || entry.description.toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
}

export function topMerchants(
  ledger: Ledger,
  scope: ReportScope,
  from: string,
  to: string,
  limit: number,
): MerchantReportRow[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const groups = new Map<string, MerchantReportRow>();

  for (const entry of entriesInRange(ledger, from, to)) {
    const amount = scopeAmount(entry, scope);
    if (!amount) continue;
    const merchant = merchantName(entry) || "Unspecified";
    const row = groups.get(merchant) ?? { merchant, totalCents: 0, entryIds: [] };
    row.totalCents += amount;
    row.entryIds.push(entry.id);
    groups.set(merchant, row);
  }

  return [...groups.values()]
    .sort((first, second) => second.totalCents - first.totalCents || first.merchant.localeCompare(second.merchant))
    .slice(0, limit);
}

function addCashFlow(direction: CashFlowDirection, amountCents: number, entryId?: string): void {
  if (amountCents > 0) {
    direction.inCents += amountCents;
    if (entryId) direction.inEntryIds.push(entryId);
  } else if (amountCents < 0) {
    direction.outCents += Math.abs(amountCents);
    if (entryId) direction.outEntryIds.push(entryId);
  }
}

export function cashFlow(ledger: Ledger, from: string, to: string): CashFlowReport {
  const createDirection = (): CashFlowDirection => ({ inCents: 0, outCents: 0, inEntryIds: [], outEntryIds: [] });
  const result: CashFlowReport = {
    income: createDirection(),
    transfers: createDirection(),
    settlements: createDirection(),
  };
  const bankRows = ledger.bankRows ?? [];

  for (const entry of entriesInRange(ledger, from, to)) {
    if (entry.kind !== "income" && entry.kind !== "transfer") continue;
    const direction = entry.kind === "income" ? result.income : result.transfers;
    const linkedRows = bankRows.filter((row) => entry.bankRowIds?.includes(row.id));
    if (linkedRows.length) {
      for (const row of linkedRows) addCashFlow(direction, row.amountCents, entry.id);
    } else {
      addCashFlow(direction, entry.kind === "income" ? entry.amountCents : -entry.amountCents, entry.id);
    }
  }

  for (const settlement of ledger.settlements ?? []) {
    if (settlement.date < from || settlement.date > to) continue;
    addCashFlow(result.settlements, settlement.direction === "theyPaidYou" ? settlement.amountCents : -settlement.amountCents);
  }

  return result;
}