import { useState } from "react";
import { formatAud } from "../../domain/value";
import type { Entry, Ledger } from "../../domain/ledger";
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
  const entries = [...ledger.entries].sort((first, second) => second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt));
  const visibleEntries = entries.filter((entry) => filter === "all" || !entry.countsTowardDebt);

  function saveEntry(entry: Entry) {
    const exists = ledger.entries.some((item) => item.id === entry.id);
    update({
      ...ledger,
      entries: exists
        ? ledger.entries.map((item) => item.id === entry.id
          ? {
              ...entry,
              bankRowIds: entry.bankRowIds ?? item.bankRowIds,
              countsTowardDebt: item.countsTowardDebt,
            }
          : item)
        : [...ledger.entries, entry],
    });
    setEditing(null);
    setShowForm(false);
  }

  function deleteEntry(entry: Entry) {
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
                    <div>{entry.description || (entry.kind === "spend" ? "Spend" : entry.kind)}</div>
                    {bankRows.map((row) => (
                      <div key={row.id}>
                        {row.date} · {row.description} · <span className="amount">{formatAud(row.amountCents)}</span>
                      </div>
                    ))}
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