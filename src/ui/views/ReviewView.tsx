import { Fragment, useEffect, useRef, useState } from "react";
import { categoryMemoryAfterSpend, categoryMemoryKey, HOUSE_ENTITY_ID, SELF_ENTITY_ID, splitPreset, type BankRow, type Category, type Entity, type Entry, type Ledger, type SplitPreset } from "../../domain/ledger";
import { cardCycle, confirmTransfer, suggestTransfers, type PossibleTransfer, type TransferChoice } from "../../domain/transfers";
import { formatMoney } from "../../domain/value";
import { canAutoConfirm, firstRule } from "../../domain/rules";
import { SpendForm } from "./SpendForm";
import { createSplitwiseSpend, type SplitwiseInboxItem } from "../../adapters/splitwise";
import { ComboField } from "./ComboField";

interface ReviewViewProps {
  ledger: Ledger;
  update: (next: Ledger, undoLabel?: string) => void;
  onSettle: (row: BankRow) => void;
  onCreateRule: (description: string) => void;
}

export function ReviewView({ ledger, update, onSettle, onCreateRule }: ReviewViewProps) {
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
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const shortcutRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bankRows = ledger.bankRows ?? [];
  const imports = ledger.imports ?? [];
  const pendingRows = bankRows
    .filter((row) => !row.entryId && !row.settlementId && !row.skipped)
    .sort((first, second) => second.date.localeCompare(first.date) || second.line - first.line);
  const selectedRows = pendingRows.filter((row) => selectedRowIds.has(row.id));
  const memoryFor = (row: BankRow) => ledger.categoryMemory?.find((memory) => memory.key === categoryMemoryKey(row.accountId, row.description));
  const ruleFor = (row: BankRow) => firstRule(ledger.rules ?? [], row, ledger.accounts.find((account) => account.id === row.accountId));
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
  const suggestions = suggestTransfers(ledger);
  const suggestionByRow = new Map<string, PossibleTransfer>();
  for (const suggestion of suggestions) {
    suggestionByRow.set(suggestion.outgoing.id, suggestion);
    suggestionByRow.set(suggestion.incoming.id, suggestion);
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
    if (!selectedRows.length || !window.confirm(`Skip ${selectedRows.length} selected bank rows?`)) return;
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
    if (!window.confirm(`Create spends for ${selectedRows.length} selected bank rows?`)) return;
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
    if (!suggestedSpends.length || !window.confirm(`Accept ${suggestedSpends.length} suggested spends?`)) return;
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
    if (!autoRuleRows.length || !window.confirm(`Create ${autoRuleRows.length} spends from auto rules?`)) return;
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
      displayName: ruleFor(row)?.action.displayName ?? undefined,
      countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
      updatedAt: now,
    };
    update({
      ...ledger,
      entries: [...ledger.entries, entry],
      categoryMemory: categoryMemoryAfterSpend(ledger, entry, now),
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
    if (!window.confirm(`Delete “${entry.description || "this entry"}”? This cannot be undone.`)) return;
    if (ledger.entries.some((candidate) => candidate.kind === "refund" && candidate.refundOf === entry.id)) {
      window.alert("Delete its refunds first.");
      return;
    }
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
        <button className="secondary" onClick={() => confirmPair(outgoing, incoming, "contribution")} type="button">Contribution (no one owes anything)</button>{" "}
        <button className="secondary" onClick={() => confirmPair(outgoing, incoming, "settlement")} type="button">Settlement (pays back what House owes)</button>
      </>
    );
  }

  function closeMoreMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  function displayDate(date: string) {
    const [, month, day] = date.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${day} ${months[month - 1]}`;
  }

  return (
    <>
      <header className="page-heading">
        <h1 ref={headingRef} tabIndex={-1}>Review <span className="muted">{pendingRows.length} to review</span></h1>
        {autoRuleRows.length > 0
          ? <button className="primary" onClick={applyAutoRules} type="button">Apply {autoRuleRows.length} auto rules</button>
          : suggestedSpends.length > 0 && <button className="primary" onClick={acceptSuggestedSpends} type="button">Accept {suggestedSpends.length} suggested</button>}
      </header>
      {autoRuleRows.length > 0 && suggestedSpends.length > 0 && <button className="secondary" onClick={acceptSuggestedSpends} type="button">Accept {suggestedSpends.length} memory suggestions</button>}
      {transferMessage && <p className="banner error" role="status">{transferMessage}</p>}
      <p className="hint">Up/Down or j/k move; s spend, i income, x skip, t transfer, e settlement, r refund.</p>
      {splitwiseItems.length > 0 && (
        <section aria-label="From Splitwise">
          <h2>From Splitwise</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Description</th><th>Entity</th><th>Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {splitwiseItems.map((item) => {
                  const entity = ledger.entities.find((candidate) => candidate.id === item.entityId);
                  const fullySelfPaid = item.yourPaidCents === item.costCents;
                  const manuallyEntered = item.yourPaidCents > 0 && !fullySelfPaid;
                  const match = matchingSplitwiseEntry(item);
                  return (
                    <tr key={item.id}>
                      <td className="date-cell">{item.date}</td>
                      <td>{item.description || "Splitwise expense"}</td>
                      <td>{entity?.name ?? "Unknown"}</td>
                      <td className="amount">{formatMoney(item.costCents)}</td>
                      <td>
                        {item.status === "changed" && item.previous ? (
                          <div>
                            <div><strong>Previous:</strong> {item.previous.date} · {item.previous.description} · {formatMoney(item.previous.costCents)} · your owed share {formatMoney(item.previous.yourOwedCents)}</div>
                            <div><strong>Splitwise:</strong> {item.date} · {item.description} · {formatMoney(item.costCents)} · your owed share {formatMoney(item.yourOwedCents)}</div>
                          </div>
                        ) : item.status === "deleted" ? splitwiseChangeText(item) : item.status}
                      </td>
                      <td>
                        {item.status === "changed" && match ? (
                          <button className="primary" onClick={() => applySplitwiseChange(item, match)} type="button">Apply to entry</button>
                        ) : item.status === "deleted" && match ? (
                          <>
                            <button className="secondary" onClick={() => keepDeletedSplitwiseOut(item, match)} type="button">Keep out of balances</button>{" "}
                            <button className="secondary" onClick={() => deleteDeletedSplitwiseEntry(item, match)} type="button">Delete entry</button>
                          </>
                        ) : item.status === "changed" || item.status === "deleted" ? (
                          <button className="secondary" onClick={() => completeSplitwise(item)} type="button">Done</button>
                        ) : manuallyEntered ? (
                          <>
                            <span>Enter by hand </span>
                            <button className="secondary" onClick={() => dismissSplitwise(item)} type="button">Dismiss</button>
                          </>
                        ) : (
                          <>
                            {match && <button className="secondary" onClick={() => completeSplitwise(item, match.id, fullySelfPaid)} type="button">Link</button>}{" "}
                            <button className="primary" onClick={() => createFromSplitwise(item)} type="button">{fullySelfPaid ? "Create" : "Confirm"}</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="filters" aria-label="Bulk review">
        <span>{selectedRows.length} selected</span>
        <label>
          Spend preset
          <select value={bulkPresetKind} onChange={(event) => setBulkPresetKind(event.target.value as SplitPreset["kind"])}>
            <option value="payer">Payer</option>
            <option value="halfHouse">Half House</option>
            <option value="allHouse">All House</option>
            <option value="entity">Entity</option>
            <option value="equal">Equal split</option>
          </select>
        </label>
        {bulkPresetKind === "entity" && <label>
          Entity
          <select value={bulkEntityId} onChange={(event) => setBulkEntityId(event.target.value)}>
            {ledger.entities.filter((entity) => !entity.archived || entity.id === bulkEntityId).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>}
        {bulkPresetKind === "equal" && <label>
          Equal split entities
          <select multiple size={Math.min(4, Math.max(2, ledger.entities.filter((entity) => !entity.archived).length))} value={bulkEntityIds} onChange={(event) => setBulkEntityIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
            {ledger.entities.filter((entity) => !entity.archived || bulkEntityIds.includes(entity.id)).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>}
        <ComboField label="Category" value={bulkCategoryId} options={(ledger.categories ?? [])
          .filter((category) => !category.archived || category.id === bulkCategoryId)
          .map((category) => ({ id: category.id, name: category.name }))}
          nonePlaceholder="Uncategorized" onChange={setBulkCategoryId} onCreate={createCategory} />
        <button className="secondary" disabled={!selectedRows.length} onClick={skipSelected} type="button">Skip selected</button>
        <button className="primary" disabled={!selectedRows.length || selectedRows.some((row) => row.amountCents >= 0) || !selectedBulkPreset()} onClick={spendSelected} type="button">Spend selected</button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th><input aria-label="Select all review rows" checked={pendingRows.length > 0 && selectedRows.length === pendingRows.length} onChange={(event) => setSelectedRowIds(event.target.checked ? new Set(pendingRows.map((row) => row.id)) : new Set())} type="checkbox" /></th><th>Date</th><th>Description</th><th>Account</th><th>Amount</th><th /></tr></thead>
          <tbody>
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
                  <tr key={row.id} data-review-row={row.id} onFocusCapture={() => setActiveRowId(row.id)}>
                    <td><input aria-label={`Select ${row.description || "bank transaction"}`} checked={selectedRowIds.has(row.id)} onChange={(event) => changeSelection(row.id, event.target.checked)} type="checkbox" /></td>
                    <td className="date-cell">{row.date}</td>
                    <td>
                      <div>{row.description || "Bank transaction"}{matchedRule?.action.displayName && <span className="muted"> ({matchedRule.action.displayName})</span>}</div>
                      {matchedRule && <span className="muted">By rule: {matchedRule.name}</span>}
                    </td>
                    <td>{account?.name ?? "Unknown"}</td>
                    <td className="amount">{formatMoney(row.amountCents)}</td>
                    <td>
                      {row.amountCents < 0 ? <button ref={(button) => {
                        if (button) actionRefs.current.set(row.id, button);
                        else actionRefs.current.delete(row.id);
                        shortcutRef(row.id, "s")(button);
                        shortcutRef(row.id, "row")(button);
                      }} className="primary" onClick={() => setOpenDetail({ rowId: row.id, kind: "spend" })} type="button">Spend</button> : row.amountCents > 0 ? <button ref={(button) => {
                        if (button) actionRefs.current.set(row.id, button);
                        else actionRefs.current.delete(row.id);
                        shortcutRef(row.id, "i")(button);
                        shortcutRef(row.id, "row")(button);
                      }} className="primary" onClick={() => classifyIncome(row)} type="button">Income</button> : null}{" "}
                      <button ref={(button) => {
                        shortcutRef(row.id, "x")(button);
                        if (row.amountCents === 0) {
                          if (button) actionRefs.current.set(row.id, button);
                          else actionRefs.current.delete(row.id);
                        }
                      }} className="secondary" onClick={() => skipRow(row)} type="button">Skip</button>{" "}
                      <details className="more-menu">
                        <summary className="secondary">More</summary>
                        <div>
                          <button ref={shortcutRef(row.id, "t")} className="secondary" onClick={(event) => {
                            closeMoreMenu(event);
                            setTransferPartnerId("");
                            setOpenDetail({ rowId: row.id, kind: suggestion && otherRow ? "suggestion" : "transfer" });
                          }} type="button">Transfer</button>
                          {row.amountCents > 0 && <button ref={shortcutRef(row.id, "r")} className="secondary" onClick={(event) => {
                            closeMoreMenu(event);
                            setRefundOfId(refundCandidates(row)[0]?.id ?? "");
                            setOpenDetail({ rowId: row.id, kind: "refund" });
                          }} type="button">Refund</button>}
                          <button className="secondary" onClick={(event) => { closeMoreMenu(event); onCreateRule(row.description); }} type="button">Create rule from this row</button>
                          <button ref={shortcutRef(row.id, "e")} className="secondary" onClick={(event) => { closeMoreMenu(event); onSettle(row); }} type="button">Settlement</button>
                        </div>
                      </details>
                    </td>
                  </tr>
                  {(detailIsOpen || paymentCycle) && (
                    <tr className="row-detail" key={`${row.id}-detail`}>
                      <td colSpan={6}>
                        {detailIsOpen && openDetail.kind === "spend" && spendingRow?.id === row.id && (
                          <section className="form-grid" aria-label="Review spend">
                            <h2>Review spend</h2>
                            <SpendForm key={row.id} initialValues={{
                              date: row.date,
                              description: row.description,
                              amountCents: Math.abs(row.amountCents),
                              accountId: row.accountId,
                              bankRowIds: [row.id],
                              categoryId: matchedRule?.action.categoryId ?? memory?.categoryId ?? null,
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
                          return <section className="form-grid" aria-label="Review refund">
                            <h2>Review refund</h2>
                            <label>Original spend<select value={refundOfId} onChange={(event) => setRefundOfId(event.target.value)}>
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
                              : candidates.length === 0 ? <p className="banner">No spends are available to refund.</p> : null}
                          </section>;
                        })()}
                        {detailIsOpen && openDetail.kind === "suggestion" && suggestion && otherRow && otherAccount && <section aria-label="Transfer suggestion">
                          <p>Looks like a transfer {row.amountCents < 0 ? "to" : "from"} {otherAccount.name} on {displayDate(otherRow.date)}. {formatMoney(Math.abs(row.amountCents))}.</p>
                          <button className="primary" onClick={() => requestConfirm(suggestion.outgoing, suggestion.incoming)} type="button">Confirm transfer</button>{" "}
                          <button className="secondary" onClick={() => { dismissPair(row, otherRow); setOpenDetail(null); }} type="button">Not a transfer</button>
                          {choiceActions(suggestion.outgoing, suggestion.incoming)}
                        </section>}
                        {detailIsOpen && openDetail.kind === "transfer" && row.amountCents !== 0 && <section className="form-grid" aria-label="Choose transfer row">
                          <label>Other bank row<select value={transferPartnerId} onChange={(event) => setTransferPartnerId(event.target.value)}>
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
                            return <><button className="primary" onClick={() => requestConfirm(pair.outgoing, pair.incoming)} type="button">Confirm transfer</button>{choiceActions(pair.outgoing, pair.incoming)}</>;
                          })()}
                        </section>}
                        {paymentCycle && <p className="hint">Card payments this cycle: {formatMoney(paymentCycle.sumCents)}. Difference {formatMoney(paymentCycle.differenceCents)}. This may be interest or a fee.</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!pendingRows.length && <p className="empty-state compact">All caught up.</p>}
      </div>
    </>
  );
}