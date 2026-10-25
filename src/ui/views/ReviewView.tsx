import { useEffect, useRef, useState } from "react";
import { HOUSE_ENTITY_ID, SELF_ENTITY_ID, type BankRow, type Entry, type Ledger } from "../../domain/ledger";
import { cardCycle, confirmTransfer, suggestTransfers, type PossibleTransfer, type TransferChoice } from "../../domain/transfers";
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
  const [transferPickerRowId, setTransferPickerRowId] = useState<string | null>(null);
  const [transferPartnerId, setTransferPartnerId] = useState("");
  const [confirmingTransfer, setConfirmingTransfer] = useState<{ outgoingId: string; incomingId: string } | null>(null);
  const [transferMessage, setTransferMessage] = useState("");
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bankRows = ledger.bankRows ?? [];
  const imports = ledger.imports ?? [];
  const pendingRows = bankRows
    .filter((row) => !row.entryId && !row.settlementId && !row.skipped)
    .sort((first, second) => second.date.localeCompare(first.date) || second.line - first.line);
  const spendingRow = pendingRows.find((row) => row.id === spendingRowId);
  const suggestions = suggestTransfers(ledger);
  const suggestionByRow = new Map<string, PossibleTransfer>();
  for (const suggestion of suggestions) {
    suggestionByRow.set(suggestion.outgoing.id, suggestion);
    suggestionByRow.set(suggestion.incoming.id, suggestion);
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

  function confirmPair(outgoing: BankRow, incoming: BankRow, choice?: TransferChoice) {
    const next = confirmTransfer(ledger, outgoing, incoming, choice);
    if (!next) {
      setTransferMessage("This payer combination is unsupported. Both rows remain in review.");
      setConfirmingTransfer(null);
      return;
    }
    update(next);
    setConfirmingTransfer(null);
    setTransferPickerRowId(null);
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
    });
  }

  function pendingPair(first: BankRow, second: BankRow) {
    return first.amountCents < 0 ? { outgoing: first, incoming: second } : { outgoing: second, incoming: first };
  }

  function choiceActions(outgoing: BankRow, incoming: BankRow) {
    if (confirmingTransfer?.outgoingId !== outgoing.id || confirmingTransfer.incomingId !== incoming.id) return null;
    return (
      <>
        <button className="secondary" onClick={() => confirmPair(outgoing, incoming, "contribution")} type="button">Contribution</button>{" "}
        <button className="secondary" onClick={() => confirmPair(outgoing, incoming, "settlement")} type="button">Settlement</button>
      </>
    );
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
      {transferMessage && <p className="banner error" role="status">{transferMessage}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {pendingRows.map((row) => {
              const account = ledger.accounts.find((item) => item.id === row.accountId);
              const suggestion = suggestionByRow.get(row.id);
              const otherRow = suggestion && (suggestion.outgoing.id === row.id ? suggestion.incoming : suggestion.outgoing);
              const otherAccount = otherRow && ledger.accounts.find((item) => item.id === otherRow.accountId);
              const paymentCycle = row.amountCents > 0 && account?.type === "credit" ? cardCycle(ledger, row) : null;
              const selectableRows = transferPickerRowId === row.id
                ? pendingRows.filter((item) => item.id !== row.id && item.accountId !== row.accountId && Math.sign(item.amountCents) !== Math.sign(row.amountCents))
                : [];
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
                    {suggestion && otherRow && otherAccount ? (
                      <div className="form-grid" aria-label="Possible transfer">
                        <p>Possible transfer with {otherAccount.name} ({otherRow.date}).</p>
                        <button className="secondary" onClick={() => requestConfirm(suggestion.outgoing, suggestion.incoming)} type="button">Confirm</button>{" "}
                        {choiceActions(suggestion.outgoing, suggestion.incoming)}
                        <button className="secondary" onClick={() => dismissPair(row, otherRow)} type="button">Dismiss</button>
                      </div>
                    ) : !suggestion && row.amountCents !== 0 ? (
                      <div className="form-grid">
                        <button className="secondary" onClick={() => {
                          setTransferPickerRowId(transferPickerRowId === row.id ? null : row.id);
                          setTransferPartnerId("");
                        }} type="button">Transfer</button>
                        {transferPickerRowId === row.id && (
                          <>
                            <label>
                              Other bank row
                              <select value={transferPartnerId} onChange={(event) => setTransferPartnerId(event.target.value)}>
                                <option value="">Choose a row</option>
                                {selectableRows.map((item) => {
                                  const itemAccount = ledger.accounts.find((candidate) => candidate.id === item.accountId);
                                  return <option key={item.id} value={item.id}>{item.date} | {item.description} | {itemAccount?.name ?? "Unknown"} | {formatAud(item.amountCents)}</option>;
                                })}
                              </select>
                            </label>
                            {transferPartnerId && (() => {
                              const partner = pendingRows.find((item) => item.id === transferPartnerId);
                              if (!partner) return null;
                              const pair = pendingPair(row, partner);
                              return (
                                <>
                                  <button className="secondary" onClick={() => requestConfirm(pair.outgoing, pair.incoming)} type="button">Confirm</button>{" "}
                                  {choiceActions(pair.outgoing, pair.incoming)}
                                </>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    ) : null}
                    {paymentCycle && (
                      <p>
                        Card cycle: {formatAud(paymentCycle.sumCents)}. Difference: {formatAud(paymentCycle.differenceCents)}; a difference may be interest, a fee, or a missing row.
                      </p>
                    )}{" "}
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