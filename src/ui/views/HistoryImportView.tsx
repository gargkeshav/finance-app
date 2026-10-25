import { useState } from "react";
import { applyHistoryImport, planHistoryImport, type HistoryImportPlan, type HistoryImportProblem, type HistoryImportRow } from "../../domain/history-import";
import type { Ledger } from "../../domain/ledger";
import { formatMoney } from "../../domain/value";

interface HistoryImportViewProps {
  ledger: Ledger;
  update: (ledger: Ledger) => void;
}

function ImportRows({ title, rows }: { title: string; rows: HistoryImportRow[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h3>{title} ({rows.length})</h3>
      <ul>
        {rows.slice(0, 10).map((row) => (
          <li key={`${row.lineNumber}-${row.historyKey}`}>
            Line {row.lineNumber}: {row.date} · {row.description || "(no description)"} · {formatMoney(row.bankAmountCents)}
          </li>
        ))}
      </ul>
      {rows.length > 10 && <p>Showing the first 10 of {rows.length} rows.</p>}
    </section>
  );
}

function ProblemRows({ rows }: { rows: HistoryImportProblem[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label="Problem rows">
      <h3>Problems ({rows.length})</h3>
      <ul>
        {rows.slice(0, 10).map((row) => (
          <li key={`${row.lineNumber}-${row.reason}`}>
            Line {row.lineNumber}: {row.date} · {row.description || "(no description)"} · {row.reason}
          </li>
        ))}
      </ul>
      {rows.length > 10 && <p>Showing the first 10 of {rows.length} rows.</p>}
    </section>
  );
}

export function HistoryImportView({ ledger, update }: HistoryImportViewProps) {
  const [accountId, setAccountId] = useState(ledger.accounts.find((account) => account.type === "credit")?.id ?? "");
  const [plan, setPlan] = useState<HistoryImportPlan | null>(null);
  const [skipProblems, setSkipProblems] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function readHistory(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setPlan(null);
    setMessage("");
    setError("");
    if (!file || !accountId) return;
    setBusy(true);
    try {
      setPlan(await planHistoryImport(await file.text(), ledger, accountId));
      setSkipProblems(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The history file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function commit() {
    if (!plan || (plan.problems.length > 0 && !skipProblems)) return;
    try {
      update(applyHistoryImport(plan, ledger));
      setMessage("Save the file now");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The history rows could not be added.");
    }
  }

  return (
    <section className="form-grid" aria-label="One-time history import">
      <h2>One-time ANZ credit history</h2>
      <label>
        Credit account
        <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setPlan(null); setMessage(""); }}>
          <option value="">Choose an account</option>
          {ledger.accounts.filter((account) => account.type === "credit").map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
      </label>
      <label>
        History CSV
        <input accept=".csv,text/csv" disabled={!accountId || busy} onChange={(event) => void readHistory(event)} type="file" />
      </label>
      {busy && <p role="status">Reading history file…</p>}
      {error && <p className="banner error" role="alert">{error}</p>}
      {message && <p className="banner success" role="status">{message}</p>}
      {plan && (
        <>
          <p>
            {plan.matched.length} matched · {plan.created.length} to create · {plan.skipped.length} skipped · {plan.pending.length} pending · {plan.problems.length} problems
          </p>
          <ImportRows title="Matched bank rows" rows={plan.matched} />
          <ImportRows title="Entries to create" rows={plan.created} />
          <ImportRows title="Skipped rows" rows={plan.skipped} />
          <ImportRows title="Pending associations" rows={plan.pending} />
          <ProblemRows rows={plan.problems} />
          {plan.problems.length > 0 && (
            <label className="checkbox-label">
              <input checked={skipProblems} onChange={(event) => setSkipProblems(event.target.checked)} type="checkbox" />
              Skip problem rows
            </label>
          )}
          <div className="dialog-actions">
            <button className="primary" disabled={plan.problems.length > 0 && !skipProblems} onClick={commit} type="button">
              Commit import
            </button>
          </div>
        </>
      )}
    </section>
  );
}