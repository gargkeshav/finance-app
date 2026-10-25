import { useState } from "react";
import { HOUSE_ENTITY_ID, type Account, type Ledger } from "../../domain/ledger";

interface AccountsViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
}

export function AccountsView({ ledger, update }: AccountsViewProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("asset");
  const [payerEntityId, setPayerEntityId] = useState("self");
  const [editingId, setEditingId] = useState<string | null>(null);
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
              Payer entity
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
          <thead><tr><th>Name</th><th>Type</th><th>Payer</th><th /></tr></thead>
          <tbody>
            {ledger.accounts.map((account) => {
              const payer = ledger.entities.find((entity) => entity.id === account.payerEntityId);
              return (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.type === "asset" ? "Asset" : "Credit"}</td>
                  <td>{account.payerEntityId === HOUSE_ENTITY_ID ? "House money" : payer?.name ?? "Unknown"}</td>
                  <td><button className="secondary" onClick={() => editAccount(account)} type="button">Rename</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ledger.accounts.length === 0 && <p className="empty-state compact">No accounts yet.</p>}
      </div>
    </>
  );
}