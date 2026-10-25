import { useRef, useState } from "react";
import { formatAud, parseAud } from "../../domain/value";
import { categoryMemoryAfterSpend, type Category, type Entry, type Ledger } from "../../domain/ledger";
import {
  buildExpense,
  getCurrentUser,
  getGroups,
  hasKey,
  postExpense,
  SplitwiseNoResponseError,
  type SplitwiseExpenseDraft,
} from "../../adapters/splitwise";
import { SpendForm } from "./SpendForm";

interface ActivityViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
}

export function ActivityView({ ledger, update }: ActivityViewProps) {
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "excluded">("all");
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [staged, setStaged] = useState<{
    entryId: string;
    entityId: string;
    draft: SplitwiseExpenseDraft;
    owedInputs: Record<string, string>;
  } | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const currentLedger = useRef(ledger);
  currentLedger.current = ledger;
  const posts = ledger.splitwisePosts ?? [];
  const entries = [...ledger.entries].sort((first, second) => second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt));
  const visibleEntries = entries.filter((entry) => filter === "all" || !entry.countsTowardDebt);

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
      const owedInputs = Object.fromEntries(draft.shares
        .filter((share) => share.userId !== you.id)
        .map((share) => [String(share.userId), `${Math.floor(share.owedCents / 100)}.${String(share.owedCents % 100).padStart(2, "0")}`]));
      setStaged({ entryId: entry.id, entityId: entity.id, draft, owedInputs });
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

    let draft: SplitwiseExpenseDraft;
    try {
      draft = {
        ...staged.draft,
        shares: staged.draft.shares.map((share) => ({
          ...share,
          owedCents: staged.owedInputs[String(share.userId)] === undefined
            ? share.owedCents
            : parseAud(staged.owedInputs[String(share.userId)]),
        })),
      };
    } catch {
      setNotices((current) => ({ ...current, [key]: "Enter valid member shares in AUD." }));
      return;
    }

    const posting = {
      id: crypto.randomUUID(),
      entryId: staged.entryId,
      entityId: staged.entityId,
      state: "posting" as const,
      splitwiseExpenseId: null,
      updatedAt: new Date().toISOString(),
    };
    savePost(posting);
    setPendingKeys((current) => [...current, key]);
    setStaged(null);
    try {
      const expenseId = await postExpense(draft);
      savePost({ ...posting, state: "posted", splitwiseExpenseId: String(expenseId), updatedAt: new Date().toISOString() });
      setNotices((current) => ({ ...current, [key]: "" }));
    } catch (error) {
      if (error instanceof SplitwiseNoResponseError) {
        savePost({ ...posting, state: "unknown", updatedAt: new Date().toISOString() });
        setNotices((current) => ({ ...current, [key]: "Check Splitwise before retrying" }));
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
    if (!selectedEntryIds.length) return;
    const selected = new Set(selectedEntryIds);
    const now = new Date().toISOString();
    update({
      ...ledger,
      entries: ledger.entries.map((entry) => selected.has(entry.id)
        ? { ...entry, countsTowardDebt, updatedAt: now }
        : entry),
    });
    setSelectedEntryIds([]);
  }

  return (
    <>
      <header className="page-heading">
        <h1>Activity</h1>
        <button className="primary" onClick={() => { setEditing(null); setShowForm((visible) => !visible); }} type="button">New spend</button>
      </header>
      {(showForm || editing) && (
        <SpendForm
          key={editing?.id ?? "new"}
          ledger={ledger}
          initialValues={editing ?? undefined}
          onSave={saveEntry}
          onAddCategory={addCategory}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}
      <div className="filters">
        <label>
          Filter
          <select value={filter} onChange={(event) => setFilter(event.target.value as "all" | "excluded")}>
            <option value="all">All activity</option>
            <option value="excluded">Not counted toward balances</option>
          </select>
        </label>
        <button className="secondary" disabled={!selectedEntryIds.length} onClick={() => updateSelectedEntries(true)} type="button">Include selected</button>
        <button className="secondary" disabled={!selectedEntryIds.length} onClick={() => updateSelectedEntries(false)} type="button">Exclude selected</button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th><span className="sr-only">Select</span></th><th>Date</th><th>Description</th><th>Payer</th><th>Amount</th><th>Balances</th><th /></tr></thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const payer = ledger.entities.find((entity) => entity.id === entry.payerEntityId);
              const bankRows = (ledger.bankRows ?? []).filter((row) => entry.bankRowIds?.includes(row.id));
              return (
                <tr key={entry.id}>
                  <td><input aria-label={`Select ${entry.description || entry.kind}`} type="checkbox" checked={selectedEntryIds.includes(entry.id)} onChange={(event) => setSelectedEntryIds((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} /></td>
                  <td className="date-cell">{entry.date}</td>
                  <td>
                    <div>{entry.description || (entry.kind === "spend" ? "Spend" : entry.kind)}{entry.kind === "refund" && <> <strong>Refund</strong></>}</div>
                    {bankRows.map((row) => (
                      <div key={row.id}>
                        {row.date} · {row.description} · <span className="amount">{formatAud(row.amountCents)}</span>
                      </div>
                    ))}
                    {entry.kind === "spend" && entry.payerEntityId === "self" && entry.portions.map((portion) => {
                      const entity = ledger.entities.find((candidate) => candidate.id === portion.entityId);
                      if (!entity?.splitwise || entity.kind === "self" || entity.kind === "house") return null;
                      const key = pairKey(entry.id, entity.id);
                      const post = posts.find((candidate) => candidate.entryId === entry.id && candidate.entityId === entity.id);
                      const isStaged = staged?.entryId === entry.id && staged.entityId === entity.id;
                      return (
                        <div key={entity.id}>
                          {post?.state === "posting" && <span>Posting to Splitwise</span>}
                          {post?.state === "posted" && <span>Posted to Splitwise ({post.splitwiseExpenseId})</span>}
                          {post?.state === "unknown" && (
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
                            <div>
                              <div>Cost {formatAud(staged.draft.costCents)}</div>
                              {staged.draft.groupId !== 0 && staged.draft.shares.map((share) => (
                                <label key={share.userId}>
                                  {share.name} owes{" "}
                                  {share.userId === staged.draft.shares[0].userId
                                    ? formatAud(share.owedCents)
                                    : <input
                                        aria-label={`${share.name} owed share`}
                                        min="0"
                                        step="0.01"
                                        type="number"
                                        value={staged.owedInputs[String(share.userId)] ?? "0.00"}
                                        onChange={(event) => setStaged((current) => current ? {
                                          ...current,
                                          owedInputs: { ...current.owedInputs, [String(share.userId)]: event.target.value },
                                        } : current)}
                                      />}
                                </label>
                              ))}
                              <button className="primary" disabled={pendingKeys.includes(key)} onClick={() => void submitPost()} type="button">Post expense</button>{" "}
                              <button className="secondary" onClick={() => setStaged(null)} type="button">Cancel</button>
                            </div>
                          )}
                          {notices[key] && <div role="status">{notices[key]}</div>}
                        </div>
                      );
                    })}
                  </td>
                  <td>{payer?.name ?? "Unknown"}</td>
                  <td className="amount">{formatAud(entry.amountCents)}</td>
                  <td>{entry.countsTowardDebt ? "Included" : "Excluded"}</td>
                  <td>
                    {entry.kind === "spend" && <button className="secondary" onClick={() => { setEditing(entry); setShowForm(false); }} type="button">Edit</button>}{" "}
                    <button className="secondary" onClick={() => deleteEntry(entry)} type="button">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleEntries.length === 0 && <p className="empty-state compact">{filter === "excluded" ? "No excluded activity." : "No activity yet."}</p>}
      </div>
    </>
  );
}