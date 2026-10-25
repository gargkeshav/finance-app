import { useEffect, useRef, useState } from "react";
import { categoryMemoryAfterSpend, categoryMemoryKey, HOUSE_ENTITY_ID, SELF_ENTITY_ID, type BankRow, type Category, type Entry, type Ledger } from "../../domain/ledger";
import { cardCycle, confirmTransfer, suggestTransfers, type PossibleTransfer, type TransferChoice } from "../../domain/transfers";
import { formatAud } from "../../domain/value";
import { SpendForm } from "./SpendForm";
import { createSplitwiseSpend, type SplitwiseInboxItem } from "../../adapters/splitwise";

interface ReviewViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  onSettle: (row: BankRow) => void;
}

export function ReviewView({ ledger, update, onSettle }: ReviewViewProps) {
  const [spendingRowId, setSpendingRowId] = useState<string | null>(null);
  const [refundRowId, setRefundRowId] = useState<string | null>(null);
  const [refundOfId, setRefundOfId] = useState("");
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
  const memoryFor = (row: BankRow) => ledger.categoryMemory?.find((memory) => memory.key === categoryMemoryKey(row.accountId, row.description));
  const suggestedSpends = pendingRows.filter((row) => {
    const memory = memoryFor(row);
    return row.amountCents < 0 && Boolean(memory?.entityId && memory.categoryId && ledger.entities.some((entity) => entity.id === memory.entityId));
  });
  const spendingRow = pendingRows.find((row) => row.id === spendingRowId);
  const refundRow = pendingRows.find((row) => row.id === refundRowId);
  const suggestions = suggestTransfers(ledger);
  const suggestionByRow = new Map<string, PossibleTransfer>();
  for (const suggestion of suggestions) {
    suggestionByRow.set(suggestion.outgoing.id, suggestion);
    suggestionByRow.set(suggestion.incoming.id, suggestion);
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
    });
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
      categoryMemory: categoryMemoryAfterSpend(ledger, entry, now),
      bankRows: bankRows.map((item) => item.id === row.id
        ? { ...item, entryId: entry.id, updatedAt: now }
        : item),
    });
    setSpendingRowId(null);
    setRefundRowId(null);
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
    setRefundRowId(null);
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

  const splitwiseItems = (ledger.splitwiseInbox ?? []).filter((item) =>
    !item.isPayment && ["new", "changed", "deleted"].includes(item.status),
  );

  function matchingSplitwiseEntry(item: SplitwiseInboxItem) {
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
      ? `Deleted in Splitwise. Was ${item.previous.date}, ${item.previous.description}, ${formatAud(item.previous.costCents)}.`
      : "Deleted in Splitwise.";
    if (item.status !== "changed" || !item.previous) return item.status;
    const changes: string[] = [];
    if (item.previous.date !== item.date) changes.push(`date ${item.previous.date} to ${item.date}`);
    if (item.previous.description !== item.description) changes.push(`description ${JSON.stringify(item.previous.description)} to ${JSON.stringify(item.description)}`);
    if (item.previous.costCents !== item.costCents) changes.push(`cost ${formatAud(item.previous.costCents)} to ${formatAud(item.costCents)}`);
    if (item.previous.yourPaidCents !== item.yourPaidCents) changes.push(`your paid share ${formatAud(item.previous.yourPaidCents)} to ${formatAud(item.yourPaidCents)}`);
    if (item.previous.yourOwedCents !== item.yourOwedCents) changes.push(`your owed share ${formatAud(item.previous.yourOwedCents)} to ${formatAud(item.yourOwedCents)}`);
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
    });
  }

  function dismissSplitwise(item: SplitwiseInboxItem) {
    update({
      ...ledger,
      splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "dismissed" }
        : candidate),
    });
  }

  function createFromSplitwise(item: SplitwiseInboxItem) {
    update(createSplitwiseSpend(ledger, item));
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
        {suggestedSpends.length > 0 && <button className="primary" onClick={acceptSuggestedSpends} type="button">Accept {suggestedSpends.length} suggested</button>}
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
              bankRowIds: [spendingRow.id],
              categoryId: memoryFor(spendingRow)?.categoryId ?? null,
              payerEntityId: ledger.accounts.find((item) => item.id === spendingRow.accountId)?.payerEntityId ?? SELF_ENTITY_ID,
              portions: [{
                entityId: memoryFor(spendingRow)?.entityId ?? ledger.accounts.find((item) => item.id === spendingRow.accountId)?.payerEntityId ?? SELF_ENTITY_ID,
                amountCents: Math.abs(spendingRow.amountCents),
              }],
            }}
            ledger={ledger}
            onAddCategory={(category: Category) => update({ ...ledger, categories: [...(ledger.categories ?? []), category] })}
            onCancel={() => setSpendingRowId(null)}
            onSave={(entry) => saveSpend(spendingRow, entry)}
          />
        </section>
      )}
      {refundRow && (() => {
        const candidates = refundCandidates(refundRow);
        const original = candidates.find((entry) => entry.id === refundOfId);
        const payerEntityId = ledger.accounts.find((item) => item.id === refundRow.accountId)?.payerEntityId ?? SELF_ENTITY_ID;
        return (
          <section className="form-grid" aria-label="Review refund">
            <h2>Review refund</h2>
            <label>
              Original spend
              <select value={refundOfId} onChange={(event) => setRefundOfId(event.target.value)}>
                <option value="">Choose a spend</option>
                {candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.date} | {entry.description} | {formatAud(entry.amountCents)}</option>)}
              </select>
            </label>
            {original ? (
              <SpendForm
                key={`${refundRow.id}-${original.id}`}
                initialValues={{
                  kind: "refund",
                  refundOf: original.id,
                  date: refundRow.date,
                  description: refundRow.description,
                  amountCents: Math.abs(refundRow.amountCents),
                  accountId: refundRow.accountId,
                  bankRowIds: [refundRow.id],
                  payerEntityId,
                  portions: scaledPortions(original, Math.abs(refundRow.amountCents)),
                }}
                ledger={ledger}
                onAddCategory={(category: Category) => update({ ...ledger, categories: [...(ledger.categories ?? []), category] })}
                onCancel={() => setRefundRowId(null)}
                onSave={(entry) => saveRefund(refundRow, entry)}
              />
            ) : candidates.length === 0 ? <p className="banner">No spends are available to refund.</p> : null}
          </section>
        );
      })()}
      {transferMessage && <p className="banner error" role="status">{transferMessage}</p>}
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
                      <td className="amount">{formatAud(item.costCents)}</td>
                      <td>{item.status === "changed" || item.status === "deleted" ? splitwiseChangeText(item) : item.status}</td>
                      <td>
                        {item.status === "changed" || item.status === "deleted" ? (
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
                        onClick={() => { setRefundRowId(null); setSpendingRowId(row.id); }}
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
                    {row.amountCents > 0 && <button className="secondary" onClick={() => {
                      setSpendingRowId(null);
                      setRefundRowId(row.id);
                      setRefundOfId(refundCandidates(row)[0]?.id ?? "");
                    }} type="button">Refund</button>}{" "}
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