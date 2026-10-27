import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import { formatMoney, parseAud } from "../../domain/value";
import { categoryMemoryAfterSpend, merchantNameAfterSpend, type Category, type Entity, type Entry, type EntryKind, type Ledger } from "../../domain/ledger";
import { filterEntries, filteredTotals, type EntryFilter } from "../../domain/query";
import {
  buildExpense,
  getCurrentUser,
  getGroups,
  postExpense,
  sessionStatus,
  SplitwiseNoResponseError,
  SplitwiseRejectedError,
  type SplitwiseExpenseDraft,
  type SplitwiseExpenseShare,
} from "../../adapters/splitwise";
import { SpendForm } from "./SpendForm";
import { ComboField } from "./ComboField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

interface ActivityViewProps {
  ledger: Ledger;
  update: (next: Ledger, undoLabel?: string) => void;
  saveNow: (next: Ledger) => Promise<void>;
  activityFilter: EntryFilter;
  openActivity: (filter: EntryFilter) => void;
  onNavigate?: (view: "Accounts" | "People" | "Import" | "Review") => void;
  addSpendRequest?: number;
}

interface ActivityRow {
  entry: Entry;
  displayDescription: string;
  categoryName: string;
  payerName: string;
  accountName: string;
}

function InlineEdit({
  label,
  value,
  type = "text",
  onSave,
}: {
  label: string;
  value: string;
  type?: "text" | "date";
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const skipBlur = useRef(false);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    if (draft !== value) onSave(draft);
  }

  return (
    <Input
      aria-label={label}
      type={type}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          skipBlur.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
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

export function ActivityView({ ledger, update, saveNow, activityFilter, openActivity, onNavigate, addSpendRequest = 0 }: ActivityViewProps) {
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sheetEntryId, setSheetEntryId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [removeTag, setRemoveTag] = useState("");
  const [staged, setStaged] = useState<StagedPost | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; action: () => void } | null>(null);
  const [markPostedTarget, setMarkPostedTarget] = useState<{ post: NonNullable<Ledger["splitwisePosts"]>[number]; key: string } | null>(null);
  const [expenseIdInput, setExpenseIdInput] = useState("");
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const currentLedger = useRef(ledger);
  currentLedger.current = ledger;
  const posts = ledger.splitwisePosts ?? [];
  const filteredEntries = filterEntries(ledger, activityFilter);
  const totals = filteredTotals(filteredEntries);
  const filteredIds = filteredEntries.map((entry) => entry.id);
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

  const tableData: ActivityRow[] = filteredEntries.map((entry) => ({
    entry,
    displayDescription: entry.displayName || entry.description || entry.kind,
    categoryName: ledger.categories?.find((category) => category.id === entry.categoryId)?.name ?? "Uncategorised",
    payerName: ledger.entities.find((entity) => entity.id === entry.payerEntityId)?.name ?? "Unknown",
    accountName: ledger.accounts.find((account) => account.id === entry.accountId)?.name ?? "No account",
  }));
  const columns: ColumnDef<ActivityRow>[] = [
    {
      id: "select",
      header: () => (
        <input
          aria-label="Select filtered entries"
          checked={allFilteredSelected}
          disabled={filteredIds.length === 0}
          onChange={(event) => setSelectedEntryIds((current) => event.target.checked
            ? [...new Set([...current, ...filteredIds])]
            : current.filter((id) => !filteredIds.includes(id)))}
          type="checkbox"
        />
      ),
      cell: ({ row }) => (
        <input
          aria-label={`Select ${row.original.entry.description || row.original.entry.kind}`}
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
      ),
      enableSorting: false,
    },
    {
      accessorFn: (row) => row.entry.date,
      id: "date",
      header: "Date",
      cell: ({ row }) => (
        <InlineEdit
          label={`${row.original.entry.description || row.original.entry.kind} date`}
          type="date"
          value={row.original.entry.date}
          onSave={(date) => updateEntryInline(row.original.entry, { date })}
        />
      ),
    },
    {
      accessorFn: (row) => row.displayDescription,
      id: "description",
      header: "Description",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-52">
          <div className="font-medium">{row.original.displayDescription}</div>
          <InlineEdit
            label={`${row.original.entry.description || row.original.entry.kind} description`}
            value={row.original.entry.description}
            onSave={(description) => updateEntryInline(row.original.entry, { description })}
          />
          <div className="text-xs text-muted-foreground">{row.original.entry.kind}</div>
        </div>
      ),
    },
    { accessorKey: "categoryName", header: "Category", enableSorting: false },
    { accessorKey: "payerName", header: "Who", enableSorting: false },
    { accessorKey: "accountName", header: "Account", enableSorting: false },
    {
      accessorFn: (row) => row.entry.amountCents,
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <span className="block text-right font-medium tabular-nums">{formatMoney(row.original.entry.amountCents)}</span>,
    },
  ];
  const table = useReactTable({
    data: tableData,
    columns,
    getRowId: (row) => row.entry.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onPaginationChange: (updater) => setPage((current) => {
      const state: PaginationState = { pageIndex: current, pageSize: 50 };
      return typeof updater === "function" ? updater(state).pageIndex : updater.pageIndex;
    }),
    onRowSelectionChange: (updater) => setSelectedEntryIds((current) => {
      const previous: RowSelectionState = Object.fromEntries(current.map((id) => [id, true]));
      const next = typeof updater === "function" ? updater(previous) : updater;
      return Object.keys(next).filter((id) => next[id]);
    }),
    state: {
      sorting,
      pagination: { pageIndex: page, pageSize: 50 },
      rowSelection: Object.fromEntries(selectedEntryIds.map((id) => [id, true])),
    },
  });
  const pageCount = Math.max(1, table.getPageCount());
  const sheetEntry = ledger.entries.find((entry) => entry.id === sheetEntryId) ?? null;
  const sheetOpen = showForm || sheetEntryId !== null;

  function setSort(value: string) {
    const [id, direction] = value.split("-");
    setSorting([{ id, desc: direction === "desc" }]);
  }

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const updateNarrow = () => setIsNarrow(query.matches);
    updateNarrow();
    query.addEventListener("change", updateNarrow);
    return () => query.removeEventListener("change", updateNarrow);
  }, []);
  useEffect(() => setPage(0), [activityFilter, sorting]);
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);
  useEffect(() => {
    if (!addSpendRequest) return;
    setSheetEntryId(null);
    setEditing(null);
    setShowForm(true);
  }, [addSpendRequest]);

  function pairKey(entryId: string, entityId: string) {
    return `${entryId}:${entityId}`;
  }

  function savePost(post: NonNullable<Ledger["splitwisePosts"]>[number]) {
    const current = currentLedger.current;
    const currentPosts = current.splitwisePosts ?? [];
    update({
      ...current,
      splitwisePosts: [...currentPosts.filter((candidate) => candidate.id !== post.id), post],
    }, "Update Splitwise post");
  }

  function removePost(postId: string) {
    const current = currentLedger.current;
    update({
      ...current,
      splitwisePosts: (current.splitwisePosts ?? []).filter((candidate) => candidate.id !== postId),
    }, "Update Splitwise post");
  }

  async function preparePost(entry: Entry, entity: NonNullable<typeof ledger.entities[number]>, portion: Entry["portions"][number]) {
    const key = pairKey(entry.id, entity.id);
    if ((currentLedger.current.splitwisePosts ?? []).some((post) =>
      post.entryId === entry.id && post.entityId === entity.id
    )) return;
    setNotices((current) => ({ ...current, [key]: "" }));
    try {
      if (!(await sessionStatus()).connected) {
        setNotices((current) => ({ ...current, [key]: "Connect Splitwise in People first." }));
        return;
      }
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
    try {
      if (!(await sessionStatus()).connected) {
        setNotices((current) => ({ ...current, [key]: "Connect Splitwise in People first." }));
        return;
      }
    } catch (error) {
      setNotices((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Could not check the Splitwise session.",
      }));
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
    setExpenseIdInput("");
    setMarkPostedTarget({ post, key });
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
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: existing
        ? ledger.entries.map((item) => item.id === entry.id ? savedEntry : item)
        : [...ledger.entries, savedEntry],
      categoryMemory: categoryMemoryAfterSpend(ledger, savedEntry, now),
      merchantNames: merchantNameAfterSpend(ledger, savedEntry, now),
    }, existing ? "Save spend" : "Save spend");
    setEditing(null);
    setShowForm(false);
    setSheetEntryId(null);
  }

  function updateEntryInline(entry: Entry, changes: Partial<Entry>, label = "Edit entry") {
    update({
      ...ledger,
      entries: ledger.entries.map((item) => item.id === entry.id
        ? { ...item, ...changes, updatedAt: new Date().toISOString() }
        : item),
    }, label);
  }

  function addCategory(category: Category) {
    update({ ...ledger, categories: [...(ledger.categories ?? []), category] }, "Create category");
  }

  function createCategory(name: string): string {
    const category: Category = { id: crypto.randomUUID(), name, archived: false, updatedAt: new Date().toISOString() };
    addCategory(category);
    return category.id;
  }

  function addEntity(entity: Entity) {
    update({ ...ledger, entities: [...ledger.entities, entity] }, "Create entity");
  }

  function deleteEntry(entry: Entry) {
    const refundCount = ledger.entries.filter((item) => item.kind === "refund" && item.refundOf === entry.id).length;
    if (entry.kind === "spend" && refundCount > 0) {
      toast.error(`Delete its ${refundCount} refunds first.`);
      return;
    }
    setConfirmation({
      title: "Delete entry?",
      description: `Delete “${entry.description || "this entry"}”? This cannot be undone.`,
      action: () => {
        const now = new Date().toISOString();
        update({
          ...ledger,
          entries: ledger.entries.filter((item) => item.id !== entry.id),
          bankRows: (ledger.bankRows ?? []).map((row) => row.entryId === entry.id
            ? { ...row, entryId: null, updatedAt: now }
            : row),
        }, "Delete entry");
        setConfirmation(null);
        setSheetEntryId(null);
      },
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
    }, countsTowardDebt ? "Bulk include entries" : "Bulk exclude entries");
    setSelectedEntryIds((current) => current.filter((id) => !selected.has(id)));
  }

  function applyBulkEdit(kind: "category" | "addTag" | "removeTag") {
    if (!selectedVisibleIds.length) return;
    const label = kind === "category" ? "category" : kind === "addTag" ? "tag" : "tag removal";
    setConfirmation({
      title: "Apply bulk change?",
      description: `Apply this ${label} change to ${selectedVisibleIds.length} entries?`,
      action: () => {
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
        }, "Bulk update entries");
        setSelectedEntryIds((current) => current.filter((id) => !selected.has(id)));
        if (kind === "addTag") setBulkTag("");
        setConfirmation(null);
      },
    });
  }

  return (
    <>
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Ledger</p>
          <h1 className="text-2xl font-semibold">Activity</h1>
        </div>
        <Button onClick={() => { setEditing(null); setSheetEntryId(null); setShowForm(true); }}>Add spend</Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search"
            className="pl-9"
            placeholder="Description, tag, note"
            value={activityFilter.text ?? ""}
            onChange={(event) => openActivity({ ...activityFilter, text: event.target.value || undefined })}
          />
        </div>
        <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
          <PopoverTrigger render={<Button variant="outline" />}>
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
          </PopoverTrigger>
          <PopoverContent align="end" className="grid w-72 gap-3">
            <label className="grid gap-1 text-sm">From<Input aria-label="From" type="date" value={activityFilter.from ?? ""} onChange={(event) => openActivity({ ...activityFilter, from: event.target.value || undefined })} /></label>
            <label className="grid gap-1 text-sm">To<Input aria-label="To" type="date" value={activityFilter.to ?? ""} onChange={(event) => openActivity({ ...activityFilter, to: event.target.value || undefined })} /></label>
            <label className="grid gap-1 text-sm">Kind
              <select aria-label="Kind" value={activityFilter.kind ?? ""} onChange={(event) => openActivity({ ...activityFilter, kind: event.target.value ? event.target.value as EntryKind : undefined })}>
                <option value="">All activity</option>
                {(["spend", "refund", "transfer", "income"] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
          </PopoverContent>
        </Popover>
        <Button aria-expanded={showAdvancedFilters} onClick={() => setShowAdvancedFilters((open) => !open)} variant="outline">
          More filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
        </Button>
        <label className="flex items-center gap-2 text-sm">Sort
          <select
            aria-label="Sort"
            value={`${sorting[0]?.id ?? "date"}-${sorting[0]?.desc ? "desc" : "asc"}`}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="amount-desc">Highest amount</option>
            <option value="amount-asc">Lowest amount</option>
          </select>
        </label>
        {activeFilterCount > 0 && <Button onClick={() => openActivity({})} variant="ghost">Clear filters</Button>}
      </div>

      {activeFilterCount > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Active filters">
          {Object.entries(activityFilter).filter(([, value]) => typeof value === "boolean" || Boolean(value)).map(([key, value]) => (
            <Button
              key={key}
              onClick={() => openActivity({ ...activityFilter, [key]: undefined })}
              size="sm"
              variant="secondary"
            >
              {key}: {String(value)} ×
            </Button>
          ))}
        </div>
      )}

      {showAdvancedFilters && (
        <div className="mb-4 grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">Account
            <select aria-label="Account" value={activityFilter.accountId ?? ""} onChange={(event) => openActivity({ ...activityFilter, accountId: event.target.value || undefined })}>
              <option value="">All accounts</option>{ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <ComboField
            label="Category"
            value={activityFilter.uncategorized && !activityFilter.categoryId ? "__uncategorized__" : activityFilter.categoryId ?? ""}
            options={[{ id: "__uncategorized__", name: "Uncategorised" }, ...(ledger.categories ?? []).map((category) => ({ id: category.id, name: category.name }))]}
            nonePlaceholder="All categories"
            onChange={(categoryId) => openActivity({
              ...activityFilter,
              categoryId: categoryId === "__uncategorized__" ? undefined : categoryId || undefined,
              uncategorized: categoryId === "__uncategorized__" ? true : undefined,
            })}
            onCreate={createCategory}
          />
          <label className="grid gap-1 text-sm">Entity
            <select aria-label="Entity" value={activityFilter.entityId ?? ""} onChange={(event) => openActivity({ ...activityFilter, entityId: event.target.value || undefined })}>
              <option value="">Any entity</option>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Paid by
            <select aria-label="Paid by" value={activityFilter.payerEntityId ?? ""} onChange={(event) => openActivity({ ...activityFilter, payerEntityId: event.target.value || undefined })}>
              <option value="">Anyone</option>{ledger.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Tag<Input aria-label="Tag" value={activityFilter.tag ?? ""} onChange={(event) => openActivity({ ...activityFilter, tag: event.target.value || undefined })} /></label>
          <label className="grid gap-1 text-sm">Counts
            <select aria-label="Counts" value={activityFilter.counted === undefined ? "" : String(activityFilter.counted)} onChange={(event) => openActivity({ ...activityFilter, counted: event.target.value === "" ? undefined : event.target.value === "true" })}>
              <option value="">Any</option><option value="true">Included</option><option value="false">Excluded</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Settled
            <select aria-label="Settled" value={activityFilter.settled === undefined ? "" : String(activityFilter.settled)} onChange={(event) => openActivity({ ...activityFilter, settled: event.target.value === "" ? undefined : event.target.value === "true" })}>
              <option value="">Any</option><option value="false">Open</option><option value="true">Settled</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Source
            <select aria-label="Source" value={activityFilter.source ?? ""} onChange={(event) => openActivity({ ...activityFilter, source: event.target.value ? event.target.value as EntryFilter["source"] : undefined })}>
              <option value="">All sources</option><option value="bank">Bank</option><option value="manual">Manual</option><option value="splitwise">Splitwise</option>
            </select>
          </label>
        </div>
      )}

      <section className="mb-4 grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-4" aria-label="Filtered totals">
        <div><span className="block text-xs text-muted-foreground">Entries</span><strong>{totals.count}</strong></div>
        <div><span className="block text-xs text-muted-foreground">Total</span><strong className="tabular-nums">{formatMoney(totals.totalCents)}</strong></div>
        <div><span className="block text-xs text-muted-foreground">Personal</span><strong className="tabular-nums">{formatMoney(totals.personalCents)}</strong></div>
        <div><span className="block text-xs text-muted-foreground">House</span><strong className="tabular-nums">{formatMoney(totals.houseCents)}</strong></div>
      </section>

      {ledger.accounts.length === 0 && (
        <section className="mb-4 rounded-lg border p-4">
          <h2 className="mb-2 font-medium">Set up your ledger</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onNavigate?.("Accounts")} variant="outline">Open Accounts</Button>
            <Button onClick={() => onNavigate?.("People")} variant="outline">Open People</Button>
            <Button onClick={() => onNavigate?.("Import")} variant="outline">Import CSV</Button>
            {waitingRows > 0 && <Button onClick={() => onNavigate?.("Review")} variant="outline">Review {waitingRows} rows</Button>}
          </div>
        </section>
      )}

      {selectedVisibleIds.length > 0 && (
        <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 shadow-sm">
          <span>{selectedVisibleIds.length} selected</span>
          <Button onClick={() => updateSelectedEntries(true)} size="sm" variant="outline">Bulk include</Button>
          <Button onClick={() => updateSelectedEntries(false)} size="sm" variant="outline">Bulk exclude</Button>
          <ComboField label="Bulk category" value={bulkCategoryId} options={[{ id: "__none__", name: "Uncategorised" }, ...(ledger.categories ?? []).map((category) => ({ id: category.id, name: category.name }))]} nonePlaceholder="Choose category" onChange={setBulkCategoryId} onCreate={createCategory} />
          <Button disabled={!bulkCategoryId} onClick={() => applyBulkEdit("category")} size="sm" variant="outline">Bulk apply category</Button>
          <label className="grid gap-1 text-sm">Bulk tag<Input aria-label="Bulk tag" value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} /></label>
          <Button disabled={!bulkTag.trim()} onClick={() => applyBulkEdit("addTag")} size="sm" variant="outline">Bulk add tag</Button>
          <label className="grid gap-1 text-sm">Bulk remove tag
            <select aria-label="Bulk remove tag" value={removeTag} onChange={(event) => setRemoveTag(event.target.value)}>
              <option value="">Choose tag</option>{availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
          <Button disabled={!removeTag} onClick={() => applyBulkEdit("removeTag")} size="sm" variant="outline">Bulk remove tag</Button>
          <Button onClick={() => setSelectedEntryIds([])} size="sm" variant="ghost">Clear selection</Button>
        </div>
      )}

      {tableData.length === 0 ? (
        <Empty className="rounded-lg border">
          <EmptyHeader>
            <EmptyTitle>No activity matches these filters</EmptyTitle>
            <EmptyDescription>Adjust or clear the filters to see entries.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={() => openActivity({})} variant="outline">Clear filters</Button></EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border sm:block">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const sortable = header.column.getCanSort();
                      const title = typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : "";
                      return (
                        <TableHead key={header.id} className={header.column.id === "amount" ? "text-right !text-black dark:!text-white" : "!text-black dark:!text-white"}>
                          {header.isPlaceholder ? null : sortable ? (
                            <Button className="!text-black dark:!text-white" onClick={header.column.getToggleSortingHandler()} size="sm" variant="ghost">
                              {title}
                              {header.column.getIsSorted() === "asc" ? " ↑" : header.column.getIsSorted() === "desc" ? " ↓" : ""}
                            </Button>
                          ) : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => {
                  const entry = row.original.entry;
                  return (
                    <TableRow
                      key={row.id}
                      tabIndex={0}
                      onClick={(event) => {
                        if (!(event.target instanceof HTMLElement) || event.target.closest("button,input,textarea,select,[role='combobox']")) return;
                        setSheetEntryId(entry.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          setSheetEntryId(entry.id);
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={cell.column.id === "amount" ? "text-right" : undefined}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 sm:hidden">
            {table.getRowModel().rows.map((row) => {
              const entry = row.original.entry;
              return (
                <article key={row.id} className="grid gap-3 rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <input aria-label={`Select ${entry.description || entry.kind}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} type="checkbox" />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSheetEntryId(entry.id)} type="button">
                      <span className="block truncate font-medium">{row.original.displayDescription}</span>
                      <span className="text-sm text-muted-foreground">{row.original.categoryName} · {row.original.payerName}</span>
                    </button>
                    <strong className="shrink-0 tabular-nums">{formatMoney(entry.amountCents)}</strong>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <InlineEdit label={`${entry.description || entry.kind} date`} type="date" value={entry.date} onSave={(date) => updateEntryInline(entry, { date })} />
                    <InlineEdit label={`${entry.description || entry.kind} description`} value={entry.description} onSave={(description) => updateEntryInline(entry, { description })} />
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Activity pages">
            <span>Showing {table.getRowModel().rows.length ? page * 50 + 1 : 0}–{Math.min((page + 1) * 50, tableData.length)} of {tableData.length}</span>
            <div className="flex items-center gap-3">
              <Button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} variant="outline">Previous</Button>
              <span>Page {page + 1} of {pageCount}</span>
              <Button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} variant="outline">Next</Button>
            </div>
          </div>
        </>
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) {
            setShowForm(false);
            setEditing(null);
            setSheetEntryId(null);
            setStaged(null);
          }
        }}
      >
        <SheetContent side={isNarrow ? "bottom" : "right"} className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{showForm && !editing ? "Add spend" : editing ? "Edit entry" : sheetEntry?.displayName || sheetEntry?.description || "Entry details"}</SheetTitle>
            <SheetDescription>{showForm ? "Record or update a spend." : "Review entry details and notes."}</SheetDescription>
          </SheetHeader>
          {showForm && (
            <SpendForm
              key={editing?.id ?? "new"}
              ledger={ledger}
              initialValues={editing ?? undefined}
              onSave={saveEntry}
              onAddCategory={addCategory}
              onAddEntity={addEntity}
              onCancel={() => { setEditing(null); setShowForm(false); }}
            />
          )}
          {!showForm && sheetEntry && (
            <div className="grid gap-5 py-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="block text-muted-foreground">Date</span><strong>{sheetEntry.date}</strong></div>
                <div><span className="block text-muted-foreground">Amount</span><strong className="tabular-nums">{formatMoney(sheetEntry.amountCents)}</strong></div>
                <div><span className="block text-muted-foreground">Category</span><strong>{ledger.categories?.find((category) => category.id === sheetEntry.categoryId)?.name ?? "Uncategorised"}</strong></div>
                <div><span className="block text-muted-foreground">Account</span><strong>{ledger.accounts.find((account) => account.id === sheetEntry.accountId)?.name ?? "No account"}</strong></div>
                <div><span className="block text-muted-foreground">Paid by</span><strong>{ledger.entities.find((entity) => entity.id === sheetEntry.payerEntityId)?.name ?? "Unknown"}</strong></div>
                <div><span className="block text-muted-foreground">Tags</span><strong>{sheetEntry.tags?.length ? sheetEntry.tags.join(", ") : "None"}</strong></div>
                <label className="flex items-center gap-2">
                  <input aria-label="Counts toward balances" checked={sheetEntry.countsTowardDebt} onChange={(event) => updateEntryInline(sheetEntry, { countsTowardDebt: event.target.checked })} type="checkbox" />
                  Counts toward balances
                </label>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="entry-note">Edit note</label>
                <Textarea
                  id="entry-note"
                  aria-label="Edit note"
                  defaultValue={sheetEntry.note ?? ""}
                  placeholder="Optional details"
                  onBlur={(event) => {
                    const note = event.currentTarget.value.trim();
                    if (note !== (sheetEntry.note ?? "")) updateEntryInline(sheetEntry, { note }, "Edit note");
                  }}
                />
              </div>
              {sheetEntry.portions.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="font-medium">Split</h3>
                  {sheetEntry.portions.map((portion) => (
                    <div className="flex justify-between gap-4 text-sm" key={portion.entityId}>
                      <span>{ledger.entities.find((entity) => entity.id === portion.entityId)?.name ?? "Unknown"}</span>
                      <span className="tabular-nums">{formatMoney(portion.amountCents)}</span>
                    </div>
                  ))}
                </section>
              )}
              {(ledger.bankRows ?? []).filter((row) => sheetEntry.bankRowIds?.includes(row.id)).length > 0 && (
                <section className="grid gap-2">
                  <h3 className="font-medium">Bank source</h3>
                  {(ledger.bankRows ?? []).filter((row) => sheetEntry.bankRowIds?.includes(row.id)).map((row) => (
                    <p className="text-sm text-muted-foreground" key={row.id}>{row.date} · {row.description} · {formatMoney(row.amountCents)}</p>
                  ))}
                </section>
              )}
              {sheetEntry.kind === "spend" && sheetEntry.payerEntityId === "self" && sheetEntry.portions.map((portion) => {
                const entity = ledger.entities.find((candidate) => candidate.id === portion.entityId);
                if (!entity?.splitwise || entity.kind === "self" || entity.kind === "house" || sheetEntry.splitwiseExpenseId) return null;
                const key = pairKey(sheetEntry.id, entity.id);
                const post = posts.find((candidate) => candidate.entryId === sheetEntry.id && candidate.entityId === entity.id);
                const isStaged = staged?.entryId === sheetEntry.id && staged.entityId === entity.id;
                const draftCostCents = isStaged && staged ? inputCents(staged.costInput) : null;
                const paidAmounts = isStaged && staged ? staged.draft.shares.map((share) => inputCents(staged.paidInputs[String(share.userId)] ?? "")) : [];
                const owedAmounts = isStaged && staged ? staged.draft.shares.map((share) => inputCents(staged.owedInputs[String(share.userId)] ?? "")) : [];
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
                  <section className="grid gap-3 rounded-lg border p-3" key={entity.id}>
                    <h3 className="font-medium">Splitwise · {entity.name}</h3>
                    {post?.state === "posting" && pendingKeys.includes(key) && <p role="status">Posting to Splitwise</p>}
                    {post?.state === "posted" && <p>Posted to Splitwise ({post.splitwiseExpenseId})</p>}
                    {(post?.state === "unknown" || post?.state === "posting" && !pendingKeys.includes(key)) && (
                      <div className="flex gap-2">
                        <Button onClick={() => markPosted(post, key)} variant="outline">Mark posted</Button>
                        <Button onClick={() => removePost(post.id)} variant="outline">Clear</Button>
                      </div>
                    )}
                    {!post && !isStaged && <Button disabled={pendingKeys.includes(key)} onClick={() => void preparePost(sheetEntry, entity, portion)} variant="outline">Post to Splitwise</Button>}
                    {isStaged && staged && (
                      <div className="grid gap-3">
                        <label className="grid gap-1 text-sm">Description<Input value={staged.draft.description} onChange={(event) => setStaged((current) => current ? { ...current, draft: { ...current.draft, description: event.target.value } } : current)} /></label>
                        <label className="grid gap-1 text-sm">Date<Input type="date" value={staged.draft.date} onChange={(event) => setStaged((current) => current ? { ...current, draft: { ...current.draft, date: event.target.value } } : current)} /></label>
                        <label className="grid gap-1 text-sm">Cost (AUD)<Input min="0" step="0.01" type="number" value={staged.costInput} onChange={(event) => setStaged((current) => current ? { ...current, costInput: event.target.value } : current)} /></label>
                        {staged.draft.groupId !== 0 && (
                          <fieldset className="grid gap-2">
                            <legend>Group members</legend>
                            {staged.groupMembers.map((member) => (
                              <label className="flex items-center gap-2" key={member.userId}>
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
                        <div className="grid gap-2">
                          {staged.draft.shares.map((share) => (
                            <div className="grid grid-cols-3 items-center gap-2" key={share.userId}>
                              <span>{share.name}</span>
                              <Input aria-label={`${share.name} paid share`} min="0" step="0.01" type="number" value={staged.paidInputs[String(share.userId)] ?? ""} onChange={(event) => setStaged((current) => current ? { ...current, paidInputs: { ...current.paidInputs, [String(share.userId)]: event.target.value } } : current)} />
                              <Input aria-label={`${share.name} owed share`} min="0" step="0.01" type="number" value={staged.owedInputs[String(share.userId)] ?? ""} onChange={(event) => setStaged((current) => current ? { ...current, owedInputs: { ...current.owedInputs, [String(share.userId)]: event.target.value } } : current)} />
                            </div>
                          ))}
                        </div>
                        {!sharesValid && <p role="status">Shares must add up to the cost.</p>}
                        <Button disabled={pendingKeys.includes(key) || !sharesValid} onClick={() => void submitPost()}>Post expense</Button>
                        <Button onClick={() => setStaged(null)} variant="outline">Cancel</Button>
                      </div>
                    )}
                    {notices[key] && <p role="status">{notices[key]}</p>}
                  </section>
                );
              })}
              <SheetFooter className="flex-row flex-wrap justify-between">
                {sheetEntry.kind === "spend" && <Button onClick={() => { setEditing(sheetEntry); setShowForm(true); }} variant="outline">Edit entry</Button>}
                <Button onClick={() => deleteEntry(sheetEntry)} variant="destructive">Delete entry</Button>
              </SheetFooter>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={markPostedTarget !== null} onOpenChange={(open) => { if (!open) setMarkPostedTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Splitwise expense ID</DialogTitle>
            <DialogDescription>Enter the expense ID already recorded in Splitwise.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Splitwise expense ID" inputMode="numeric" value={expenseIdInput} onChange={(event) => setExpenseIdInput(event.target.value)} />
          <DialogFooter>
            <Button onClick={() => setMarkPostedTarget(null)} variant="outline">Cancel</Button>
            <Button
              disabled={!/^\d+$/.test(expenseIdInput.trim())}
              onClick={() => {
                if (!markPostedTarget || !/^\d+$/.test(expenseIdInput.trim())) return;
                savePost({ ...markPostedTarget.post, state: "posted", splitwiseExpenseId: expenseIdInput.trim(), updatedAt: new Date().toISOString() });
                setNotices((current) => ({ ...current, [markPostedTarget.key]: "" }));
                setMarkPostedTarget(null);
              }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmation?.action()}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}