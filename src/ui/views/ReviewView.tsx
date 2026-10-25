import { Fragment, useEffect, useRef, useState } from "react";
import { categoryMemoryAfterSpend, categoryMemoryKey, HOUSE_ENTITY_ID, SELF_ENTITY_ID, type BankRow, type Category, type Entry, type Ledger } from "../../domain/ledger";
import { cardCycle, confirmTransfer, suggestTransfers, type PossibleTransfer, type TransferChoice } from "../../domain/transfers";
import { formatMoney } from "../../domain/value";
import { SpendForm } from "./SpendForm";
import { createSplitwiseSpend, type SplitwiseInboxItem } from "../../adapters/splitwise";

interface ReviewViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  onSettle: (row: BankRow) => void;
}

export function ReviewView({ ledger, update, onSettle }: ReviewViewProps) {
  const [openDetail, setOpenDetail] = useState<{ rowId: string; kind: "spend" | "refund" | "transfer" | "suggestion" } | null>(null);
  const [refundOfId, setRefundOfId] = useState("");
  const [focusNextId, setFocusNextId] = useState<string | null>(null);
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
  const spendingRow = openDetail?.kind === "spend" ? pendingRows.find((row) => row.id === openDetail.rowId) : undefined;
  const refundRow = openDetail?.kind === "refund" ? pendingRows.find((row) => row.id === openDetail.rowId) : undefined;
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
    setOpenDetail(null);
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
        {suggestedSpends.length > 0 && <button className="primary" onClick={acceptSuggestedSpends} type="button">Accept {suggestedSpends.length} suggested</button>}
      </header>
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
                      <td className="amount">{formatMoney(item.costCents)}</td>
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
              const detailIsOpen = openDetail?.rowId === row.id;
              const selectableRows = detailIsOpen && openDetail.kind === "transfer"
                ? pendingRows.filter((item) => item.id !== row.id && item.accountId !== row.accountId && Math.sign(item.amountCents) !== Math.sign(row.amountCents))
                : [];
              return (
                <Fragment key={row.id}>
                  <tr key={row.id}>
                    <td className="date-cell">{row.date}</td>
                    <td>{row.description || "Bank transaction"}</td>
                    <td>{account?.name ?? "Unknown"}</td>
                    <td className="amount">{formatMoney(row.amountCents)}</td>
                    <td>
                      {row.amountCents < 0 ? <button ref={(button) => {
                        if (button) actionRefs.current.set(row.id, button);
                        else actionRefs.current.delete(row.id);
                      }} className="primary" onClick={() => setOpenDetail({ rowId: row.id, kind: "spend" })} type="button">Spend</button> : row.amountCents > 0 ? <button ref={(button) => {
                        if (button) actionRefs.current.set(row.id, button);
                        else actionRefs.current.delete(row.id);
                      }} className="primary" onClick={() => classifyIncome(row)} type="button">Income</button> : null}{" "}
                      <button ref={row.amountCents === 0 ? (button) => {
                        if (button) actionRefs.current.set(row.id, button);
                        else actionRefs.current.delete(row.id);
                      } : undefined} className="secondary" onClick={() => skipRow(row)} type="button">Skip</button>{" "}
                      <details className="more-menu">
                        <summary className="secondary">More</summary>
                        <div>
                          <button className="secondary" onClick={(event) => {
                            closeMoreMenu(event);
                            setTransferPartnerId("");
                            setOpenDetail({ rowId: row.id, kind: suggestion && otherRow ? "suggestion" : "transfer" });
                          }} type="button">Transfer</button>
                          {row.amountCents > 0 && <button className="secondary" onClick={(event) => {
                            closeMoreMenu(event);
                            setRefundOfId(refundCandidates(row)[0]?.id ?? "");
                            setOpenDetail({ rowId: row.id, kind: "refund" });
                          }} type="button">Refund</button>}
                          <button className="secondary" onClick={(event) => { closeMoreMenu(event); onSettle(row); }} type="button">Settlement</button>
                        </div>
                      </details>
                    </td>
                  </tr>
                  {(detailIsOpen || paymentCycle) && (
                    <tr className="row-detail" key={`${row.id}-detail`}>
                      <td colSpan={5}>
                        {detailIsOpen && openDetail.kind === "spend" && spendingRow?.id === row.id && (
                          <section className="form-grid" aria-label="Review spend">
                            <h2>Review spend</h2>
                            <SpendForm key={row.id} initialValues={{
                              date: row.date,
                              description: row.description,
                              amountCents: Math.abs(row.amountCents),
                              accountId: row.accountId,
                              bankRowIds: [row.id],
                              categoryId: memoryFor(row)?.categoryId ?? null,
                              payerEntityId: account?.payerEntityId ?? SELF_ENTITY_ID,
                              portions: [{ entityId: memoryFor(row)?.entityId ?? account?.payerEntityId ?? SELF_ENTITY_ID, amountCents: Math.abs(row.amountCents) }],
                            }} ledger={ledger}
                              onAddCategory={(category: Category) => update({ ...ledger, categories: [...(ledger.categories ?? []), category] })}
                              onCancel={() => setOpenDetail(null)} onSave={(entry) => saveSpend(row, entry)} />
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