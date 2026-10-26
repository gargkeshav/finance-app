import { splitPreset, type Account, type BankRow, type Entry, type Ledger, type Portion, type SplitPreset } from "./ledger";
import { cleanMerchantKey } from "./merchants";

export interface EntryRule {
  id: string;
  name: string;
  order: number;
  enabled: boolean;
  match: {
    text: string;
    mode: "contains" | "startsWith";
    descriptionRegex?: string;
    weekday?: number[];
    accountId: string | null;
    sign: "out" | "in" | "any";
    minCents: number | null;
    maxCents: number | null;
  };
  scope?: "newRows" | "existingEntries" | "both";
  protectManualEdits?: boolean;
  action: {
    displayName: string | null;
    categoryId: string | null;
    split: SplitPreset | null;
    tags: string[];
  };
  autoConfirm: boolean;
  updatedAt: string;
}

export interface RuleChangeSummary {
  categoryId: string | null;
  displayName: string | null;
  tags: string[];
  split: Portion[];
}

export interface RulePreview {
  bankRows: { row: BankRow; after: RuleChangeSummary }[];
  entries: { entry: Entry; before: RuleChangeSummary; after: RuleChangeSummary }[];
}

export interface RuleSuggestion {
  key: string;
  sampleText: string;
  categoryId: string;
  split: SplitPreset;
  count: number;
}

interface RuleMatchInput {
  description: string;
  amountCents: number;
  date: string;
  accountId: string | null;
}

export function matchesCore(match: EntryRule["match"], input: RuleMatchInput): boolean {
  let textMatches: boolean;
  if (match.descriptionRegex) {
    try {
      textMatches = new RegExp(match.descriptionRegex, "i").test(input.description);
    } catch {
      return false;
    }
  } else {
    const description = input.description.toLocaleLowerCase();
    const text = match.text.trim().toLocaleLowerCase();
    textMatches = !text || (match.mode === "contains" ? description.includes(text) : description.startsWith(text));
  }

  const amountCents = Math.abs(input.amountCents);
  const weekdayMatches = !match.weekday?.length || match.weekday.includes(new Date(`${input.date}T00:00:00Z`).getUTCDay());
  return textMatches &&
    weekdayMatches &&
    (match.accountId === null || match.accountId === input.accountId) &&
    (match.sign === "any" || (match.sign === "out" && input.amountCents < 0) || (match.sign === "in" && input.amountCents > 0)) &&
    (match.minCents === null || amountCents >= match.minCents) &&
    (match.maxCents === null || amountCents <= match.maxCents);
}

function splitShape(entry: Entry): { key: string; split: SplitPreset } | null {
  if (entry.portions.length === 1 && entry.portions[0].amountCents === entry.amountCents) {
    const entityId = entry.portions[0].entityId;
    return entityId === entry.payerEntityId
      ? { key: "payer", split: { kind: "payer" } }
      : { key: `entity:${entityId}`, split: { kind: "entity", entityId } };
  }

  if (entry.portions.length < 2) return null;
  const amounts = entry.portions.map((portion) => portion.amountCents);
  if (Math.max(...amounts) - Math.min(...amounts) > 1) return null;
  const entityIds = entry.portions.map((portion) => portion.entityId).sort((first, second) => first.localeCompare(second));
  return {
    key: `equal:${entityIds.join("\u0000")}`,
    split: { kind: "equal", entityIds },
  };
}

export function suggestRuleFromHistory(
  entries: readonly Entry[],
  rules: readonly EntryRule[],
  minOccurrences = 3,
): RuleSuggestion | null {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.kind !== "spend" || !entry.categoryId) continue;
    const key = cleanMerchantKey(entry.description);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const suggestions: RuleSuggestion[] = [];
  for (const [key, group] of groups) {
    if (group.length < minOccurrences) continue;
    const newestFirst = [...group].sort((first, second) =>
      second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt) || second.id.localeCompare(first.id),
    );
    const newest = newestFirst[0];
    const categoryId = newest.categoryId!;
    const shape = splitShape(newest);
    if (!shape || group.some((entry) => entry.categoryId !== categoryId || splitShape(entry)?.key !== shape.key)) continue;
    if (rules.some((rule) => rule.enabled && matchesCore(rule.match, {
      description: newest.description,
      amountCents: -newest.amountCents,
      date: newest.date,
      accountId: newest.accountId,
    }))) continue;
    suggestions.push({ key, sampleText: newest.description, categoryId, split: shape.split, count: group.length });
  }

  return suggestions.sort((first, second) => second.count - first.count || first.key.localeCompare(second.key))[0] ?? null;
}

export function matchesRule(rule: EntryRule, row: BankRow, account: Account | undefined): boolean {
  return rule.enabled &&
    matchesCore(rule.match, row) &&
    (!rule.match.accountId || Boolean(account && account.id === rule.match.accountId));
}

export function matchesEntryForRule(rule: EntryRule, entry: Entry, account: Account | undefined): boolean {
  if (!rule.enabled || ((rule.protectManualEdits ?? true) && (entry.source === undefined || entry.source === "manual"))) {
    return false;
  }
  const amountCents = entry.kind === "spend" ? -entry.amountCents : entry.amountCents;
  return matchesCore(rule.match, {
    description: entry.description,
    amountCents,
    date: entry.date,
    accountId: entry.accountId,
  }) && (!rule.match.accountId || Boolean(account && account.id === rule.match.accountId));
}

function summary(entry: Entry): RuleChangeSummary {
  return {
    categoryId: entry.categoryId ?? null,
    displayName: entry.displayName ?? null,
    tags: [...(entry.tags ?? [])],
    split: entry.portions.map((portion) => ({ ...portion })),
  };
}

function actionSummary(rule: EntryRule, amountCents: number, payerEntityId: string, fallbackSplit: Portion[]): RuleChangeSummary {
  return {
    categoryId: rule.action.categoryId,
    displayName: rule.action.displayName,
    tags: [...rule.action.tags],
    split: rule.action.split ? splitPreset(amountCents, payerEntityId, rule.action.split) : fallbackSplit,
  };
}

export function previewRuleChanges(rule: EntryRule, ledger: Ledger): RulePreview {
  const scope = rule.scope ?? "newRows";
  const bankRows = scope === "existingEntries" ? [] : (ledger.bankRows ?? [])
    .filter((row) => !row.entryId && !row.settlementId && !row.skipped)
    .filter((row) => matchesRule(rule, row, ledger.accounts.find((account) => account.id === row.accountId)))
    .map((row) => {
      const payerEntityId = ledger.accounts.find((account) => account.id === row.accountId)?.payerEntityId ?? "self";
      return {
        row,
        after: actionSummary(rule, Math.abs(row.amountCents), payerEntityId,
          splitPreset(Math.abs(row.amountCents), payerEntityId, { kind: "payer" })),
      };
    });
  const entries = scope === "newRows" ? [] : ledger.entries
    .filter((entry) => matchesEntryForRule(rule, entry, ledger.accounts.find((account) => account.id === entry.accountId)))
    .map((entry) => ({
      entry,
      before: summary(entry),
      after: actionSummary(rule, entry.amountCents, entry.payerEntityId, entry.portions),
    }));
  return { bankRows, entries };
}

export function firstRule(rules: readonly EntryRule[], row: BankRow, account: Account | undefined): EntryRule | undefined {
  return [...rules]
    .sort((first, second) => first.order - second.order || first.id.localeCompare(second.id))
    .find((rule) => matchesRule(rule, row, account));
}

export function canAutoConfirm(rule: EntryRule): boolean {
  return rule.autoConfirm && rule.action.split !== null;
}