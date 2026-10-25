import { useEffect, useRef, useState } from "react";
import { SELF_ENTITY_ID, type BankRow, type Entry, type Ledger } from "../../domain/ledger";
import { formatAud } from "../../domain/value";
import { SpendForm } from "./SpendForm";

interface ReviewViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  onSettle: (row: BankRow) => void;
}

export function ReviewView({ ledger, update, onSettle }: ReviewViewProps) {
  const [spendingRowId, setSpendingRowId] = useState<string | null>(null);
  const [focusNextId, setFocusNextId] = useState<string | null>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bankRows = ledger.bankRows ?? [];
  const imports = ledger.imports ?? [];
  const pendingRows = bankRows
    .filter((row) => !row.entryId && !row.settlementId && !row.skipped)
    .sort((first, second) => second.date.localeCompare(first.date) || second.line - first.line);
  const spendingRow = pendingRows.find((row) => row.id === spendingRowId);

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

  function saveSpend(row: BankRow, draft: Entry) {
    const now = new Date().toISOString();
    const entry: Entry = {
      ...draft,
      id: crypto.randomUUID(),
      bankRowIds: [row.id],
      countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
      updatedAt: now,
    };
    update({
      ...ledger,
      entries: [...ledger.entries, entry],
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, entryId: entry.id, updatedAt: now }
        : item),
    });
    setSpendingRowId(null);
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
      countsTowardDebt: importFor(row)?.countsTowardDebt ?? true,
      updatedAt: now,
    };
    update({
      ...ledger,
      entries: [...ledger.entries, entry],
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, entryId: entry.id, updatedAt: now }
        : item),
    });
    focusFollowingRow(row);
  }

  function skipRow(row: BankRow) {
    const now = new Date().toISOString();
    update({
      ...ledger,
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, skipped: true, updatedAt: now }
        : item),
    });
    setSpendingRowId(null);
    focusFollowingRow(row);
  }

  return (
    <>
      <header className="page-heading">
        <h1 ref={headingRef} tabIndex={-1}>Review</h1>
      </header>
      {spendingRow && (
        <section className="form-grid" aria-label="Review spend">
          <h2>Review spend</h2>
          <SpendForm
            key={spendingRow.id}
            initialValues={{
              date: spendingRow.date,
              description: spendingRow.description,
              amountCents: Math.abs(spendingRow.amountCents),
              accountId: spendingRow.accountId,
              payerEntityId: ledger.accounts.find((item) => item.id === spendingRow.accountId)?.payerEntityId ?? SELF_ENTITY_ID,
              portions: [{
                entityId: ledger.accounts.find((item) => item.id === spendingRow.accountId)?.payerEntityId ?? SELF_ENTITY_ID,
                amountCents: Math.abs(spendingRow.amountCents),
              }],
            }}
            ledger={ledger}
            onCancel={() => setSpendingRowId(null)}
            onSave={(entry) => saveSpend(spendingRow, entry)}
          />
        </section>
      )}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {pendingRows.map((row) => {
              const account = ledger.accounts.find((item) => item.id === row.accountId);
              return (
                <tr key={row.id}>
                  <td className="date-cell">{row.date}</td>
                  <td>{row.description || "Bank transaction"}</td>
                  <td>{account?.name ?? "Unknown"}</td>
                  <td className="amount">{formatAud(row.amountCents)}</td>
                  <td>
                    {row.amountCents < 0 ? (
                      <button
                        ref={(button) => {
                          if (button) actionRefs.current.set(row.id, button);
                          else actionRefs.current.delete(row.id);
                        }}
                        className="primary"
                        onClick={() => setSpendingRowId(row.id)}
                        type="button"
                      >Spend</button>
                    ) : row.amountCents > 0 ? (
                      <button
                        ref={(button) => {
                          if (button) actionRefs.current.set(row.id, button);
                          else actionRefs.current.delete(row.id);
                        }}
                        className="primary"
                        onClick={() => classifyIncome(row)}
                        type="button"
                      >Income</button>
                    ) : null}{" "}
                    <button className="secondary" onClick={() => onSettle(row)} type="button">Settlement</button>{" "}
                    <button
                      ref={row.amountCents === 0 ? (button) => {
                        if (button) actionRefs.current.set(row.id, button);
                        else actionRefs.current.delete(row.id);
                      } : undefined}
                      className="secondary"
                      onClick={() => skipRow(row)}
                      type="button"
                    >Skip</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!pendingRows.length && <p className="empty-state compact">No bank rows need review.</p>}
      </div>
    </>
  );
}