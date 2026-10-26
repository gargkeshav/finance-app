import { useState } from "react";
import { accountCoverage, checkpointDifferences, HOUSE_ENTITY_ID, type Account, type BalanceCheckpoint, type Ledger } from "../../domain/ledger";
import { formatMoney, isBankDate, parseAud } from "../../domain/value";
import { cardPaymentCheck } from "../../domain/transfers";
import type { EntryFilter } from "../../domain/query";

interface AccountsViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  openActivity: (filter: EntryFilter) => void;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function AccountsView({ ledger, update, openActivity }: AccountsViewProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("asset");
  const [payerEntityId, setPayerEntityId] = useState("self");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [checkpointAccountId, setCheckpointAccountId] = useState<string | null>(null);
  const [checkpointDate, setCheckpointDate] = useState("");
  const [checkpointBalance, setCheckpointBalance] = useState("");
  const [checkpointNote, setCheckpointNote] = useState("");
  const [error, setError] = useState("");

  function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter an account name.");
      return;
    }

    if (editingId) {
      update({
        ...ledger,
        accounts: ledger.accounts.map((account) =>
          account.id === editingId ? { ...account, name: trimmedName } : account,
        ),
      });
    } else {
      const account: Account = {
        id: crypto.randomUUID(),
        name: trimmedName,
        type,
        payerEntityId,
        updatedAt: new Date().toISOString(),
      };
      update({ ...ledger, accounts: [...ledger.accounts, account] });
    }
    setName("");
    setEditingId(null);
    setError("");
  }

  function editAccount(account: Account) {
    setEditingId(account.id);
    setName(account.name);
    setType(account.type);
    setPayerEntityId(account.payerEntityId);
    setError("");
  }

  function saveCheckpoint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let balanceCents: number;
    try {
      balanceCents = parseAud(checkpointBalance);
    } catch {
      setError("Enter a valid checkpoint balance.");
      return;
    }
    if (!checkpointAccountId || !isBankDate(checkpointDate)) {
      setError("Enter a valid checkpoint date.");
      return;
    }
    const checkpoint: BalanceCheckpoint = {
      id: crypto.randomUUID(),
      accountId: checkpointAccountId,
      date: checkpointDate,
      balanceCents,
      note: checkpointNote.trim(),
      updatedAt: new Date().toISOString(),
    };
    update({ ...ledger, checkpoints: [...(ledger.checkpoints ?? []), checkpoint] });
    setCheckpointAccountId(null);
    setCheckpointDate("");
    setCheckpointBalance("");
    setCheckpointNote("");
    setError("");
  }

  return (
    <>
      <header className="page-heading">
        <h1>Accounts</h1>
        <button
          className="primary"
          onClick={() => {
            setEditingId(null);
            setName("");
            setError("");
          }}
          type="button"
        >
          Add account
        </button>
      </header>

      <form className="form-grid" onSubmit={saveAccount}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        {!editingId && (
          <>
            <label>
              Type
              <select value={type} onChange={(event) => setType(event.target.value as Account["type"])}>
                <option value="asset">Asset</option>
                <option value="credit">Credit</option>
              </select>
            </label>
            <label>
              Paid by
              <select value={payerEntityId} onChange={(event) => setPayerEntityId(event.target.value)}>
                {ledger.entities
                  .filter((entity) => !entity.archived)
                  .map((entity) => (
                    <option key={entity.id} value={entity.id}>{entity.name}</option>
                  ))}
              </select>
            </label>
          </>
        )}
        <div className="dialog-actions">
          <button className="primary" type="submit">{editingId ? "Save name" : "Save account"}</button>
          {editingId && <button className="secondary" onClick={() => setEditingId(null)} type="button">Cancel</button>}
        </div>
        {error && <p className="banner error" role="alert">{error}</p>}
      </form>

      <div className="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Paid by</th><th>Coverage</th><th>Balance checkpoints</th><th /></tr></thead>
          <tbody>
            {ledger.accounts.map((account) => {
              const payer = ledger.entities.find((entity) => entity.id === account.payerEntityId);
              const coverage = accountCoverage(ledger, account.id);
              const differences = checkpointDifferences(ledger, account.id);
              const paymentCheck = account.type === "credit" ? cardPaymentCheck(ledger, account.id) : null;
              return (
                <tr key={account.id}>
                  <td>
                    <button className="transaction-link" onClick={() => openActivity({ accountId: account.id })} type="button">{account.name}</button>
                    {paymentCheck && (
                      <details>
                        <summary>Payments check</summary>
                        <p>Estimated amount owed now: <span className="amount">{formatMoney(paymentCheck.owedNowCents)}</span></p>
                        <p>A sudden jump means a row may be missing or doubled near that date.</p>
                        <div className="table-scroll">
                          <table>
                            <thead><tr><th>Date</th><th>Payment</th><th>Charges since previous payment</th><th>Estimated owed after</th><th>Paid from</th></tr></thead>
                            <tbody>
                              {paymentCheck.rows.map((row, index) => {
                                const previousPaymentDate = paymentCheck.rows[index - 1]?.payment.date;
                                return (
                                  <tr key={row.payment.id}>
                                    <td>{row.payment.date}</td>
                                    <td><button className="transaction-link amount" onClick={() => openActivity({ accountId: account.id, kind: "transfer" })} type="button">{formatMoney(row.payment.amountCents)}</button></td>
                                    <td><button className="transaction-link amount" onClick={() => openActivity({ accountId: account.id, from: previousPaymentDate ? nextDate(previousPaymentDate) : undefined, to: row.payment.date })} type="button">{formatMoney(row.chargesSinceCents)}</button></td>
                                    <td className="amount">{formatMoney(row.owedAfterCents)}</td>
                                    <td>{row.fundedFrom ?? "Not seen yet"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {paymentCheck.rows.length === 0 && <p className="empty-state compact">No card payments found.</p>}
                        </div>
                      </details>
                    )}
                  </td>
                  <td>{account.type === "asset" ? "Asset" : "Credit"}</td>
                  <td><span className={`allocation-tag${account.payerEntityId === HOUSE_ENTITY_ID ? " house" : ""}`}>{account.payerEntityId === HOUSE_ENTITY_ID ? "House" : payer?.name ?? "Unknown"}</span></td>
                  <td>
                    {coverage.ranges.length ? coverage.ranges.map((range) => <div key={`${range.from}-${range.to}`}>{range.from} to {range.to}</div>) : "No imported coverage"}
                    {coverage.gaps.map((gap) => <div key={`${gap.from}-${gap.to}`}>Gap: {gap.from} to {gap.to}</div>)}
                  </td>
                  <td>
                    {(ledger.checkpoints ?? []).filter((item) => item.accountId === account.id).sort((first, second) => first.date.localeCompare(second.date)).map((checkpoint) => (
                      <div key={checkpoint.id}>{checkpoint.date}: <span className="amount">{formatMoney(checkpoint.balanceCents)}</span>{checkpoint.note ? ` · ${checkpoint.note}` : ""}</div>
                    ))}
                    {differences.map((item) => <div key={`${item.earlier.id}-${item.later.id}`}>{item.earlier.date} to {item.later.date}: difference <span className={item.differenceCents === 0 ? "amount" : "amount negative"}>{formatMoney(item.differenceCents)}</span></div>)}
                  </td>
                  <td>
                    <button className="secondary" onClick={() => editAccount(account)} type="button">Rename</button>{" "}
                    <button className="secondary" onClick={() => { setCheckpointAccountId(account.id); setError(""); }} type="button">Add checkpoint</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ledger.accounts.length === 0 && <p className="empty-state compact">No accounts yet.</p>}
      </div>
      {checkpointAccountId && (
        <form className="form-grid" onSubmit={saveCheckpoint}>
          <h2>Add balance checkpoint for {ledger.accounts.find((account) => account.id === checkpointAccountId)?.name}</h2>
          <label>Date<input type="date" value={checkpointDate} onChange={(event) => setCheckpointDate(event.target.value)} required /></label>
          <label>Balance (AUD)<input inputMode="decimal" value={checkpointBalance} onChange={(event) => setCheckpointBalance(event.target.value)} required /></label>
          <label>Note<input value={checkpointNote} onChange={(event) => setCheckpointNote(event.target.value)} /></label>
          <div className="dialog-actions">
            <button className="primary" type="submit">Save checkpoint</button>
            <button className="secondary" onClick={() => setCheckpointAccountId(null)} type="button">Cancel</button>
          </div>
          {error && <p className="banner error" role="alert">{error}</p>}
        </form>
      )}
    </>
  );
}