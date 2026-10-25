import type { Account, BankRow, SplitPreset } from "./ledger";

export interface EntryRule {
  id: string;
  name: string;
  order: number;
  enabled: boolean;
  match: {
    text: string;
    mode: "contains" | "startsWith";
    accountId: string | null;
    sign: "out" | "in" | "any";
    minCents: number | null;
    maxCents: number | null;
  };
  action: {
    displayName: string | null;
    categoryId: string | null;
    split: SplitPreset | null;
    tags: string[];
  };
  autoConfirm: boolean;
  updatedAt: string;
}

export function matchesRule(rule: EntryRule, row: BankRow, account: Account | undefined): boolean {
  const { match } = rule;
  const rowText = row.description.toLocaleLowerCase();
  const matchText = match.text.trim().toLocaleLowerCase();
  const textMatches = !matchText || (match.mode === "contains"
    ? rowText.includes(matchText)
    : rowText.startsWith(matchText));
  const amountCents = Math.abs(row.amountCents);

  return rule.enabled &&
    textMatches &&
    (match.accountId === null || match.accountId === row.accountId) &&
    (match.sign === "any" || (match.sign === "out" && row.amountCents < 0) || (match.sign === "in" && row.amountCents > 0)) &&
    (match.minCents === null || amountCents >= match.minCents) &&
    (match.maxCents === null || amountCents <= match.maxCents) &&
    (!match.accountId || Boolean(account && account.id === match.accountId));
}

export function firstRule(rules: readonly EntryRule[], row: BankRow, account: Account | undefined): EntryRule | undefined {
  return [...rules]
    .sort((first, second) => first.order - second.order || first.id.localeCompare(second.id))
    .find((rule) => matchesRule(rule, row, account));
}

export function canAutoConfirm(rule: EntryRule): boolean {
  return rule.autoConfirm && rule.action.split !== null;
}