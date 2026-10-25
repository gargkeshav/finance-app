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
  const entries = [...ledger.entries].sort((first, second) => second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt));

  function saveEntry(entry: Entry) {
    const exists = ledger.entries.some((item) => item.id === entry.id);
    update({
      ...ledger,
      entries: exists
        ? ledger.entries.map((item) => item.id === entry.id ? entry : item)
        : [...ledger.entries, entry],
    });
    setEditing(null);
    setShowForm(false);
  }

  function deleteEntry(entry: Entry) {
    if (!window.confirm(`Delete “${entry.description || "this entry"}”? This cannot be undone.`)) return;
    update({ ...ledger, entries: ledger.entries.filter((item) => item.id !== entry.id) });
    if (editing?.id === entry.id) setEditing(null);
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
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Payer</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {entries.map((entry) => {
              const payer = ledger.entities.find((entity) => entity.id === entry.payerEntityId);
              return (
                <tr key={entry.id}>
                  <td className="date-cell">{entry.date}</td>
                  <td>{entry.description || (entry.kind === "spend" ? "Spend" : entry.kind)}</td>
                  <td>{payer?.name ?? "Unknown"}</td>
                  <td className="amount">{formatAud(entry.amountCents)}</td>
                  <td>
                    {entry.kind === "spend" && <button className="secondary" onClick={() => { setEditing(entry); setShowForm(false); }} type="button">Edit</button>}{" "}
                    <button className="secondary" onClick={() => deleteEntry(entry)} type="button">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {entries.length === 0 && <p className="empty-state compact">No activity yet.</p>}
      </div>
    </>
  );
}