import { Fragment, useEffect, useRef, useState } from "react";
import { categoryMemoryAfterSpend, categoryMemoryKey, HOUSE_ENTITY_ID, merchantNameAfterSpend, SELF_ENTITY_ID, splitPreset, type BankRow, type Category, type Entity, type Entry, type Ledger, type SplitPreset } from "../../domain/ledger";
import { cardCycle, confirmTransfer, existingEntryFor, isWaitingOnOtherAccount, suggestTransfers, waitingReason, type PossibleTransfer, type TransferChoice } from "../../domain/transfers";
import { formatMoney } from "../../domain/value";
import { canAutoConfirm, firstRule } from "../../domain/rules";
import { SpendForm } from "./SpendForm";
import { createSplitwiseSpend, type SplitwiseInboxItem } from "../../adapters/splitwise";
import { ComboField } from "./ComboField";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ReviewViewProps {
  ledger: Ledger;
  update: (next: Ledger, undoLabel?: string, actor?: "matcher") => void;
  onSettle: (row: BankRow) => void;
  onCreateRule: (description: string) => void;
}

export function ReviewView({ ledger, update, onSettle, onCreateRule }: ReviewViewProps) {
  const [queueTab, setQueueTab] = useState("needs");
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; confirmLabel: string; action?: () => void } | null>(null);
  const [openDetail, setOpenDetail] = useState<{ rowId: string; kind: "spend" | "refund" | "transfer" | "suggestion" } | null>(null);
  const [refundOfId, setRefundOfId] = useState("");
  const [focusNextId, setFocusNextId] = useState<string | null>(null);
  const [transferPartnerId, setTransferPartnerId] = useState("");
  const [confirmingTransfer, setConfirmingTransfer] = useState<{ outgoingId: string; incomingId: string } | null>(null);
  const [transferMessage, setTransferMessage] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [bulkPresetKind, setBulkPresetKind] = useState<SplitPreset["kind"]>("payer");
  const [bulkEntityId, setBulkEntityId] = useState(SELF_ENTITY_ID);
  const [bulkEntityIds, setBulkEntityIds] = useState<string[]>([SELF_ENTITY_ID]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [shownWaitingIds, setShownWaitingIds] = useState<Set<string>>(new Set());
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const shortcutRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bankRows = ledger.bankRows ?? [];
  const imports = ledger.imports ?? [];
  const allPendingRows = bankRows
    .filter((row) => !row.entryId && !row.settlementId && !row.skipped)
    .sort((first, second) => second.date.localeCompare(first.date) || second.line - first.line);
  const memoryFor = (row: BankRow) => ledger.categoryMemory?.find((memory) => memory.key === categoryMemoryKey(row.accountId, row.description));
  const ruleFor = (row: BankRow) => firstRule(ledger.rules ?? [], row, ledger.accounts.find((account) => account.id === row.accountId));
  const suggestions = suggestTransfers(ledger);
  const recordedRows = allPendingRows.flatMap((row) => {
    const entry = existingEntryFor(ledger, row);
    return entry ? [{ row, entry }] : [];
  });
  const recordedRowIds = new Set(recordedRows.map(({ row }) => row.id));
  const waitingRowIds = new Set(allPendingRows
    .filter((row) => !recordedRowIds.has(row.id) && !ruleFor(row) && !memoryFor(row) && isWaitingOnOtherAccount(ledger, row, suggestions))
    .map((row) => row.id));
  const waitingRows = allPendingRows.filter((row) => waitingRowIds.has(row.id));
  const pendingRows = allPendingRows.filter((row) => !recordedRowIds.has(row.id) &&
    (!waitingRowIds.has(row.id) || shownWaitingIds.has(row.id)));
  const selectedRows = pendingRows.filter((row) => selectedRowIds.has(row.id));
  const suggestedSpends = pendingRows.filter((row) => {
    const memory = memoryFor(row);
    return !ruleFor(row) && row.amountCents < 0 && Boolean(memory?.entityId && memory.categoryId && ledger.entities.some((entity) => entity.id === memory.entityId));
  });
  const autoRuleRows = pendingRows.flatMap((row) => {
    const rule = ruleFor(row);
    return row.amountCents < 0 && rule && canAutoConfirm(rule) ? [{ row, rule }] : [];
  });
  const spendingRow = openDetail?.kind === "spend" ? pendingRows.find((row) => row.id === openDetail.rowId) : undefined;
  const refundRow = openDetail?.kind === "refund" ? pendingRows.find((row) => row.id === openDetail.rowId) : undefined;
  const suggestionByRow = new Map<string, PossibleTransfer>();
  for (const suggestion of suggestions) {
    suggestionByRow.set(suggestion.outgoing.id, suggestion);
    suggestionByRow.set(suggestion.incoming.id, suggestion);
  }

  function askConfirmation(title: string, description: string, confirmLabel: string, action?: () => void) {
    setConfirmation({ title, description, confirmLabel, action });
  }

  function createCategory(name: string): string {
    const category: Category = { id: crypto.randomUUID(), name, archived: false, updatedAt: new Date().toISOString() };
    update({ ...ledger, categories: [...(ledger.categories ?? []), category] });
    return category.id;
  }

  function addEntity(entity: Entity) {
    update({ ...ledger, entities: [...ledger.entities, entity] });
  }

  function refundCandidates(row: BankRow) {
    const normalizedDescription = row.description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const rowWords = new Set(normalizedDescription.split(/\s+/).filter(Boolean));
    return ledger.entries
      .filter((entry) => entry.kind === "spend")
      .map((entry) => {
        const spendDescription = entry.description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const similarDescription = spendDescription.split(/\s+/).some((word) => rowWords.has(word));
        return { entry, priority: entry.accountId === row.accountId && similarDescription ? 0 : 1 };
      })
      .sort((first, second) => first.priority - second.priority || second.entry.date.localeCompare(first.entry.date))
      .map((item) => item.entry);
  }

  function scaledPortions(original: Entry, refundAmountCents: number) {
    const originalTotal = original.portions.reduce((total, portion) => total + BigInt(portion.amountCents), 0n);
    if (originalTotal === 0n) return [];
    const shares = original.portions.map((portion, index) => {
      const numerator = BigInt(refundAmountCents) * BigInt(portion.amountCents);
      return { entityId: portion.entityId, cents: numerator / originalTotal, remainder: numerator % originalTotal, index };
    });
    let remaining = BigInt(refundAmountCents) - shares.reduce((total, share) => total + share.cents, 0n);
    const byRemainder = [...shares].sort((first, second) =>
      first.remainder === second.remainder ? first.index - second.index : first.remainder > second.remainder ? -1 : 1,
    );
    for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) {
      byRemainder[index % byRemainder.length].cents += 1n;
    }
    return shares
      .filter((share) => share.cents > 0n)
      .map((share) => ({ entityId: share.entityId, amountCents: Number(share.cents) }));
  }

  useEffect(() => {
    if (!focusNextId) return;
    if (focusNextId === "__heading") headingRef.current?.focus();
    else actionRefs.current.get(focusNextId)?.focus();
    setFocusNextId(null);
  }, [focusNextId, pendingRows]);

  function focusFollowingRow(row: BankRow) {
    const index = pendingRows.findIndex((item) => item.id === row.id);
    setFocusNextId(pendingRows[index + 1]?.id ?? "__heading");
  }

  function importFor(row: BankRow) {
    return imports.find((item) => item.id === row.importId);
  }

  function linkRecordedRows(records: typeof recordedRows) {
    if (!records.length) return;
    const rowEntryIds = new Map(records.map(({ row, entry }) => [row.id, entry.id]));
    const rowIdsByEntry = new Map<string, string[]>();
    for (const { row, entry } of records) {
      rowIdsByEntry.set(entry.id, [...(rowIdsByEntry.get(entry.id) ?? []), row.id]);
    }
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.map((entry) => {
        const rowIds = rowIdsByEntry.get(entry.id);
        return rowIds ? { ...entry, bankRowIds: [...new Set([...(entry.bankRowIds ?? []), ...rowIds])] } : entry;
      }),
      bankRows: bankRows.map((row) => {
        const entryId = rowEntryIds.get(row.id);
        return entryId ? { ...row, entryId, updatedAt: now } : row;
      }),
    }, "Link bank rows to existing entries", "matcher");
  }

  function showWaitingRow(rowId: string) {
    setShownWaitingIds((current) => new Set([...current, rowId]));
  }

  function shortcutRef(rowId: string, key: string) {
    return (button: HTMLButtonElement | null) => {
      const refKey = `${rowId}:${key}`;
      if (button) shortcutRefs.current.set(refKey, button);
      else shortcutRefs.current.delete(refKey);
    };
  }

  function handleReviewKeyDown(event: KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const rowId = target instanceof HTMLElement
      ? target.closest("[data-review-row]")?.getAttribute("data-review-row") ?? activeRowId
      : activeRowId;
    const rowIndex = pendingRows.findIndex((row) => row.id === rowId);
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "j" || event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
      if (!pendingRows.length) return;
      event.preventDefault();
      const direction = event.key === "ArrowUp" || event.key.toLowerCase() === "k" ? -1 : 1;
      const nextIndex = rowIndex < 0
        ? (direction > 0 ? 0 : pendingRows.length - 1)
        : Math.min(pendingRows.length - 1, Math.max(0, rowIndex + direction));
      const nextRow = pendingRows[nextIndex];
      setActiveRowId(nextRow.id);
      (shortcutRefs.current.get(`${nextRow.id}:row`) ?? actionRefs.current.get(nextRow.id))?.focus();
      return;
    }
    if (!rowId) return;
    const key = event.key.toLowerCase();
    if (!["s", "i", "x", "t", "e", "r"].includes(key)) return;
    const button = shortcutRefs.current.get(`${rowId}:${key}`);
    if (button) {
      event.preventDefault();
      button.click();
    }
  }

  useEffect(() => {
    window.addEventListener("keydown", handleReviewKeyDown);
    return () => window.removeEventListener("keydown", handleReviewKeyDown);
  }, [pendingRows, activeRowId]);

  function changeSelection(rowId: string, checked: boolean) {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function selectedBulkPreset(): SplitPreset | null {
    if (bulkPresetKind === "payer") return { kind: "payer" };
    if (bulkPresetKind === "halfHouse") return { kind: "halfHouse" };
    if (bulkPresetKind === "allHouse") return { kind: "allHouse" };
    if (bulkPresetKind === "entity") return bulkEntityId ? { kind: "entity", entityId: bulkEntityId } : null;
    return bulkEntityIds.length ? { kind: "equal", entityIds: bulkEntityIds } : null;
  }

  function skipSelected() {
    if (!selectedRows.length) return;
    askConfirmation(
      "Skip selected bank rows?",
      `Skip ${selectedRows.length} selected bank rows?`,
      "Skip rows",
      performSkipSelected,
    );
  }

  function performSkipSelected() {
    if (!selectedRows.length) return;
    const selectedIds = new Set(selectedRows.map((row) => row.id));
    const now = new Date().toISOString();
    update({
      ...ledger,
      bankRows: bankRows.map((row) => selectedIds.has(row.id) ? { ...row, skipped: true, updatedAt: now } : row),
    }, `Skip ${selectedRows.length} selected`);
    setSelectedRowIds(new Set());
  }

  function spendSelected() {
    const preset = selectedBulkPreset();
    if (!preset || !selectedRows.length || selectedRows.some((row) => row.amountCents >= 0)) return;
    askConfirmation(
      "Create spends?",
      `Create spends for ${selectedRows.length} selected bank rows?`,
      "Create spends",
      () => performSpendSelected(preset),
    );
  }

  function performSpendSelected(preset: SplitPreset) {
    if (!selectedRows.length || selectedRows.some((row) => row.amountCents >= 0)) return;
    const now = new Date().toISOString();
    const entries = selectedRows.map((row): Entry => {
      const account = ledger.accounts.find((item) => item.id === row.accountId);
      const payerEntityId = account?.payerEntityId ?? SELF_ENTITY_ID;
      return {
        id: crypto.randomUUID(),
        kind: "spend",
        date: row.date,
        description: row.description,
        amountCents: Math.abs(row.amountCents),
        payerEntityId,
        accountId: row.accountId,
        portions: splitPreset(Math.abs(row.amountCents), payerEntityId, preset),
        bankRowIds: [row.id],
        categoryId: bulkCategoryId || null,
        tags: [],
        note: "",
        extraReimbursable: false,
        countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
        source: "bank",
        updatedAt: now,
      };
    });
    const entryByRowId = new Map(entries.map((entry) => [entry.bankRowIds![0], entry]));
    let next: Ledger = {
      ...ledger,
      entries: [...ledger.entries, ...entries],
      bankRows: bankRows.map((row) => {
        const entry = entryByRowId.get(row.id);
        return entry ? { ...row, entryId: entry.id, updatedAt: now } : row;
      }),
      lastSplitByAccount: {
        ...ledger.lastSplitByAccount,
        ...Object.fromEntries([...new Set(selectedRows.map((row) => row.accountId))]
          .filter((accountId) => Boolean(accountId))
          .map((accountId) => [accountId, preset])),
      },
    };
    for (const entry of entries) next = { ...next, categoryMemory: categoryMemoryAfterSpend(next, entry, now) };
    update(next, `Spend ${selectedRows.length} selected`);
    setSelectedRowIds(new Set());
  }

  function acceptSuggestedSpends() {
    if (!suggestedSpends.length) return;
    askConfirmation(
      "Accept suggested spends?",
      `Accept ${suggestedSpends.length} suggested spends?`,
      "Accept spends",
      performSuggestedSpends,
    );
  }

  function performSuggestedSpends() {
    if (!suggestedSpends.length) return;
    const now = new Date().toISOString();
    const entries = suggestedSpends.map((row): Entry => {
      const memory = memoryFor(row)!;
      const amountCents = Math.abs(row.amountCents);
      const account = ledger.accounts.find((item) => item.id === row.accountId);
      return {
        id: crypto.randomUUID(),
        kind: "spend",
        date: row.date,
        description: row.description,
        amountCents,
        payerEntityId: account?.payerEntityId ?? SELF_ENTITY_ID,
        accountId: row.accountId,
        portions: [{ entityId: memory.entityId!, amountCents }],
        bankRowIds: [row.id],
        categoryId: memory.categoryId,
        tags: [],
        note: "",
        extraReimbursable: false,
        countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
        source: "memory",
        updatedAt: now,
      };
    });
    const entryByRowId = new Map(entries.flatMap((entry) => (entry.bankRowIds ?? []).map((id) => [id, entry] as const)));
    update({
      ...ledger,
      entries: [...ledger.entries, ...entries],
      bankRows: bankRows.map((row) => {
        const entry = entryByRowId.get(row.id);
        return entry ? { ...row, entryId: entry.id, updatedAt: now } : row;
      }),
    }, "Accept suggested spends");
  }

  function applyAutoRules() {
    if (!autoRuleRows.length) return;
    askConfirmation(
      "Apply auto rules?",
      `Create ${autoRuleRows.length} spends from auto rules?`,
      "Apply rules",
      performAutoRules,
    );
  }

  function performAutoRules() {
    if (!autoRuleRows.length) return;
    const now = new Date().toISOString();
    const entries = autoRuleRows.map(({ row, rule }): Entry => {
      const amountCents = Math.abs(row.amountCents);
      const payerEntityId = ledger.accounts.find((account) => account.id === row.accountId)?.payerEntityId ?? SELF_ENTITY_ID;
      return {
        id: crypto.randomUUID(),
        kind: "spend",
        date: row.date,
        description: row.description,
        displayName: rule.action.displayName ?? undefined,
        amountCents,
        payerEntityId,
        accountId: row.accountId,
        portions: splitPreset(amountCents, payerEntityId, rule.action.split!),
        bankRowIds: [row.id],
        source: "rule",
        ruleId: rule.id,
        categoryId: rule.action.categoryId,
        tags: rule.action.tags,
        note: "",
        extraReimbursable: false,
        countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
        updatedAt: now,
      };
    });
    const entryByRowId = new Map(entries.map((entry) => [entry.bankRowIds![0], entry]));
    update({
      ...ledger,
      entries: [...ledger.entries, ...entries],
      bankRows: bankRows.map((row) => {
        const entry = entryByRowId.get(row.id);
        return entry ? { ...row, entryId: entry.id, updatedAt: now } : row;
      }),
    }, `Apply ${entries.length} auto rules`);
  }

  function saveSpend(row: BankRow, draft: Entry, preset?: SplitPreset) {
    const now = new Date().toISOString();
    const entry: Entry = {
      ...draft,
      id: crypto.randomUUID(),
      bankRowIds: [row.id],
      source: ruleFor(row) ? "rule" : memoryFor(row) ? "memory" : "bank",
      ruleId: ruleFor(row)?.id,
      displayName: draft.displayName,
      countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
      updatedAt: now,
    };
    update({
      ...ledger,
      entries: [...ledger.entries, entry],
      categoryMemory: categoryMemoryAfterSpend(ledger, entry, now),
      merchantNames: merchantNameAfterSpend(ledger, entry, now),
      lastSplitByAccount: row.accountId && preset
        ? { ...ledger.lastSplitByAccount, [row.accountId]: preset }
        : ledger.lastSplitByAccount,
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, entryId: entry.id, updatedAt: now }
        : item),
    }, "Save spend");
    setOpenDetail(null);
    focusFollowingRow(row);
  }

  function saveRefund(row: BankRow, draft: Entry) {
    const now = new Date().toISOString();
    const entry: Entry = {
      ...draft,
      id: crypto.randomUUID(),
      kind: "refund",
      refundOf: refundOfId,
      bankRowIds: [row.id],
      source: "bank",
      countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
      updatedAt: now,
    };
    update({
      ...ledger,
      entries: [...ledger.entries, entry],
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, entryId: entry.id, updatedAt: now }
        : item),
    }, "Save refund");
    setOpenDetail(null);
    setRefundOfId("");
    focusFollowingRow(row);
  }

  function classifyIncome(row: BankRow) {
    const account = ledger.accounts.find((item) => item.id === row.accountId);
    const now = new Date().toISOString();
    const entry: Entry = {
      id: crypto.randomUUID(),
      kind: "income",
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      payerEntityId: account?.payerEntityId ?? SELF_ENTITY_ID,
      accountId: row.accountId,
      portions: [],
      bankRowIds: [row.id],
      source: "bank",
      countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
      updatedAt: now,
    };
    update({
      ...ledger,
      entries: [...ledger.entries, entry],
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, entryId: entry.id, updatedAt: now }
        : item),
    }, "Classify income");
    focusFollowingRow(row);
  }

  function skipRow(row: BankRow) {
    const now = new Date().toISOString();
    update({
      ...ledger,
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, skipped: true, updatedAt: now }
        : item),
    }, "Skip bank row");
    setOpenDetail(null);
    focusFollowingRow(row);
  }

  function confirmPair(outgoing: BankRow, incoming: BankRow, choice?: TransferChoice) {
    const confirmed = confirmTransfer(ledger, outgoing, incoming, choice);
    if (!confirmed) {
      setTransferMessage("This payer combination is unsupported. Both rows remain in review.");
      setConfirmingTransfer(null);
      return;
    }
    const next = {
      ...confirmed,
      entries: confirmed.entries.map((entry) => ledger.entries.some((existing) => existing.id === entry.id)
        ? entry
        : { ...entry, source: "bank" as const }),
    };
    update(next, "Confirm transfer");
    setConfirmingTransfer(null);
    setOpenDetail(null);
    setTransferMessage("");
    focusFollowingRow(outgoing);
  }

  function requestConfirm(outgoing: BankRow, incoming: BankRow) {
    const outgoingPayer = ledger.accounts.find((item) => item.id === outgoing.accountId)?.payerEntityId;
    const incomingPayer = ledger.accounts.find((item) => item.id === incoming.accountId)?.payerEntityId;
    if (outgoingPayer === incomingPayer) {
      confirmPair(outgoing, incoming);
      return;
    }
    const selfAndHouse =
      (outgoingPayer === SELF_ENTITY_ID && incomingPayer === HOUSE_ENTITY_ID) ||
      (outgoingPayer === HOUSE_ENTITY_ID && incomingPayer === SELF_ENTITY_ID);
    if (!selfAndHouse) {
      setTransferMessage("This payer combination is unsupported. Both rows remain in review.");
      return;
    }
    setConfirmingTransfer({ outgoingId: outgoing.id, incomingId: incoming.id });
    setTransferMessage("");
  }

  function dismissPair(row: BankRow, other: BankRow) {
    const now = new Date().toISOString();
    update({
      ...ledger,
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, dismissedTransferIds: [...new Set([...item.dismissedTransferIds, other.id])], updatedAt: now }
        : item),
    }, "Dismiss transfer suggestion");
  }

  const splitwiseItems = (ledger.splitwiseInbox ?? []).filter((item) =>
    !item.isPayment && ["new", "changed", "deleted"].includes(item.status),
  );

  function matchingSplitwiseEntry(item: SplitwiseInboxItem) {
    const linked = ledger.entries.find((entry) => entry.splitwiseExpenseId === item.splitwiseExpenseId);
    if (linked?.kind === "spend") return linked;
    const payerEntityId = item.yourPaidCents === 0 ? item.entityId : SELF_ENTITY_ID;
    const target = Date.parse(`${item.date}T00:00:00Z`);
    return ledger.entries.find((entry) => {
      if (entry.kind !== "spend" || entry.payerEntityId !== payerEntityId || entry.amountCents !== item.costCents) return false;
      const differenceDays = Math.abs(Date.parse(`${entry.date}T00:00:00Z`) - target) / 86_400_000;
      return differenceDays <= 3;
    });
  }

  function splitwiseChangeText(item: SplitwiseInboxItem) {
    if (item.status === "deleted") return item.previous
      ? `Deleted in Splitwise. Was ${item.previous.date}, ${item.previous.description}, ${formatMoney(item.previous.costCents)}.`
      : "Deleted in Splitwise.";
    if (item.status !== "changed" || !item.previous) return item.status;
    const changes: string[] = [];
    if (item.previous.date !== item.date) changes.push(`date ${item.previous.date} to ${item.date}`);
    if (item.previous.description !== item.description) changes.push(`description ${JSON.stringify(item.previous.description)} to ${JSON.stringify(item.description)}`);
    if (item.previous.costCents !== item.costCents) changes.push(`cost ${formatMoney(item.previous.costCents)} to ${formatMoney(item.costCents)}`);
    if (item.previous.yourPaidCents !== item.yourPaidCents) changes.push(`your paid share ${formatMoney(item.previous.yourPaidCents)} to ${formatMoney(item.yourPaidCents)}`);
    if (item.previous.yourOwedCents !== item.yourOwedCents) changes.push(`your owed share ${formatMoney(item.previous.yourOwedCents)} to ${formatMoney(item.yourOwedCents)}`);
    return changes.length ? `Changed in Splitwise: ${changes.join("; ")}.` : "Changed in Splitwise.";
  }

  function completeSplitwise(item: SplitwiseInboxItem, entryId?: string, recordPost = false) {
    const now = new Date().toISOString();
    const entry = entryId ? ledger.entries.find((candidate) => candidate.id === entryId) : undefined;
    update({
      ...ledger,
      entries: entry
        ? ledger.entries.map((candidate) => candidate.id === entry.id
          ? { ...candidate, splitwiseExpenseId: item.splitwiseExpenseId, updatedAt: now }
          : candidate)
        : ledger.entries,
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "done" }
        : candidate),
      splitwisePosts: recordPost && entry
        ? [...(ledger.splitwisePosts ?? []), {
          id: crypto.randomUUID(),
          entryId: entry.id,
          entityId: item.entityId,
          state: "posted",
          splitwiseExpenseId: item.splitwiseExpenseId,
          updatedAt: now,
        }]
        : ledger.splitwisePosts,
    }, "Review Splitwise item");
  }

  function applySplitwiseChange(item: SplitwiseInboxItem, entry: Entry) {
    if (item.costCents <= 0 || item.yourOwedCents > item.costCents) return;
    const portions = [
      ...(item.yourOwedCents > 0 ? [{ entityId: SELF_ENTITY_ID, amountCents: item.yourOwedCents }] : []),
      ...(item.costCents - item.yourOwedCents > 0 ? [{ entityId: item.entityId, amountCents: item.costCents - item.yourOwedCents }] : []),
    ];
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.map((candidate) => candidate.id === entry.id
        ? { ...candidate, amountCents: item.costCents, date: item.date, portions, updatedAt: now }
        : candidate),
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "done" }
        : candidate),
    }, "Apply Splitwise change");
  }

  function keepDeletedSplitwiseOut(item: SplitwiseInboxItem, entry: Entry) {
    update({
      ...ledger,
      entries: ledger.entries.map((candidate) => candidate.id === entry.id
        ? { ...candidate, countsTowardDebt: false, tags: [...new Set([...(candidate.tags ?? []), "deleted-in-splitwise"])] }
        : candidate),
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "done" }
        : candidate),
    }, "Keep deleted Splitwise item out of balances");
  }

  function deleteDeletedSplitwiseEntry(item: SplitwiseInboxItem, entry: Entry) {
    if (ledger.entries.some((candidate) => candidate.kind === "refund" && candidate.refundOf === entry.id)) {
      askConfirmation("Entry cannot be deleted", "Delete its refunds first.", "Close");
      return;
    }
    askConfirmation(
      "Delete this entry?",
      `Delete “${entry.description || "this entry"}”? This cannot be undone.`,
      "Delete entry",
      () => performDeleteDeletedSplitwiseEntry(item, entry),
    );
  }

  function performDeleteDeletedSplitwiseEntry(item: SplitwiseInboxItem, entry: Entry) {
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.filter((candidate) => candidate.id !== entry.id),
      bankRows: (ledger.bankRows ?? []).map((row) => row.entryId === entry.id
        ? { ...row, entryId: null, updatedAt: now }
        : row),
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "done" }
        : candidate),
    }, "Delete Splitwise entry");
  }

  function dismissSplitwise(item: SplitwiseInboxItem) {
    update({
      ...ledger,
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "dismissed" }
        : candidate),
    }, "Dismiss Splitwise item");
  }

  function createFromSplitwise(item: SplitwiseInboxItem) {
    const next = createSplitwiseSpend(ledger, item);
    const entries = next.entries.map((entry) => ledger.entries.some((existing) => existing.id === entry.id)
      ? entry
      : { ...entry, source: "splitwise" as const });
    update({ ...next, entries }, "Create Splitwise spend");
  }

  function pendingPair(first: BankRow, second: BankRow) {
    return first.amountCents < 0 ? { outgoing: first, incoming: second } : { outgoing: second, incoming: first };
  }

  function choiceActions(outgoing: BankRow, incoming: BankRow) {
    if (confirmingTransfer?.outgoingId !== outgoing.id || confirmingTransfer.incomingId !== incoming.id) return null;
    return (
      <>
        <p>Choose how this transfer should be recorded.</p>
        <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => confirmPair(outgoing, incoming, "contribution")} type="button">Contribution (no one owes anything)</button>{" "}
        <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => confirmPair(outgoing, incoming, "settlement")} type="button">Settlement (pays back what House owes)</button>
      </>
    );
  }

  function displayDate(date: string) {
    const [, month, day] = date.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${day} ${months[month - 1]}`;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Review imported bank rows</p>
          <h1 ref={headingRef} tabIndex={-1}>Review</h1>
        </div>
        {autoRuleRows.length > 0
          ? <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={applyAutoRules} type="button">Apply {autoRuleRows.length} auto rules</button>
          : suggestedSpends.length > 0 && <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={acceptSuggestedSpends} type="button">Accept {suggestedSpends.length} suggested</button>}
      </header>
      {transferMessage && <p className="text-sm text-destructive" role="alert">{transferMessage}</p>}
      <div aria-label="Keyboard shortcuts" className="flex flex-wrap gap-2 text-sm text-foreground">
        <span><Kbd className="bg-background text-foreground">J</Kbd>/<Kbd className="bg-background text-foreground">K</Kbd> move</span>
        <span><Kbd className="bg-background text-foreground">S</Kbd> spend</span>
        <span><Kbd className="bg-background text-foreground">I</Kbd> income</span>
        <span><Kbd className="bg-background text-foreground">T</Kbd> transfer</span>
        <span><Kbd className="bg-background text-foreground">X</Kbd> skip</span>
        <span><Kbd className="bg-background text-foreground">E</Kbd> settlement</span>
        <span><Kbd className="bg-background text-foreground">R</Kbd> refund</span>
        <span><Kbd className="bg-background text-foreground">Enter</Kbd> open spend</span>
      </div>
      <Tabs onValueChange={setQueueTab} value={queueTab}>
        <TabsList aria-label="Review queues" className="flex h-auto flex-wrap bg-background text-foreground">
          <TabsTrigger value="needs">Needs you <Badge className="ml-2">{pendingRows.length}</Badge></TabsTrigger>
          <TabsTrigger value="waiting">Waiting <Badge className="ml-2">{waitingRows.length}</Badge></TabsTrigger>
          <TabsTrigger value="recorded">Already recorded <Badge className="ml-2">{recordedRows.length}</Badge></TabsTrigger>
        </TabsList>
        <TabsContent className="space-y-4" value="waiting">
          {waitingRows.map((row) => {
            const account = ledger.accounts.find((item) => item.id === row.accountId);
            return <article className="space-y-3 rounded-lg border bg-card p-4" key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">{row.date} · {account?.name ?? "Unknown"}</p>
                  <h2 className="font-medium">{row.description || "Bank transaction"}</h2>
                  <p className="text-sm text-muted-foreground">{waitingReason(ledger, row)}</p>
                </div>
                <strong className="text-lg tabular-nums">{formatMoney(row.amountCents)}</strong>
              </div>
              {shownWaitingIds.has(row.id)
                ? <Badge>Shown in Needs you</Badge>
                : <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => { showWaitingRow(row.id); setQueueTab("needs"); }} type="button">Show in Needs you</button>}
            </article>;
          })}
          {!waitingRows.length && <p className="rounded-lg border p-4 text-muted-foreground">No rows are waiting on another account.</p>}
        </TabsContent>
        <TabsContent className="space-y-3" value="recorded">
          {recordedRows.map((record) => {
            const { row, entry } = record;
            const account = ledger.accounts.find((item) => item.id === row.accountId);
            const cardPayment = entry.kind === "transfer" && entry.tags?.includes("card-payment");
            return <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4" key={row.id}>
              <div>
                <p className="text-sm text-muted-foreground">{row.date} · {account?.name ?? "Unknown"}</p>
                <h2 className="font-medium">{row.description || "Bank transaction"}</h2>
                <Badge>{cardPayment ? "Card payment from history" : "Already recorded"}</Badge>
              </div>
              <strong className="text-lg tabular-nums">{formatMoney(row.amountCents)}</strong>
              <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => linkRecordedRows([record])} type="button">Link row</button>
            </article>;
          })}
          {recordedRows.length > 1 && <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => linkRecordedRows(recordedRows)} type="button">Link all {recordedRows.length}</button>}
          {!recordedRows.length && <p className="rounded-lg border p-4 text-muted-foreground">No rows are already recorded.</p>}
        </TabsContent>
        <TabsContent className="space-y-4" value="needs">
      {waitingRows.length > 0 && <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => setQueueTab("waiting")} type="button">Waiting on another account {waitingRows.length}</button>}
      {autoRuleRows.length > 0 && suggestedSpends.length > 0 && <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={acceptSuggestedSpends} type="button">Accept {suggestedSpends.length} memory suggestions</button>}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">Bulk review actions</summary>
      <div className="mt-4 flex flex-wrap items-end gap-3" aria-label="Bulk review">
        <p className="w-full font-medium">{selectedRows.length} selected</p>
        <label className="grid gap-1">
          Spend preset
          <select value={bulkPresetKind} onChange={(event) => setBulkPresetKind(event.target.value as SplitPreset["kind"])}>
            <option value="payer">Payer</option>
            <option value="halfHouse">Half House</option>
            <option value="allHouse">All House</option>
            <option value="entity">Entity</option>
            <option value="equal">Equal split</option>
          </select>
        </label>
        {bulkPresetKind === "entity" && <label className="grid gap-1">
          Entity
          <select value={bulkEntityId} onChange={(event) => setBulkEntityId(event.target.value)}>
            {ledger.entities.filter((entity) => !entity.archived || entity.id === bulkEntityId).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>}
        {bulkPresetKind === "equal" && <label className="grid gap-1">
          Equal split entities
          <select multiple size={Math.min(4, Math.max(2, ledger.entities.filter((entity) => !entity.archived).length))} value={bulkEntityIds} onChange={(event) => setBulkEntityIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
            {ledger.entities.filter((entity) => !entity.archived || bulkEntityIds.includes(entity.id)).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>}
        <ComboField label="Category" value={bulkCategoryId} options={(ledger.categories ?? [])
          .filter((category) => !category.archived || category.id === bulkCategoryId)
          .map((category) => ({ id: category.id, name: category.name }))}
          nonePlaceholder="Uncategorized" onChange={setBulkCategoryId} onCreate={createCategory} />
        <label className="flex items-center gap-2"><input aria-label="Select all review rows" checked={pendingRows.length > 0 && selectedRows.length === pendingRows.length} onChange={(event) => setSelectedRowIds(event.target.checked ? new Set(pendingRows.map((row) => row.id)) : new Set())} type="checkbox" /> Select all</label>
        <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" disabled={!selectedRows.length} onClick={skipSelected} type="button">Bulk skip rows</button>
        <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" disabled={!selectedRows.length || selectedRows.some((row) => row.amountCents >= 0) || !selectedBulkPreset()} onClick={spendSelected} type="button">Bulk spend rows</button>
      </div>
      </details>
      {splitwiseItems.length > 0 && (
        <section aria-label="From Splitwise" className="space-y-3">
          <h2 className="text-xl font-semibold">From Splitwise</h2>
          {splitwiseItems.map((item) => {
            const entity = ledger.entities.find((candidate) => candidate.id === item.entityId);
            const fullySelfPaid = item.yourPaidCents === item.costCents;
            const manuallyEntered = item.yourPaidCents > 0 && !fullySelfPaid;
            const match = matchingSplitwiseEntry(item);
            return <article className="space-y-3 rounded-lg border bg-card p-4" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">{item.date} · {entity?.name ?? "Unknown"}</p>
                  <h3 className="font-medium">{item.description || "Splitwise expense"}</h3>
                </div>
                <strong className="text-lg tabular-nums">{formatMoney(item.costCents)}</strong>
              </div>
              <Badge variant="outline">{item.status}</Badge>
              {item.status === "changed" && item.previous && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p><strong>Previous:</strong> {item.previous.date} · {item.previous.description} · {formatMoney(item.previous.costCents)} · your owed share {formatMoney(item.previous.yourOwedCents)}</p>
                  <p><strong>Splitwise:</strong> {item.date} · {item.description} · {formatMoney(item.costCents)} · your owed share {formatMoney(item.yourOwedCents)}</p>
                </div>
              )}
              {item.status === "deleted" && <p className="text-sm">{splitwiseChangeText(item)}</p>}
              <div className="flex flex-wrap gap-2">
                {item.status === "changed" && match ? (
                  <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => applySplitwiseChange(item, match)} type="button">Apply to entry</button>
                ) : item.status === "deleted" && match ? (
                  <>
                    <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => keepDeletedSplitwiseOut(item, match)} type="button">Keep out of balances</button>
                    <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => deleteDeletedSplitwiseEntry(item, match)} type="button">Delete entry</button>
                  </>
                ) : item.status === "changed" || item.status === "deleted" ? (
                  <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => completeSplitwise(item)} type="button">Done</button>
                ) : manuallyEntered ? (
                  <>
                    <span>Enter by hand</span>
                    <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => dismissSplitwise(item)} type="button">Dismiss</button>
                  </>
                ) : (
                  <>
                    {match && <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => completeSplitwise(item, match.id, fullySelfPaid)} type="button">Link</button>}
                    <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => createFromSplitwise(item)} type="button">{fullySelfPaid ? "Create" : "Confirm"}</button>
                  </>
                )}
              </div>
            </article>;
          })}
        </section>
      )}
      <div className="space-y-3">
        <div aria-label="Review queue" role="table">
          <div className="space-y-3" role="rowgroup">
        {pendingRows.map((row) => {
          const account = ledger.accounts.find((item) => item.id === row.accountId);
          const matchedRule = ruleFor(row);
          const memory = matchedRule ? undefined : memoryFor(row);
          const suggestion = suggestionByRow.get(row.id);
          const otherRow = suggestion && (suggestion.outgoing.id === row.id ? suggestion.incoming : suggestion.outgoing);
          const otherAccount = otherRow && ledger.accounts.find((item) => item.id === otherRow.accountId);
          const paymentCycle = row.amountCents > 0 && account?.type === "credit" ? cardCycle(ledger, row) : null;
          const detailIsOpen = openDetail?.rowId === row.id;
          const selectableRows = detailIsOpen && openDetail.kind === "transfer"
            ? pendingRows.filter((item) => item.id !== row.id && item.accountId !== row.accountId && Math.sign(item.amountCents) !== Math.sign(row.amountCents))
            : [];
          return (
            <Fragment key={row.id}>
              <article className="space-y-3 rounded-lg border bg-card p-4" data-review-row={row.id} onFocusCapture={() => setActiveRowId(row.id)} role="row">
                <div className="space-y-3" role="cell">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm text-muted-foreground">{row.date} · {account?.name ?? "Unknown"}</p>
                    <h2 className="break-words font-medium">{row.description || "Bank transaction"}{matchedRule?.action.displayName && <span className="text-muted-foreground"> ({matchedRule.action.displayName})</span>}</h2>
                    {matchedRule && <p className="text-sm text-muted-foreground">By rule: {matchedRule.name}</p>}
                    <div className="flex flex-wrap gap-2">
                      {matchedRule && <Badge>Rule match</Badge>}
                      {memory && <Badge variant="secondary">Remembered spend</Badge>}
                      {suggestion && otherAccount && <Badge variant="outline">Transfer suggestion · {otherAccount.name} · {displayDate(otherRow!.date)}</Badge>}
                    </div>
                  </div>
                  <strong className="shrink-0 text-lg tabular-nums">{formatMoney(row.amountCents)}</strong>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="mr-auto flex items-center gap-2 text-sm"><input aria-label={`Select ${row.description || "bank transaction"}`} checked={selectedRowIds.has(row.id)} onChange={(event) => changeSelection(row.id, event.target.checked)} type="checkbox" /> Select row</label>
                  {row.amountCents < 0 && <button ref={(button) => {
                    if (button) actionRefs.current.set(row.id, button);
                    else actionRefs.current.delete(row.id);
                    shortcutRef(row.id, "s")(button);
                    shortcutRef(row.id, "row")(button);
                  }} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => setOpenDetail({ rowId: row.id, kind: "spend" })} type="button">Spend row <Kbd aria-hidden="true" className="bg-background text-foreground">S</Kbd> <Kbd aria-hidden="true" className="bg-background text-foreground">Enter</Kbd></button>}
                  {row.amountCents > 0 && <button ref={(button) => {
                    if (button) actionRefs.current.set(row.id, button);
                    else actionRefs.current.delete(row.id);
                    shortcutRef(row.id, "i")(button);
                    shortcutRef(row.id, "row")(button);
                  }} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => classifyIncome(row)} type="button">Income row <Kbd aria-hidden="true" className="bg-background text-foreground">I</Kbd></button>}
                  <button ref={shortcutRef(row.id, "t")} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => {
                    setTransferPartnerId("");
                    setOpenDetail({ rowId: row.id, kind: suggestion && otherRow ? "suggestion" : "transfer" });
                  }} type="button">Transfer row <Kbd aria-hidden="true" className="bg-background text-foreground">T</Kbd></button>
                  <button ref={(button) => {
                    shortcutRef(row.id, "x")(button);
                    if (row.amountCents === 0) {
                      if (button) actionRefs.current.set(row.id, button);
                      else actionRefs.current.delete(row.id);
                    }
                  }} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => skipRow(row)} type="button">Skip row <Kbd aria-hidden="true" className="bg-background text-foreground">X</Kbd></button>
                  <details className="rounded-md border px-3 py-2">
                    <summary className="cursor-pointer">More</summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.amountCents > 0 && <button ref={shortcutRef(row.id, "r")} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => {
                        setRefundOfId(refundCandidates(row)[0]?.id ?? "");
                        setOpenDetail({ rowId: row.id, kind: "refund" });
                      }} type="button">Refund <Kbd aria-hidden="true" className="bg-background text-foreground">R</Kbd></button>}
                      <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => onCreateRule(row.description)} type="button">Create rule from this row</button>
                      <button ref={shortcutRef(row.id, "e")} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => onSettle(row)} type="button">Settlement <Kbd aria-hidden="true" className="bg-background text-foreground">E</Kbd></button>
                    </div>
                  </details>
                </div>
              {(detailIsOpen || paymentCycle) && (
                <section className="space-y-4 rounded-lg border p-4" aria-label={`Details for ${row.description || "bank transaction"}`}>
                  {detailIsOpen && openDetail.kind === "spend" && spendingRow?.id === row.id && (
                    <section className="space-y-4" aria-label="Review spend">
                      <h2 className="text-lg font-semibold">Review spend</h2>
                      <SpendForm key={row.id} initialValues={{
                        date: row.date, description: row.description, amountCents: Math.abs(row.amountCents),
                        accountId: row.accountId, bankRowIds: [row.id],
                        categoryId: matchedRule?.action.categoryId ?? memory?.categoryId ?? null,
                        displayName: matchedRule?.action.displayName ?? undefined,
                        payerEntityId: account?.payerEntityId ?? SELF_ENTITY_ID,
                        portions: matchedRule?.action.split
                          ? splitPreset(Math.abs(row.amountCents), account?.payerEntityId ?? SELF_ENTITY_ID, matchedRule.action.split)
                          : [{ entityId: memory?.entityId ?? account?.payerEntityId ?? SELF_ENTITY_ID, amountCents: Math.abs(row.amountCents) }],
                        tags: matchedRule?.action.tags ?? [],
                      }} ledger={ledger}
                        onAddCategory={(category: Category) => update({ ...ledger, categories: [...(ledger.categories ?? []), category] })}
                        onAddEntity={addEntity}
                        onCancel={() => setOpenDetail(null)} onSave={(entry, preset) => saveSpend(row, entry, preset)} />
                    </section>
                  )}
                  {detailIsOpen && openDetail.kind === "refund" && refundRow?.id === row.id && (() => {
                    const candidates = refundCandidates(row);
                    const original = candidates.find((entry) => entry.id === refundOfId);
                    return <section className="space-y-4" aria-label="Review refund">
                      <h2 className="text-lg font-semibold">Review refund</h2>
                      <label className="grid gap-1">Original spend<select value={refundOfId} onChange={(event) => setRefundOfId(event.target.value)}>
                        <option value="">Choose a spend</option>
                        {candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.date} | {entry.description} | {formatMoney(entry.amountCents)}</option>)}
                      </select></label>
                      {original ? <SpendForm key={`${row.id}-${original.id}`} initialValues={{
                        kind: "refund", refundOf: original.id, date: row.date, description: row.description,
                        amountCents: Math.abs(row.amountCents), accountId: row.accountId, bankRowIds: [row.id],
                        payerEntityId: account?.payerEntityId ?? SELF_ENTITY_ID,
                        portions: scaledPortions(original, Math.abs(row.amountCents)),
                      }} ledger={ledger}
                        onAddCategory={(category: Category) => update({ ...ledger, categories: [...(ledger.categories ?? []), category] })}
                        onAddEntity={addEntity}
                        onCancel={() => setOpenDetail(null)} onSave={(entry) => saveRefund(row, entry)} />
                        : candidates.length === 0 ? <p className="text-sm text-muted-foreground">No spends are available to refund.</p> : null}
                    </section>;
                  })()}
                  {detailIsOpen && openDetail.kind === "suggestion" && suggestion && otherRow && otherAccount && <section className="space-y-3" aria-label="Transfer suggestion">
                    <p>Looks like a transfer {row.amountCents < 0 ? "to" : "from"} {otherAccount.name} on {displayDate(otherRow.date)}. {formatMoney(Math.abs(row.amountCents))}.</p>
                    <button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => requestConfirm(suggestion.outgoing, suggestion.incoming)} type="button">Confirm transfer</button>
                    <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => { dismissPair(row, otherRow); setOpenDetail(null); }} type="button">Not a transfer</button>
                    {choiceActions(suggestion.outgoing, suggestion.incoming)}
                  </section>}
                  {detailIsOpen && openDetail.kind === "transfer" && row.amountCents !== 0 && <section className="space-y-3" aria-label="Choose transfer row">
                    <label className="grid gap-1">Other bank row<select value={transferPartnerId} onChange={(event) => setTransferPartnerId(event.target.value)}>
                      <option value="">Choose a row</option>
                      {selectableRows.map((item) => {
                        const itemAccount = ledger.accounts.find((candidate) => candidate.id === item.accountId);
                        return <option key={item.id} value={item.id}>{item.date} | {item.description} | {itemAccount?.name ?? "Unknown"} | {formatMoney(item.amountCents)}</option>;
                      })}
                    </select></label>
                    {transferPartnerId && (() => {
                      const partner = pendingRows.find((item) => item.id === transferPartnerId);
                      if (!partner) return null;
                      const pair = pendingPair(row, partner);
                      return <><button className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => requestConfirm(pair.outgoing, pair.incoming)} type="button">Confirm transfer</button>{choiceActions(pair.outgoing, pair.incoming)}</>;
                    })()}
                  </section>}
                  {paymentCycle && <p className="text-sm text-muted-foreground">Card payments this cycle: {formatMoney(paymentCycle.sumCents)}. Difference {formatMoney(paymentCycle.differenceCents)}. This may be interest or a fee.</p>}
                </section>
              )}
                </div>
              </article>
            </Fragment>
          );
        })}
          </div>
        </div>
        {!pendingRows.length && <p className="rounded-lg border p-4 text-muted-foreground">All caught up.</p>}
      </div>
        </TabsContent>
      </Tabs>
      <AlertDialog onOpenChange={(open) => { if (!open) setConfirmation(null); }} open={Boolean(confirmation)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const action = confirmation?.action;
              setConfirmation(null);
              action?.();
            }}>{confirmation?.confirmLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}