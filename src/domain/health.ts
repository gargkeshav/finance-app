import {
  accountCoverage,
  checkpointDifferences,
  linkedBankAmountCents,
  openItems,
  type Ledger,
} from "./ledger";
import { formatMoney } from "./value";
import { cardPaymentCheck } from "./transfers";

export type HealthViewName = "Review" | "Accounts" | "Balances" | "Activity" | "People";

export interface HealthIssue {
  kind: string;
  count: number;
  detail: string;
  view: HealthViewName;
  filter?: { tag: string };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function entrySource(entry: Ledger["entries"][number]): string {
  if (entry.source) return entry.source;
  if (entry.splitwiseExpenseId) return "splitwise";
  if (entry.bankRowIds?.length) return "bank";
  return "manual";
}

export function findIssues(ledger: Ledger, today: string): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const waitingRows = (ledger.bankRows ?? []).filter(
    (row) => !row.entryId && !row.settlementId && !row.skipped,
  );
  if (waitingRows.length) {
    const oldestDate = waitingRows.map((row) => row.date).sort()[0];
    issues.push({
      kind: "Rows waiting in review",
      count: waitingRows.length,
      detail: `${waitingRows.length} row${waitingRows.length === 1 ? "" : "s"} waiting; oldest date ${oldestDate}.`,
      view: "Review",
    });
  }

  for (const account of ledger.accounts) {
    const differences = checkpointDifferences(ledger, account.id).filter((item) => item.differenceCents !== 0);
    for (const difference of differences) {
      issues.push({
        kind: "Checkpoint differences",
        count: 1,
        detail: `${account.name}: ${difference.earlier.date} to ${difference.later.date} differs by ${formatMoney(difference.differenceCents)}.`,
        view: "Accounts",
      });
    }

    const gaps = accountCoverage(ledger, account.id).gaps;
    if (gaps.length) {
      issues.push({
        kind: "Coverage gaps",
        count: gaps.length,
        detail: `${account.name}: ${gaps.map((gap) => `${gap.from} to ${gap.to}`).join(", ")}.`,
        view: "Accounts",
      });
    }
  }

  const oldCutoff = addDays(today, -60);
  for (const entity of ledger.entities) {
    const open = openItems(ledger, entity.id);
    const items = [...open.theyOweYou, ...open.youOweThem]
      .filter((item) => item.date && item.date < oldCutoff);
    if (items.length) {
      const oldestDate = items.map((item) => item.date).sort()[0];
      issues.push({
        kind: "Open items older than 60 days",
        count: items.length,
        detail: `${entity.name}: ${items.length} open item${items.length === 1 ? "" : "s"}; oldest date ${oldestDate}.`,
        view: "Balances",
      });
    }
  }

  const pendingPosts = (ledger.splitwisePosts ?? []).filter(
    (post) => post.state === "unknown" || post.state === "posting",
  );
  const pendingInbox = (ledger.splitwiseInbox ?? []).filter(
    (item) => item.status === "new" || item.status === "changed" || item.status === "deleted",
  );
  if (pendingPosts.length + pendingInbox.length) {
    issues.push({
      kind: "Splitwise items needing attention",
      count: pendingPosts.length + pendingInbox.length,
      detail: `${pendingPosts.length} post${pendingPosts.length === 1 ? "" : "s"} in progress or unknown and ${pendingInbox.length} inbox item${pendingInbox.length === 1 ? "" : "s"} awaiting review.`,
      view: "Review",
    });
  }

  const uncategorizedSpending = ledger.entries.filter((entry) =>
    (entry.kind === "spend" || entry.kind === "refund") && !entry.categoryId,
  );
  if (uncategorizedSpending.length) {
    issues.push({
      kind: "Uncategorised spending",
      count: uncategorizedSpending.length,
      detail: `${uncategorizedSpending.length} spend or refund entr${uncategorizedSpending.length === 1 ? "y has" : "ies have"} no category.`,
      view: "Activity",
    });
  }

