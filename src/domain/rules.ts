import { splitPreset, type Account, type BankRow, type Entry, type Ledger, type Portion, type SplitPreset } from "./ledger";

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