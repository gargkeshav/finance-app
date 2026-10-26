import { Fragment, useEffect, useRef, useState } from "react";
import { formatMoney, parseAud } from "../../domain/value";
import { categoryMemoryAfterSpend, type Category, type Entry, type EntryKind, type Ledger } from "../../domain/ledger";
import { filterEntries, filteredTotals, type EntryFilter } from "../../domain/query";
import {
  buildExpense,
  getCurrentUser,
  getGroups,
  hasKey,
  postExpense,
  SplitwiseNoResponseError,
  SplitwiseRejectedError,
  type SplitwiseExpenseDraft,
  type SplitwiseExpenseShare,
} from "../../adapters/splitwise";
import { SpendForm } from "./SpendForm";

interface ActivityViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  saveNow: (next: Ledger) => Promise<void>;
  activityFilter: EntryFilter;
  openActivity: (filter: EntryFilter) => void;
  onNavigate?: (view: "Accounts" | "People" | "Import" | "Review") => void;
}

interface StagedPost {
  entryId: string;
  entityId: string;
  youId: number;
  draft: SplitwiseExpenseDraft;
  groupMembers: SplitwiseExpenseShare[];
  groupPortionCents: number;
  costInput: string;
  paidInputs: Record<string, string>;
  owedInputs: Record<string, string>;
}

function centsText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function inputCents(value: string): number | null {
  try {
    return parseAud(value);
  } catch {
    return null;
  }
}

