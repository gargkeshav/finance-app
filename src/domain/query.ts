import {
  HOUSE_ENTITY_ID,
  SELF_ENTITY_ID,
  type Entry,
  type EntryKind,
  type Ledger,
} from "./ledger";
import { sumCents } from "./value";

export type EntrySource = "bank" | "manual" | "splitwise";

export interface EntryFilter {
  entryIds?: string[];
  text?: string;
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  entityId?: string;
  payerEntityId?: string;
  kind?: EntryKind;
  tag?: string;
  counted?: boolean;
  source?: EntrySource;
}

export interface FilteredTotals {
  count: number;
  totalCents: number;
  personalCents: number;
  houseCents: number;
}

function entrySource(entry: Entry): EntrySource {
  const source = entry.source ?? (entry.ruleId
    ? "rule"
    : entry.splitwiseExpenseId
      ? "splitwise"
      : entry.bankRowIds?.length
        ? "bank"
        : "manual");
  if (source === "rule" || source === "memory" || source === "history") return "bank";
  return source;
}

export function filterEntries(ledger: Ledger, filter: EntryFilter): Entry[] {
  const text = filter.text?.trim().toLocaleLowerCase();
  const tag = filter.tag?.trim().toLocaleLowerCase();

  return ledger.entries
    .filter((entry) => {
      if (filter.entryIds && !filter.entryIds.includes(entry.id)) return false;
      if (filter.from && entry.date < filter.from) return false;
      if (filter.to && entry.date > filter.to) return false;
      if (filter.accountId) {
        const linkedAccount = entry.accountId === filter.accountId || (entry.bankRowIds ?? []).some((id) =>
          ledger.bankRows?.some((row) => row.id === id && row.accountId === filter.accountId),
        );
        if (!linkedAccount) return false;
      }
      if (filter.categoryId && entry.categoryId !== filter.categoryId) return false;
      if (filter.entityId && entry.payerEntityId !== filter.entityId &&
        !entry.portions.some((portion) => portion.entityId === filter.entityId)) return false;
      if (filter.payerEntityId && entry.payerEntityId !== filter.payerEntityId) return false;
      if (filter.kind && entry.kind !== filter.kind) return false;
      if (tag && !(entry.tags ?? []).some((entryTag) => entryTag.toLocaleLowerCase() === tag)) return false;
      if (filter.counted !== undefined && entry.countsTowardDebt !== filter.counted) return false;
      if (filter.source && entrySource(entry) !== filter.source) return false;
      if (text && ![entry.description, entry.note ?? "", ...(entry.tags ?? [])]
        .some((value) => value.toLocaleLowerCase().includes(text))) return false;
      return true;
    })
    .sort((first, second) => second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt));
}

export function filteredTotals(entries: readonly Entry[]): FilteredTotals {
  const spending = entries.filter((entry) => entry.kind === "spend" || entry.kind === "refund");
  const totalAmounts: number[] = [];
  const personalAmounts: number[] = [];
  const houseAmounts: number[] = [];

  for (const entry of spending) {
    const sign = entry.kind === "refund" ? -1 : 1;
    totalAmounts.push(sign * entry.amountCents);
    for (const portion of entry.portions) {
      const amount = sign * portion.amountCents;
      if (portion.entityId === SELF_ENTITY_ID) personalAmounts.push(amount);
      if (portion.entityId === HOUSE_ENTITY_ID) {
        houseAmounts.push(amount);
        personalAmounts.push(Math.sign(amount) * Math.ceil(Math.abs(amount) / 2));
      }
    }
  }

  return {
    count: entries.length,
    totalCents: sumCents(totalAmounts),
    personalCents: sumCents(personalAmounts),
    houseCents: sumCents(houseAmounts),
  };
}