  const needsShare = ledger.entries.filter((entry) => entry.tags?.includes("needs-share"));
  if (needsShare.length) {
    issues.push({
      kind: "History rows with no share",
      count: needsShare.length,
      detail: `${needsShare.length} history row${needsShare.length === 1 ? " has" : "s have"} no share recorded.`,
      view: "Activity",
      filter: { tag: "needs-share" },
    });
  }

  // A payment is only "unseen" when every statement-backed account it could have come from covers that date.
  const unseenCardPayments = ledger.accounts
    .filter((account) => account.type === "credit")
    .flatMap((card) => {
      const fundingAccounts = ledger.accounts.filter((asset) =>
        asset.type === "asset" && asset.payerEntityId === card.payerEntityId && accountCoverage(ledger, asset.id).ranges.length > 0);
      return cardPaymentCheck(ledger, card.id).rows
        .filter((row) => row.fundedFrom === null && fundingAccounts.length > 0 && fundingAccounts.every((asset) =>
          accountCoverage(ledger, asset.id).ranges.some((range) => row.payment.date >= range.from && row.payment.date <= range.to),
        ))
        .map((row) => ({ card, payment: row.payment }));
    });
  if (unseenCardPayments.length) {
    issues.push({
      kind: "Card payments not seen leaving an account",
      count: unseenCardPayments.length,
      detail: `${unseenCardPayments.length} card payment${unseenCardPayments.length === 1 ? " is" : "s are"} not linked to an outgoing row in covered account history.`,
      view: "Activity",
      filter: { tag: "card-payment" },
    });
  }

  const amended = ledger.entries.filter((entry) => {
    if (
      (entry.kind !== "spend" && entry.kind !== "refund") ||
      !entry.bankRowIds?.length ||
      entry.note?.trim()
    ) return false;
    const bankAmount = linkedBankAmountCents(entry, ledger.bankRows ?? []);
    return bankAmount !== null && bankAmount !== entry.amountCents;
  });
  if (amended.length) {
    issues.push({
      kind: "Amended amounts without a note",
      count: amended.length,
      detail: `${amended.length} bank-linked amount${amended.length === 1 ? "" : "s"} differ from the bank rows without an explanation.`,
      view: "Activity",
    });
  }

  const manualEntries = ledger.entries.filter((entry) => entrySource(entry) === "manual" && entry.accountId);
  const bankEntries = ledger.entries.filter((entry) => entrySource(entry) === "bank" && entry.accountId);
  for (const manual of manualEntries) {
    for (const bank of bankEntries) {
      if (
        manual.id !== bank.id && manual.accountId === bank.accountId &&
        manual.date === bank.date && manual.amountCents === bank.amountCents
      ) {
        const account = ledger.accounts.find((item) => item.id === manual.accountId);
        issues.push({
          kind: "Possible double entries",
          count: 1,
          detail: `${account?.name ?? "Account"}: ${manual.date}, ${formatMoney(manual.amountCents)}, ${manual.description} / ${bank.description}.`,
          view: "Activity",
        });
      }
    }
  }

  const unlinkedHistoryEntries = ledger.entries.filter((entry) =>
    entry.source === "history" && !entry.bankRowIds?.length && entry.accountId,
  );
  const linkedEntries = ledger.entries.filter((entry) => entry.bankRowIds?.length && entry.accountId);
  for (const history of unlinkedHistoryEntries) {
    for (const linked of linkedEntries) {
      if (
        history.id !== linked.id && history.accountId === linked.accountId &&
        history.date === linked.date && history.amountCents === linked.amountCents
      ) {
        const account = ledger.accounts.find((item) => item.id === history.accountId);
        issues.push({
          kind: "Possible double entries",
          count: 1,
          detail: `${account?.name ?? "Account"}: ${history.date}, ${formatMoney(history.amountCents)}, ${history.description} / ${linked.description}.`,
          view: "Activity",
        });
      }
    }
  }

  return issues;
}