export function ActivityView({ ledger, update, saveNow, activityFilter, openActivity, onNavigate }: ActivityViewProps) {
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [removeTag, setRemoveTag] = useState("");
  const [staged, setStaged] = useState<StagedPost | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const currentLedger = useRef(ledger);
  currentLedger.current = ledger;
  const posts = ledger.splitwisePosts ?? [];
  const filteredEntries = filterEntries(ledger, activityFilter);
  const sortedEntries = [...filteredEntries].sort((first, second) => {
    const order = sortBy === "date"
      ? first.date.localeCompare(second.date) || first.updatedAt.localeCompare(second.updatedAt)
      : first.amountCents - second.amountCents || first.date.localeCompare(second.date);
    return sortDirection === "asc" ? order : -order;
  });
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(sortedEntries.length / pageSize));
  const visibleEntries = sortedEntries.slice(page * pageSize, (page + 1) * pageSize);
  const totals = filteredTotals(filteredEntries);
  const filteredIds = sortedEntries.map((entry) => entry.id);
  const selectedVisibleIds = selectedEntryIds.filter((id) => filteredIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedEntryIds.includes(id));
  const availableTags = [...new Set(selectedVisibleIds.flatMap((id) =>
    ledger.entries.find((entry) => entry.id === id)?.tags ?? [],
  ))].sort((first, second) => first.localeCompare(second));
  const activeFilterCount = Object.values(activityFilter).filter((value) =>
    typeof value === "boolean" || Boolean(value),
  ).length;
  const waitingRows = (ledger.bankRows ?? []).filter(
    (row) => !row.entryId && !row.settlementId && !row.skipped,
  ).length;

  useEffect(() => setPage(0), [activityFilter, sortBy, sortDirection]);
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);

  function pairKey(entryId: string, entityId: string) {
    return `${entryId}:${entityId}`;
  }

  function savePost(post: NonNullable<Ledger["splitwisePosts"]>[number]) {
    const current = currentLedger.current;
    const currentPosts = current.splitwisePosts ?? [];
    update({
      ...current,
      splitwisePosts: [...currentPosts.filter((candidate) => candidate.id !== post.id), post],
    });
  }

  function removePost(postId: string) {
    const current = currentLedger.current;
    update({
      ...current,
      splitwisePosts: (current.splitwisePosts ?? []).filter((candidate) => candidate.id !== postId),
    });
  }

  async function preparePost(entry: Entry, entity: NonNullable<typeof ledger.entities[number]>, portion: Entry["portions"][number]) {
    const key = pairKey(entry.id, entity.id);
    if (!hasKey()) {
      setNotices((current) => ({ ...current, [key]: "Connect Splitwise in People first" }));
      return;
    }
    if ((currentLedger.current.splitwisePosts ?? []).some((post) =>
      post.entryId === entry.id && post.entityId === entity.id
    )) return;
    setNotices((current) => ({ ...current, [key]: "" }));
    try {
      const you = await getCurrentUser();
      const members = entity.splitwise?.kind === "group"
        ? (await getGroups()).find((group) => group.id === Number(entity.splitwise?.id))?.members ?? []
        : [];
      const draft = buildExpense(entry, portion, entity, members, you.id);
      setStaged({
        entryId: entry.id,
        entityId: entity.id,
        youId: you.id,
        draft,
        groupMembers: draft.shares.filter((share) => share.userId !== you.id),
        groupPortionCents: portion.amountCents,
        costInput: centsText(draft.costCents),
        paidInputs: Object.fromEntries(draft.shares.map((share) => [String(share.userId), centsText(share.paidCents)])),
        owedInputs: Object.fromEntries(draft.shares.map((share) => [String(share.userId), centsText(share.owedCents)])),
      });
    } catch (error) {
      setNotices((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Could not prepare the Splitwise expense.",
      }));
    }
  }

  async function submitPost() {
    if (!staged) return;
    const key = pairKey(staged.entryId, staged.entityId);
    if (!hasKey()) {
      setNotices((current) => ({ ...current, [key]: "Connect Splitwise in People first" }));
      return;
    }
    if ((currentLedger.current.splitwisePosts ?? []).some((post) =>
      post.entryId === staged.entryId && post.entityId === staged.entityId
    )) return;

    const costCents = inputCents(staged.costInput);
    const shares = staged.draft.shares.map((share) => {
      const paidCents = inputCents(staged.paidInputs[String(share.userId)] ?? "");
      const owedCents = inputCents(staged.owedInputs[String(share.userId)] ?? "");
      return paidCents === null || owedCents === null
        ? null
        : { ...share, paidCents, owedCents };
    });
    if (costCents === null || costCents <= 0 || shares.some((share) =>
      share === null || share.paidCents < 0 || share.owedCents < 0
    )) {
      setNotices((current) => ({ ...current, [key]: "Shares must add up to the cost." }));
      return;
    }
    const draft: SplitwiseExpenseDraft = {
      ...staged.draft,
      costCents,
      shares: shares as SplitwiseExpenseShare[],
    };
    const paidTotal = draft.shares.reduce((total, share) => total + share.paidCents, 0);
    const owedTotal = draft.shares.reduce((total, share) => total + share.owedCents, 0);
    if (paidTotal !== costCents || owedTotal !== costCents || !draft.date) {
      setNotices((current) => ({ ...current, [key]: "Shares must add up to the cost." }));
      return;
    }

    const posting = {
      id: crypto.randomUUID(),
      entryId: staged.entryId,
      entityId: staged.entityId,
      state: "posting" as const,
      splitwiseExpenseId: null,
      remoteUpdatedAt: null,
      updatedAt: new Date().toISOString(),
    };
    const current = currentLedger.current;
    const postingLedger = {
      ...current,
      splitwisePosts: [...(current.splitwisePosts ?? []).filter((candidate) => candidate.id !== posting.id), posting],
    };
    update(postingLedger);
    setPendingKeys((current) => [...current, key]);
    setStaged(null);
    try {
      await saveNow(postingLedger);
    } catch (error) {
      removePost(posting.id);
      setNotices((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Could not save the pending Splitwise post.",
      }));
      setPendingKeys((current) => current.filter((candidate) => candidate !== key));
      return;
    }
    try {
      const expenseId = await postExpense(draft);
      savePost({ ...posting, state: "posted", splitwiseExpenseId: String(expenseId), remoteUpdatedAt: null, updatedAt: new Date().toISOString() });
      setNotices((current) => ({ ...current, [key]: "" }));
    } catch (error) {
      if (!(error instanceof SplitwiseRejectedError)) {
        savePost({ ...posting, state: "unknown", updatedAt: new Date().toISOString() });
        setNotices((current) => ({
          ...current,
          [key]: error instanceof SplitwiseNoResponseError
            ? `Check Splitwise before retrying. ${error.message}`
            : "Check Splitwise before retrying",
        }));
      } else {
        removePost(posting.id);
        setNotices((current) => ({
          ...current,
          [key]: error instanceof Error ? error.message : "Could not post the Splitwise expense.",
        }));
      }
    } finally {
      setPendingKeys((current) => current.filter((candidate) => candidate !== key));
    }
  }

  function markPosted(post: NonNullable<Ledger["splitwisePosts"]>[number], key: string) {
    const expenseId = window.prompt("Splitwise expense ID");
    if (!expenseId?.trim() || !/^\d+$/.test(expenseId.trim())) return;
    savePost({ ...post, state: "posted", splitwiseExpenseId: expenseId.trim(), updatedAt: new Date().toISOString() });
    setNotices((current) => ({ ...current, [key]: "" }));
  }

  function changeGroupMembers(next: StagedPost, selectedIds: Set<number>) {
    const selected = next.groupMembers.filter((member) => selectedIds.has(member.userId));
    if (!selected.length) return;
    const selfShare = next.draft.shares.find((share) => share.userId === next.youId);
    if (!selfShare) return;
    let remainder = next.groupPortionCents % selected.length;
    const memberShares = selected.map((member) => {
      const owedCents = Math.floor(next.groupPortionCents / selected.length) + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      return { ...member, paidCents: 0, owedCents };
    });
    const shares = [selfShare, ...memberShares];
    setStaged({
      ...next,
      draft: { ...next.draft, shares },
      paidInputs: Object.fromEntries(shares.map((share) => [String(share.userId), next.paidInputs[String(share.userId)] ?? centsText(share.paidCents)])),
      owedInputs: Object.fromEntries(shares.map((share) => [String(share.userId), centsText(share.owedCents)])),
    });
  }

  function saveEntry(entry: Entry) {
    const existing = ledger.entries.find((item) => item.id === entry.id);
    const savedEntry = existing
      ? { ...entry, bankRowIds: entry.bankRowIds ?? existing.bankRowIds, countsTowardDebt: existing.countsTowardDebt }
      : entry;
    update({
      ...ledger,
      entries: existing
        ? ledger.entries.map((item) => item.id === entry.id ? savedEntry : item)
        : [...ledger.entries, savedEntry],
      categoryMemory: categoryMemoryAfterSpend(ledger, savedEntry, new Date().toISOString()),
    });
    setEditing(null);
    setShowForm(false);
  }

  function updateEntryInline(entry: Entry, changes: Partial<Entry>) {
    update({
      ...ledger,
      entries: ledger.entries.map((item) => item.id === entry.id
        ? { ...item, ...changes, updatedAt: new Date().toISOString() }
        : item),
    });
  }

  function addCategory(category: Category) {
    update({ ...ledger, categories: [...(ledger.categories ?? []), category] });
  }

  function deleteEntry(entry: Entry) {
    const refundCount = ledger.entries.filter((item) => item.kind === "refund" && item.refundOf === entry.id).length;
    if (entry.kind === "spend" && refundCount > 0) {
      window.alert(`Delete its ${refundCount} refunds first.`);
      return;
    }
    if (!window.confirm(`Delete “${entry.description || "this entry"}”? This cannot be undone.`)) return;
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.filter((item) => item.id !== entry.id),
      bankRows: (ledger.bankRows ?? []).map((row) => row.entryId === entry.id
        ? { ...row, entryId: null, updatedAt: now }
        : row),
    });
    if (editing?.id === entry.id) setEditing(null);
  }

  function updateSelectedEntries(countsTowardDebt: boolean) {
    if (!selectedVisibleIds.length) return;
    const selected = new Set(selectedVisibleIds);
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.map((entry) => selected.has(entry.id)
        ? { ...entry, countsTowardDebt, updatedAt: now }
        : entry),
    });
    setSelectedEntryIds((current) => current.filter((id) => !selected.has(id)));
  }

  function applyBulkEdit(kind: "category" | "addTag" | "removeTag") {
    if (!selectedVisibleIds.length) return;
    const label = kind === "category" ? "category" : kind === "addTag" ? "tag" : "tag removal";
    if (!window.confirm(`Apply this ${label} change to ${selectedVisibleIds.length} entries?`)) return;
    const selected = new Set(selectedVisibleIds);
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.map((entry) => {
        if (!selected.has(entry.id)) return entry;
        if (kind === "category") {
          return { ...entry, categoryId: bulkCategoryId === "__none__" ? null : bulkCategoryId, updatedAt: now };
        }
        const tags = entry.tags ?? [];
        const nextTags = kind === "addTag"
          ? tags.some((tag) => tag.toLocaleLowerCase() === bulkTag.trim().toLocaleLowerCase())
            ? tags
            : [...tags, bulkTag.trim()]
          : tags.filter((tag) => tag !== removeTag);
        return { ...entry, tags: nextTags, updatedAt: now };
      }),
    });
    setSelectedEntryIds((current) => current.filter((id) => !selected.has(id)));
    if (kind === "addTag") setBulkTag("");
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Ledger</p>
          <h1>Activity</h1>
        </div>
        <button className="primary" onClick={() => { setEditing(null); setShowForm((visible) => !visible); }} type="button">New spend</button>
      </header>
      {showForm && (
        <SpendForm
          key="new"
          ledger={ledger}
          onSave={saveEntry}
          onAddCategory={addCategory}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}
      <div className="activity-toolbar">
        <label className="activity-search">Search<input value={activityFilter.text ?? ""} onChange={(event) => openActivity({ ...activityFilter, text: event.target.value })} placeholder="Description, tag, note" /></label>
        <label>From<input type="date" value={activityFilter.from ?? ""} onChange={(event) => openActivity({ ...activityFilter, from: event.target.value })} /></label>
        <label>To<input type="date" value={activityFilter.to ?? ""} onChange={(event) => openActivity({ ...activityFilter, to: event.target.value })} /></label>
        <label>Kind<select value={activityFilter.kind ?? ""} onChange={(event) => openActivity({ ...activityFilter, kind: event.target.value ? event.target.value as EntryKind : undefined })}><option value="">All activity</option>{(["spend", "refund", "transfer", "income"] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        <label>Sort<select value={`${sortBy}-${sortDirection}`} onChange={(event) => {
          const [nextSort, nextDirection] = event.target.value.split("-");
          setSortBy(nextSort as "date" | "amount");
          setSortDirection(nextDirection as "asc" | "desc");
        }}><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="amount-desc">Highest amount</option><option value="amount-asc">Lowest amount</option></select></label>
        <button className="filter-toggle" aria-expanded={showAdvancedFilters} onClick={() => setShowAdvancedFilters((open) => !open)} type="button">More filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}</button>
        {activeFilterCount > 0 && <button className="text-button" onClick={() => openActivity({})} type="button">Clear</button>}
      </div>
      {showAdvancedFilters && <div className="filters advanced-filters">
        <label>Account<select value={activityFilter.accountId ?? ""} onChange={(event) => openActivity({ ...activityFilter, accountId: event.target.value })}><option value="">All accounts</option>{ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Category<select value={activityFilter.categoryId ?? ""} onChange={(event) => openActivity({ ...activityFilter, categoryId: event.target.value })}><option value="">All categories</option>{(ledger.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Entity<select value={activityFilter.entityId ?? ""} onChange={(event) => openActivity({ ...activityFilter, entityId: event.target.value })}><option value="">Any entity</option>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
        <label>Paid by<select value={activityFilter.payerEntityId ?? ""} onChange={(event) => openActivity({ ...activityFilter, payerEntityId: event.target.value })}><option value="">Anyone</option>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
        <label>Tag<input value={activityFilter.tag ?? ""} onChange={(event) => openActivity({ ...activityFilter, tag: event.target.value })} /></label>
        <label>Counts<select value={activityFilter.counted === undefined ? "" : String(activityFilter.counted)} onChange={(event) => openActivity({ ...activityFilter, counted: event.target.value === "" ? undefined : event.target.value === "true" })}><option value="">Any</option><option value="true">Included</option><option value="false">Excluded</option></select></label>
        <label>Source<select value={activityFilter.source ?? ""} onChange={(event) => openActivity({ ...activityFilter, source: event.target.value ? event.target.value as EntryFilter["source"] : undefined })}><option value="">All sources</option><option value="bank">Bank</option><option value="manual">Manual</option><option value="splitwise">Splitwise</option></select></label>
      </div>}
      <section className="summary-strip" aria-label="Filtered totals">
        <div><span className="metric-label">Entries</span><strong>{totals.count}</strong></div>
        <div><span className="metric-label">Total</span><strong className="amount">{formatMoney(totals.totalCents)}</strong></div>
        <div><span className="metric-label">Personal</span><strong className="amount">{formatMoney(totals.personalCents)}</strong></div>
        <div><span className="metric-label">House</span><strong className="amount">{formatMoney(totals.houseCents)}</strong></div>
      </section>
      {selectedVisibleIds.length > 0 && <div className="bulk-toolbar">
        <label className="checkbox-label"><input checked={allFilteredSelected} onChange={(event) => setSelectedEntryIds((current) => event.target.checked
          ? [...new Set([...current, ...filteredIds])]
          : current.filter((id) => !filteredIds.includes(id)))} type="checkbox" />Select filtered ({filteredIds.length})</label>
        <button className="secondary" disabled={!selectedVisibleIds.length} onClick={() => updateSelectedEntries(true)} type="button">Include selected</button>
        <button className="secondary" disabled={!selectedVisibleIds.length} onClick={() => updateSelectedEntries(false)} type="button">Exclude selected</button>
        <label>Set category<select value={bulkCategoryId} onChange={(event) => setBulkCategoryId(event.target.value)}><option value="">Choose category</option><option value="__none__">Uncategorised</option>{(ledger.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <button className="secondary" disabled={!selectedVisibleIds.length || !bulkCategoryId} onClick={() => applyBulkEdit("category")} type="button">Apply to {selectedVisibleIds.length}</button>
        <label>Add tag<input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} /></label>
        <button className="secondary" disabled={!selectedVisibleIds.length || !bulkTag.trim()} onClick={() => applyBulkEdit("addTag")} type="button">Add to {selectedVisibleIds.length}</button>
        <label>Remove tag<select value={removeTag} onChange={(event) => setRemoveTag(event.target.value)}><option value="">Choose tag</option>{availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
        <button className="secondary" disabled={!selectedVisibleIds.length || !removeTag} onClick={() => applyBulkEdit("removeTag")} type="button">Remove from {selectedVisibleIds.length}</button>
        <button className="text-button" onClick={() => setSelectedEntryIds([])} type="button">Clear selection</button>
      </div>}
      {ledger.accounts.length === 0 ? (
        <section className="card">
          <ol className="steps">
            <li className={ledger.accounts.length > 0 ? "done" : ""}>
              Add your bank accounts <button className="text-button" onClick={() => onNavigate?.("Accounts")} type="button">Open Accounts</button>
            </li>
            <li className={ledger.entities.some((entity) => entity.kind === "person" || entity.kind === "group") ? "done" : ""}>
              Add people and groups you share costs with <button className="text-button" onClick={() => onNavigate?.("People")} type="button">Open People</button>
            </li>
            <li className={(ledger.bankRows ?? []).length > 0 ? "done" : ""}>
              Import a CSV from your bank <button className="text-button" onClick={() => onNavigate?.("Import")} type="button">Open Import</button>
            </li>
            <li className={(ledger.bankRows ?? []).length > 0 && waitingRows === 0 ? "done" : ""}>
              Review the imported rows <button className="text-button" onClick={() => onNavigate?.("Review")} type="button">Open Review</button>
            </li>
          </ol>
        </section>
      ) : (
      <div className="table-scroll">
        <table className="activity-table">
          <thead><tr><th><input aria-label="Select filtered entries" checked={allFilteredSelected} disabled={filteredIds.length === 0} onChange={(event) => setSelectedEntryIds((current) => event.target.checked
            ? [...new Set([...current, ...filteredIds])]
            : current.filter((id) => !filteredIds.includes(id)))} type="checkbox" /></th><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Paid by</th><th>Amount</th><th>Counts</th><th /></tr></thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const payer = ledger.entities.find((entity) => entity.id === entry.payerEntityId);
              const account = ledger.accounts.find((item) => item.id === entry.accountId);
              const bankRows = (ledger.bankRows ?? []).filter((row) => entry.bankRowIds?.includes(row.id));
              const expanded = expandedEntryIds.includes(entry.id);
              const categoryName = ledger.categories?.find((category) => category.id === entry.categoryId)?.name ?? "Uncategorised";
              return (
                <Fragment key={entry.id}>
                <tr className="activity-row" key={entry.id}>
                  <td><input aria-label={`Select ${entry.description || entry.kind}`} type="checkbox" checked={selectedEntryIds.includes(entry.id)} onChange={(event) => setSelectedEntryIds((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} /></td>
                  <td className="date-cell"><input aria-label={`${entry.description || entry.kind} date`} type="date" value={entry.date} onChange={(event) => updateEntryInline(entry, { date: event.target.value })} /></td>
                  <td>
                    <input className="inline-description" aria-label={`${entry.description || entry.kind} description`} value={entry.description} onChange={(event) => updateEntryInline(entry, { description: event.target.value })} />
                    <span className="activity-kind">{entry.kind}{entry.displayName ? ` · ${entry.displayName}` : ""}</span>
                    {entry.kind === "spend" && entry.portions.map((portion) => {
                      if (portion.entityId === entry.payerEntityId || portion.entityId === "self") return null;
                      const entity = ledger.entities.find((candidate) => candidate.id === portion.entityId);
                      if (!entity) return null;
                      return <span className={`allocation-tag${entity.kind === "house" ? " house" : ""}`} key={entity.id}>{entity.name}</span>;
                    })}
                    {bankRows.length > 0 && (
                      <div className="muted">{bankRows.map((row) => `${row.date} · ${row.description} · ${formatMoney(row.amountCents)}`).join(" · ")}</div>
                    )}
                    {expanded && entry.kind === "spend" && entry.payerEntityId === "self" && entry.portions.map((portion) => {
                      const entity = ledger.entities.find((candidate) => candidate.id === portion.entityId);
                      if (!entity?.splitwise || entity.kind === "self" || entity.kind === "house" || entry.splitwiseExpenseId) return null;
                      const key = pairKey(entry.id, entity.id);
                      const post = posts.find((candidate) => candidate.entryId === entry.id && candidate.entityId === entity.id);
                      const isStaged = staged?.entryId === entry.id && staged.entityId === entity.id;
                      const draftCostCents = isStaged && staged ? inputCents(staged.costInput) : null;
                      const paidAmounts = isStaged && staged
                        ? staged.draft.shares.map((share) => inputCents(staged.paidInputs[String(share.userId)] ?? ""))
                        : [];
                      const owedAmounts = isStaged && staged
                        ? staged.draft.shares.map((share) => inputCents(staged.owedInputs[String(share.userId)] ?? ""))
                        : [];
                      const paidTotal = paidAmounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);
                      const owedTotal = owedAmounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);
                      const sharesValid = Boolean(isStaged && staged && draftCostCents !== null && draftCostCents > 0 &&
                        paidAmounts.every((amount) => amount !== null && amount >= 0) &&
                        owedAmounts.every((amount) => amount !== null && amount >= 0) &&
                        draftCostCents === paidTotal && draftCostCents === owedTotal && staged.draft.date);
                      const selectedMemberIds = new Set(staged?.groupMembers
                        .filter((member) => staged.draft.shares.some((share) => share.userId === member.userId))
                        .map((member) => member.userId) ?? []);
                      return (
                        <div key={entity.id}>
                          {post?.state === "posting" && pendingKeys.includes(key) && <span>Posting to Splitwise</span>}
                          {post?.state === "posted" && <span>Posted to Splitwise ({post.splitwiseExpenseId})</span>}
                          {(post?.state === "unknown" || post?.state === "posting" && !pendingKeys.includes(key)) && (
                            <div>
                              <span>Check Splitwise before retrying</span>{" "}
                              <button className="secondary" onClick={() => markPosted(post, key)} type="button">Mark posted</button>{" "}
                              <button className="secondary" onClick={() => removePost(post.id)} type="button">Clear</button>
                            </div>
                          )}
                          {!post && !isStaged && (
                            <button
                              className="secondary"
                              disabled={pendingKeys.includes(key)}
                              onClick={() => void preparePost(entry, entity, portion)}
                              type="button"
                            >Post to Splitwise</button>
                          )}
                          {isStaged && staged && (
                            <div className="form-grid">
                              <label>
                                Description
                                <input value={staged.draft.description} onChange={(event) => setStaged((current) => current
                                  ? { ...current, draft: { ...current.draft, description: event.target.value } }
                                  : current)} />
                              </label>
                              <label>
                                Date
                                <input type="date" value={staged.draft.date} onChange={(event) => setStaged((current) => current
                                  ? { ...current, draft: { ...current.draft, date: event.target.value } }
                                  : current)} />
                              </label>
                              <label>
                                Cost (AUD)
                                <input min="0" step="0.01" type="number" value={staged.costInput} onChange={(event) => setStaged((current) => current
                                  ? { ...current, costInput: event.target.value }
                                  : current)} />
                              </label>
                              {staged.draft.groupId !== 0 && (
                                <fieldset>
                                  <legend>Group members</legend>
                                  {staged.groupMembers.map((member) => (
                                    <label className="checkbox-label" key={member.userId}>
                                      <input
                                        checked={selectedMemberIds.has(member.userId)}
                                        disabled={selectedMemberIds.size === 1 && selectedMemberIds.has(member.userId)}
                                        onChange={(event) => {
                                          const nextIds = new Set(selectedMemberIds);
                                          if (event.target.checked) nextIds.add(member.userId);
                                          else nextIds.delete(member.userId);
                                          changeGroupMembers(staged, nextIds);
                                        }}
                                        type="checkbox"
                                      />
                                      {member.name}
                                    </label>
                                  ))}
                                </fieldset>
                              )}
                              <div className="table-scroll">
                                <table>
                                  <thead><tr><th>Share</th><th>Paid (AUD)</th><th>Owed (AUD)</th></tr></thead>
                                  <tbody>
                                    {staged.draft.shares.map((share) => (
                                      <tr key={share.userId}>
                                        <td>{share.name}</td>
                                        <td>
                                          <label>
                                            <span className="sr-only">{share.name} paid share</span>
                                            <input aria-label={`${share.name} paid share`} min="0" step="0.01" type="number" value={staged.paidInputs[String(share.userId)] ?? ""}
                                              onChange={(event) => setStaged((current) => current ? {
                                                ...current,
                                                paidInputs: { ...current.paidInputs, [String(share.userId)]: event.target.value },
                                              } : current)} />
                                          </label>
                                        </td>
                                        <td>
                                          <label>
                                            <span className="sr-only">{share.name} owed share</span>
                                            <input aria-label={`${share.name} owed share`} min="0" step="0.01" type="number" value={staged.owedInputs[String(share.userId)] ?? ""}
                                              onChange={(event) => setStaged((current) => current ? {
                                                ...current,
                                                owedInputs: { ...current.owedInputs, [String(share.userId)]: event.target.value },
                                              } : current)} />
                                          </label>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {!sharesValid && <p role="status">Shares must add up to the cost.</p>}
                              <button className="primary" disabled={pendingKeys.includes(key) || !sharesValid} onClick={() => void submitPost()} type="button">Post expense</button>{" "}
                              <button className="secondary" onClick={() => setStaged(null)} type="button">Cancel</button>
                            </div>
                          )}
                          {notices[key] && <div role="status">{notices[key]}</div>}
                        </div>
                      );
                    })}
                  </td>
                  <td>
                    <select aria-label={`${entry.description || entry.kind} category`} value={entry.categoryId ?? ""} onChange={(event) => updateEntryInline(entry, { categoryId: event.target.value || null })}>
                      <option value="">Uncategorised</option>
                      {(ledger.categories ?? []).filter((category) => !category.archived || category.id === entry.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </td>
                  <td>{account?.name ?? <span className="muted">No account</span>}</td>
                  <td>{payer?.name ?? "Unknown"}</td>
                  <td className="amount">{formatMoney(entry.amountCents)}</td>
                  <td><input aria-label={`Count ${entry.description || entry.kind} toward balances`} type="checkbox" checked={entry.countsTowardDebt} onChange={(event) => updateEntryInline(entry, { countsTowardDebt: event.target.checked })} /></td>
                  <td>
                    <div className="row-actions">
                      <button className="text-button" aria-expanded={expanded} onClick={() => setExpandedEntryIds((current) => expanded ? current.filter((id) => id !== entry.id) : [...current, entry.id])} type="button">{expanded ? "Close" : "Details"}</button>
                      {entry.kind === "spend" && <button className="text-button" onClick={() => { setEditing(entry); setShowForm(false); setExpandedEntryIds((current) => current.includes(entry.id) ? current : [...current, entry.id]); }} type="button">Edit all</button>}
                      <button className="text-button danger-link" onClick={() => deleteEntry(entry)} type="button">Delete</button>
                    </div>
                  </td>
                </tr>
                {expanded && <tr className="activity-detail-row" key={`${entry.id}-details`}>
                  <td colSpan={9}>
                    {editing?.id === entry.id ? (
                      <SpendForm
                        key={entry.id}
                        ledger={ledger}
                        initialValues={entry}
                        onSave={saveEntry}
                        onAddCategory={addCategory}
                        onCancel={() => setEditing(null)}
                      />
                    ) : <div className="entry-details">
                      <div><span className="detail-label">Category</span><strong>{categoryName}</strong></div>
                      <div><span className="detail-label">Account</span><strong>{account?.name ?? "No account"}</strong></div>
                      <div><span className="detail-label">Split</span>{entry.portions.length > 0 ? entry.portions.map((portion) => {
                        const entity = ledger.entities.find((candidate) => candidate.id === portion.entityId);
                        return <span className="detail-line" key={portion.entityId}>{entity?.name ?? "Unknown"}: {formatMoney(portion.amountCents)}</span>;
                      }) : <strong>No split details</strong>}</div>
                      <div><span className="detail-label">Tags</span><strong>{entry.tags?.length ? entry.tags.join(", ") : "None"}</strong></div>
                      <div className="detail-note"><span className="detail-label">Note</span><strong>{entry.note || "No note"}</strong></div>
                      {bankRows.length > 0 && <div className="detail-sources"><span className="detail-label">Bank source</span>{bankRows.map((row) => <span className="detail-line" key={row.id}>{row.date} · {row.description} · {formatMoney(row.amountCents)}</span>)}</div>}
                      {entry.kind === "spend" && <button className="secondary" onClick={() => setEditing(entry)} type="button">Edit all fields</button>}
                    </div>}
                  </td>
                </tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {visibleEntries.length === 0 && <p className="empty-state compact">{ledger.entries.length ? "No activity matches these filters." : "No activity yet."}</p>}
        {visibleEntries.length > 0 && <div className="activity-pagination" aria-label="Activity pages">
          <span>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedEntries.length)} of {sortedEntries.length}</span>
          <div>
            <button className="secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">Previous</button>
            <span>Page {page + 1} of {pageCount}</span>
            <button className="secondary" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} type="button">Next</button>
          </div>
        </div>}
      </div>
      )}
    </>
  );
}