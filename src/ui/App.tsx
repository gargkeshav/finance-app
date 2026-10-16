import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  ChevronLeft,
  CircleAlert,
  Download,
  FolderCog,
  Landmark,
  LayoutDashboard,
  ListFilter,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Wallet,
  Upload,
  X,
} from "lucide-react";
import type {
  Account,
  Expense,
  Ledger,
  LedgerCommand,
  Snapshot,
} from "../application/contracts";
import { commandSchema } from "../application/contracts";
import {
  formatAud,
  formatAudBigInt,
  parseAud,
  sumCents,
} from "../domain/value";
import { calculateSpendingSummary } from "../domain/accounting";
import { ImportDialog } from "./ImportDialog";
import { bankProfileNames } from "../application/import-contracts";

type View = "overview" | "transactions" | "accounts" | "data";
type Modal = "account" | "expense" | null;
const empty: Snapshot = {
  schemaVersion: 3,
  epoch: crypto.randomUUID(),
  revision: 0,
  accounts: [],
  expenses: [],
  imports: [],
  bankEvents: [],
  reversals: [],
  auditCount: 0,
};

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "The operation could not be completed. Reload and try again.";
}

export function App({
  ledger,
  synthetic,
}: {
  ledger: Ledger | null;
  synthetic: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<LedgerCommand | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(
    null,
  );
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [transactionSource, setTransactionSource] = useState<"manual" | "bank">(
    "manual",
  );

  async function exportData() {
    if (!ledger?.exportData) return;
    setBusy(true);
    setError("");
    try {
      if (await ledger.exportData()) setNotice("Unencrypted ledger exported.");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function restoreData() {
    if (!ledger?.restoreData || !restoreConfirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await ledger.restoreData(
        snapshot.epoch,
        snapshot.revision,
        restoreConfirmed,
      );
      if (result) {
        setSnapshot(result.snapshot);
        setNotice(`Ledger restored. Safety copy: ${result.safetyFile}`);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      setRestoreConfirmed(false);
    }
  }

  async function reload() {
    setLoading(true);
    setError("");
    try {
      if (!ledger)
        throw new Error("Native storage is unavailable. Open the desktop app.");
      setSnapshot(await ledger.read());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    if (!ledger) {
      setError("Native storage is unavailable. Open the desktop app.");
      setLoading(false);
      return;
    }
    ledger
      .read()
      .then((result) => {
        if (active) setSnapshot(result);
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ledger]);

  async function save(
    operation?: LedgerCommand["operation"],
    keepImportOpen = false,
  ) {
    if (!ledger) throw new Error("Native storage is unavailable.");
    const command =
      pending ??
      commandSchema.parse({
        commandId: crypto.randomUUID(),
        expectedEpoch: snapshot.epoch,
        expectedRevision: snapshot.revision,
        operation,
      });
    setPending(command);
    setBusy(true);
    try {
      let result: Snapshot;
      try {
        result = await ledger.execute(command);
      } catch (failure) {
        const recovered = await ledger.resolve(command);
        if (!recovered) {
          setPending(null);
          throw failure;
        }
        result = recovered;
      }
      setSnapshot(result);
      setPending(null);
      setModal(null);
      setSelectedExpenseId(null);
      setEditingExpense(null);
      if (!keepImportOpen) setImportOpen(false);
      if (command.operation.type === "commitImport") {
        setView("transactions");
        setTransactionSource("bank");
        setSearch("");
        setAccountFilter(command.operation.import.accountId);
      }
      setNotice(
        command.operation.type === "commitImport"
          ? "Import committed atomically. Bank movements await classification."
          : command.operation.type === "createAccount"
            ? "Account saved."
            : command.operation.type === "reverseExpense"
              ? "Expense reversed. Original record retained."
              : command.operation.type === "correctExpense"
                ? "Expense corrected. Original record retained."
                : "Expense saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const filtered = snapshot.expenses.filter(
    (expense) =>
      expense.description.toLowerCase().includes(search.toLowerCase()) &&
      (!accountFilter || expense.accountId === accountFilter),
  );
  const filteredBankEvents = snapshot.bankEvents.filter(
    (event) =>
      event.description.toLowerCase().includes(search.toLowerCase()) &&
      (!accountFilter || event.accountId === accountFilter),
  );
  const reversedIds = new Set(
    snapshot.reversals.map((reversal) => reversal.expenseId),
  );
  const activeExpenses = snapshot.expenses.filter(
    (expense) => !reversedIds.has(expense.id),
  );
  const selectedExpense = snapshot.expenses.find(
    (expense) => expense.id === selectedExpenseId,
  );
  const spending = calculateSpendingSummary(activeExpenses);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView("overview");
          }}
        >
          <span className="brand-mark">
            F<span>.</span>
          </span>
          <span>
            Finance<span className="brand-sub">LOCAL LEDGER</span>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Primary navigation">
          <button
            className={view === "overview" ? "nav-item active" : "nav-item"}
            onClick={() => setView("overview")}
            aria-current={view === "overview" ? "page" : undefined}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>
          <button
            className={view === "transactions" ? "nav-item active" : "nav-item"}
            onClick={() => setView("transactions")}
            aria-current={view === "transactions" ? "page" : undefined}
          >
            <ArrowDownLeft size={18} />
            Transactions
            <span className="nav-count">
              {snapshot.expenses.length + snapshot.bankEvents.length}
            </span>
          </button>
          <button
            className={view === "accounts" ? "nav-item active" : "nav-item"}
            onClick={() => setView("accounts")}
            aria-current={view === "accounts" ? "page" : undefined}
          >
            <Landmark size={18} />
            Accounts
          </button>
          <button
            className={view === "data" ? "nav-item active" : "nav-item"}
            onClick={() => setView("data")}
            aria-current={view === "data" ? "page" : undefined}
          >
            <FolderCog size={18} />
            Data
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          {synthetic ? "Synthetic preview" : "On this Mac"}
          <span className="muted">AUD</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            <strong>
              {view === "overview"
                ? "Overview"
                : view === "transactions"
                  ? "Transactions"
                  : view === "accounts"
                    ? "Accounts"
                    : "Data"}
            </strong>
          </span>
          <div>
            <span className="local-label">
              {synthetic ? "NOT PERSISTED" : "LOCAL STORAGE"}
            </span>
            <button
              className="secondary"
              disabled={loading || busy || !ledger || !snapshot.accounts.length}
              onClick={() => {
                setNotice("");
                setImportOpen(true);
              }}
            >
              <Upload size={16} />
              Import
            </button>
            <button
              className="icon-button"
              title="Reload ledger"
              aria-label="Reload ledger"
              disabled={loading || busy}
              onClick={reload}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR MONEY, IN VIEW</p>
              <h1>
                {view === "overview"
                  ? "Overview"
                  : view === "transactions"
                    ? "Transactions"
                    : view === "accounts"
                      ? "Accounts"
                      : "Data management"}
              </h1>
            </div>
            {view !== "data" && (
              <button
                className="primary"
                disabled={loading || busy || !ledger}
                onClick={() => {
                  setNotice("");
                  setModal(snapshot.accounts.length ? "expense" : "account");
                }}
              >
                <Plus size={17} />
                {snapshot.accounts.length ? "Add expense" : "Add account"}
              </button>
            )}
          </div>
          {error && (
            <div className="banner error" role="alert">
              <CircleAlert size={18} />
              <span>{error}</span>
              <button onClick={reload} disabled={loading}>
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={17} />
              <span>{notice}</span>
              <button
                className="icon-button"
                title="Dismiss notification"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty-state" role="status">
              Loading ledger...
            </div>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <section
                    className="summary-strip"
                    aria-label="Manual ledger totals"
                  >
                    <div>
                      <span className="metric-label">
                        Your attributed spending <ArrowUpRight size={15} />
                      </span>
                      <strong>
                        {formatAudBigInt(spending.attributedCents)}
                      </strong>
                      <span className="metric-note">
                        Personal portions plus half of House
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">
                        House allocation <Wallet size={15} />
                      </span>
                      <strong>{formatAudBigInt(spending.houseCents)}</strong>
                      <span className="metric-note">
                        Shared equally; residual cent attributed to you
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">
                        Account coverage <Landmark size={15} />
                      </span>
                      <strong className="coverage-value">
                        {snapshot.accounts.length
                          ? "Incomplete"
                          : "Not started"}
                      </strong>
                      <span className="metric-note">
                        {snapshot.bankEvents.length
                          ? `${snapshot.bankEvents.length} unclassified bank movements`
                          : "Bank history not imported"}
                      </span>
                    </div>
                  </section>
                  <div className="section-title">
                    <h2>Recent activity</h2>
                    <button
                      className="text-button"
                      onClick={() => setView("transactions")}
                    >
                      All transactions <ChevronRight size={16} />
                    </button>
                  </div>
                  <ExpenseTable
                    reversals={snapshot.reversals}
                    selectExpense={setSelectedExpenseId}
                    expenses={snapshot.expenses.slice(-8).reverse()}
                    accounts={snapshot.accounts}
                  />
                  <section className="accounts-band">
                    <div className="section-title">
                      <h2>
                        Your accounts{" "}
                        <span className="count">
                          {snapshot.accounts.length}
                        </span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => setModal("account")}
                        disabled={!ledger}
                      >
                        <Plus size={16} />
                        Add account
                      </button>
                    </div>
                    <AccountList accounts={snapshot.accounts} />
                  </section>
                </>
              )}
              {view === "transactions" && (
                <>
                  <div
                    className="segmented"
                    role="group"
                    aria-label="Transaction source"
                  >
                    <button
                      aria-pressed={transactionSource === "manual"}
                      onClick={() => setTransactionSource("manual")}
                    >
                      Manual entries <span>{snapshot.expenses.length}</span>
                    </button>
                    <button
                      aria-pressed={transactionSource === "bank"}
                      onClick={() => setTransactionSource("bank")}
                    >
                      Bank movements <span>{snapshot.bankEvents.length}</span>
                    </button>
                  </div>
                  <div className="filters">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search transactions"
                        placeholder="Search transactions"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <label className="account-filter">
                      <ListFilter size={16} />
                      <select
                        aria-label="Filter by account"
                        value={accountFilter}
                        onChange={(event) =>
                          setAccountFilter(event.target.value)
                        }
                      >
                        <option value="">All accounts</option>
                        {snapshot.accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="result-count">
                      {transactionSource === "manual"
                        ? filtered.length
                        : filteredBankEvents.length}{" "}
                      records
                    </span>
                  </div>
                  {transactionSource === "manual" && (
                    <ExpenseTable
                      reversals={snapshot.reversals}
                      selectExpense={setSelectedExpenseId}
                      expenses={
                        transactionSource === "manual"
                          ? [...filtered].reverse()
                          : []
                      }
                      accounts={snapshot.accounts}
                    />
                  )}
                  {transactionSource === "bank" && (
                    <BankEventTable
                      snapshot={snapshot}
                      events={filteredBankEvents}
                    />
                  )}
                </>
              )}
              {view === "accounts" && (
                <>
                  <div className="section-title">
                    <h2>
                      Accounts{" "}
                      <span className="count">{snapshot.accounts.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setModal("account")}
                      disabled={!ledger}
                    >
                      <Plus size={16} />
                      Add account
                    </button>
                  </div>
                  <AccountList accounts={snapshot.accounts} />
                </>
              )}
              {view === "data" && (
                <section className="data-management">
                  <div className="banner error">
                    <CircleAlert size={18} />
                    <span>Local data and exports are unencrypted.</span>
                  </div>
                  <div className="data-row">
                    <div>
                      <h2>Manual export</h2>
                      <p>
                        {snapshot.accounts.length} accounts,{" "}
                        {snapshot.expenses.length} expenses,{" "}
                        {snapshot.bankEvents.length} bank events,{" "}
                        {snapshot.imports.length} imports, {snapshot.auditCount}{" "}
                        audit records
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={exportData}
                      disabled={busy || !ledger?.exportData}
                      title={
                        synthetic
                          ? "Unavailable in synthetic preview"
                          : "Export unencrypted ledger"
                      }
                    >
                      <Download size={17} />
                      Export ledger
                    </button>
                  </div>
                  <div className="data-row">
                    <div>
                      <h2>Restore ledger</h2>
                      <p>
                        Replace current records from a finance export. A safety
                        copy is retained.
                      </p>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={restoreConfirmed}
                          onChange={(event) =>
                            setRestoreConfirmed(event.target.checked)
                          }
                          disabled={busy || !ledger?.restoreData}
                        />
                        I confirm replacement of the current ledger.
                      </label>
                    </div>
                    <button
                      className="secondary"
                      onClick={restoreData}
                      disabled={
                        busy || !restoreConfirmed || !ledger?.restoreData
                      }
                      title={
                        synthetic
                          ? "Unavailable in synthetic preview"
                          : "Select export to restore"
                      }
                    >
                      <RotateCcw size={17} />
                      Choose export
                    </button>
                  </div>
                </section>
              )}
              <footer>
                <span>
                  Schema {snapshot.schemaVersion}{" "}
                  <span className="separator">/</span> Revision{" "}
                  {snapshot.revision}
                </span>
                <span>
                  {snapshot.auditCount} audited commands{" "}
                  <span className="separator">/</span>{" "}
                  {synthetic
                    ? "In-memory synthetic data"
                    : "Unencrypted local data"}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {importOpen && (
        <ImportDialog
          snapshot={snapshot}
          busy={busy}
          pending={pending !== null}
          close={() => {
            if (!busy && !pending) setImportOpen(false);
          }}
          save={save}
        />
      )}
      {modal && (
        <EntryDialog
          modal={modal}
          original={editingExpense}
          accounts={snapshot.accounts}
          busy={busy}
          pending={pending !== null}
          close={() => {
            if (!busy && !pending) {
              setModal(null);
              setEditingExpense(null);
            }
          }}
          save={save}
        />
      )}
      {selectedExpense && (
        <ExpenseDetail
          expense={selectedExpense}
          account={snapshot.accounts.find(
            (account) => account.id === selectedExpense.accountId,
          )}
          reversal={snapshot.reversals.find(
            (reversal) => reversal.expenseId === selectedExpense.id,
          )}
          busy={busy}
          pending={pending !== null}
          close={() => {
            if (!busy && !pending) setSelectedExpenseId(null);
          }}
          save={save}
          correct={() => {
            setEditingExpense(selectedExpense);
            setSelectedExpenseId(null);
            setModal("expense");
          }}
        />
      )}
    </div>
  );
}

function BankEventTable({
  snapshot,
  events,
}: {
  snapshot: Snapshot;
  events: Snapshot["bankEvents"];
}) {
  const [page, setPage] = useState(0);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(events.length / 50) - 1),
  );
  if (!events.length)
    return (
      <div className="empty-state">
        <Upload size={26} />
        <h3>No bank movements</h3>
        <p>No imported records in this view.</p>
      </div>
    );
  return (
    <>
      <div className="banner import-warning">
        <CircleAlert size={17} />
        <span>
          Unclassified bank movements. Not included in consumption totals;
          positive amounts are not automatically income.
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Posting date</th>
              <th>Description / evidence</th>
              <th>Account</th>
              <th>Status</th>
              <th className="amount">Bank movement</th>
            </tr>
          </thead>
          <tbody>
            {[...events]
              .reverse()
              .slice(currentPage * 50, (currentPage + 1) * 50)
              .map((event) => (
                <tr key={event.id}>
                  <td className="date-cell">{event.date}</td>
                  <td>
                    <strong>{event.description}</strong>
                    <details>
                      <summary>Source observations</summary>
                      {snapshot.imports.flatMap((record) =>
                        record.rows
                          .filter((row) => row.eventId === event.id)
                          .map((row) => (
                            <section
                              className="source-observation"
                              key={`${record.id}-${row.observation.ordinal}`}
                            >
                              <strong>
                                {record.fileName} / row{" "}
                                {row.observation.ordinal}
                              </strong>
                              <p>
                                {bankProfileNames[record.profile]} /{" "}
                                {row.decision === "new"
                                  ? "New event"
                                  : "Explicitly linked occurrence"}{" "}
                                / Original{" "}
                                {record.originalBase64 === null
                                  ? "not retained"
                                  : "retained"}
                              </p>
                              <ol>
                                {row.observation.rawFields.map(
                                  (field, index) => (
                                    <li key={index}>{field || "(empty)"}</li>
                                  ),
                                )}
                              </ol>
                              <p>
                                Source balance:{" "}
                                {row.observation.balanceCents === null
                                  ? "Unknown"
                                  : formatAud(row.observation.balanceCents)}
                              </p>
                            </section>
                          )),
                      )}
                    </details>
                  </td>
                  <td>
                    {snapshot.accounts.find(
                      (account) => account.id === event.accountId,
                    )?.name ?? "Unknown account"}
                  </td>
                  <td>
                    <span className="allocation-tag">Needs classification</span>
                  </td>
                  <td className="amount">{formatAud(event.amountCents)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          {currentPage * 50 + 1}-
          {Math.min((currentPage + 1) * 50, events.length)} of {events.length}{" "}
          movements
        </span>
        <button
          className="icon-button"
          title="Previous movements page"
          aria-label="Previous movements page"
          disabled={!currentPage}
          onClick={() => setPage(currentPage - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-button"
          title="Next movements page"
          aria-label="Next movements page"
          disabled={(currentPage + 1) * 50 >= events.length}
          onClick={() => setPage(currentPage + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <section className="accounts-band">
        <div className="section-title">
          <h2>Import history</h2>
        </div>
        {snapshot.imports.map((record) => (
          <div className="import-history-row" key={record.id}>
            <strong>{record.fileName}</strong>
            <span>
              {bankProfileNames[record.profile]} /{" "}
              {
                snapshot.accounts.find(
                  (account) => account.id === record.accountId,
                )?.name
              }{" "}
              / {record.rows.length} observations
            </span>
          </div>
        ))}
      </section>
    </>
  );
}

function AccountList({ accounts }: { accounts: Account[] }) {
  if (!accounts.length)
    return (
      <div className="empty-state compact">
        <Landmark size={26} />
        <h3>No accounts yet</h3>
        <p>Opening balances are unknown until entered.</p>
      </div>
    );
  return (
    <div className="account-list">
      {accounts.map((account) => (
        <div className="account-row" key={account.id}>
          <span className="account-icon">
            <Landmark size={20} />
          </span>
          <div>
            <strong>{account.name}</strong>
            <span>
              {account.role === "common"
                ? "House common account"
                : account.kind === "credit"
                  ? "Personal credit card"
                  : "Personal account"}
            </span>
          </div>
          <div className="account-balance">
            <strong>Balance unknown</strong>
            <span>
              {account.openingBalanceCents === null
                ? "No opening balance"
                : `Opening ${formatAud(account.openingBalanceCents)} on ${account.openingDate}`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpenseTable({
  expenses,
  accounts,
  reversals,
  selectExpense,
}: {
  expenses: Expense[];
  accounts: Account[];
  reversals: Snapshot["reversals"];
  selectExpense: (id: string) => void;
}) {
  if (!expenses.length)
    return (
      <div className="empty-state">
        <ArrowDownLeft size={28} />
        <h3>No transactions</h3>
        <p>No recorded expenses in this view.</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Account</th>
            <th>Allocation</th>
            <th className="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.id}>
              <td className="date-cell">{expense.date}</td>
              <td>
                <button
                  className="transaction-link"
                  onClick={() => selectExpense(expense.id)}
                >
                  {expense.description}
                </button>
                <span className="source-label">
                  {reversals.some(
                    (reversal) => reversal.expenseId === expense.id,
                  )
                    ? "Reversed / original retained"
                    : "Manual entry"}
                </span>
              </td>
              <td>
                {accounts.find((account) => account.id === expense.accountId)
                  ?.name ?? "Unknown account"}
              </td>
              <td>
                {expense.allocations.map((line) => (
                  <span
                    className={`allocation-tag ${line.bucket}`}
                    key={line.id}
                  >
                    {line.bucket === "house" ? "House" : "Personal"}{" "}
                    {formatAud(line.amountCents)}
                  </span>
                ))}
              </td>
              <td className="amount">{formatAud(expense.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseDetail({
  expense,
  account,
  reversal,
  busy,
  pending,
  close,
  save,
  correct,
}: {
  expense: Expense;
  account: Account | undefined;
  reversal: Snapshot["reversals"][number] | undefined;
  busy: boolean;
  pending: boolean;
  close: () => void;
  save: (operation?: LedgerCommand["operation"]) => Promise<void>;
  correct: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  async function reverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await save(
        pending
          ? undefined
          : {
              type: "reverseExpense",
              expenseId: expense.id,
              reason: reason.trim(),
            },
      );
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>Transaction details</h2>
        <button
          className="icon-button"
          title="Close"
          aria-label="Close"
          onClick={close}
          disabled={busy || pending}
        >
          <X size={20} />
        </button>
      </div>
      <h3 className="detail-description">{expense.description}</h3>
      <dl className="detail-facts">
        <div>
          <dt>Original amount</dt>
          <dd>{formatAud(expense.amountCents)}</dd>
        </div>
        <div>
          <dt>Posting date</dt>
          <dd>{expense.date}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>Manual entry</dd>
        </div>
        <div>
          <dt>Funding</dt>
          <dd>
            {account?.name ?? "Unknown account"} /{" "}
            {formatAud(expense.amountCents)}
          </dd>
        </div>
        {expense.allocations.map((line) => (
          <div key={line.id}>
            <dt>
              {line.bucket === "house"
                ? "House allocation"
                : "Personal allocation"}
            </dt>
            <dd>{formatAud(line.amountCents)}</dd>
          </div>
        ))}
        <div>
          <dt>Status</dt>
          <dd>{reversal ? "Reversed" : "Active"}</dd>
        </div>
      </dl>
      {!reversal && (
        <button
          className="secondary"
          type="button"
          onClick={correct}
          disabled={busy || pending}
        >
          <RefreshCw size={17} />
          Correct entry
        </button>
      )}
      {reversal ? (
        <div className="banner success">
          <Check size={17} />
          <span>Reversal reason: {reversal.reason}</span>
        </div>
      ) : (
        <form onSubmit={reverse}>
          {error && (
            <div className="banner error" role="alert">
              <CircleAlert size={18} />
              <span>{error}</span>
            </div>
          )}
          <fieldset disabled={busy || pending}>
            <label>
              Reversal reason
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                maxLength={300}
                autoComplete="off"
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                required
              />
              Remove this entry from spending totals and retain the original
              evidence.
            </label>
          </fieldset>
          {pending && (
            <p className="banner error" role="status">
              Outcome pending. Retry only the original reversal.
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={busy || pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || (!pending && (!confirmed || !reason.trim()))}
            >
              <RotateCcw size={17} />
              {busy
                ? "Saving..."
                : pending
                  ? "Retry original command"
                  : "Reverse entry"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function EntryDialog({
  modal,
  original,
  accounts,
  busy,
  pending,
  close,
  save,
}: {
  modal: Exclude<Modal, null>;
  original: Expense | null;
  accounts: Account[];
  busy: boolean;
  pending: boolean;
  close: () => void;
  save: (operation?: LedgerCommand["operation"]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (pending) {
        await save();
        return;
      }
      if (modal === "account") {
        const openingText = String(data.get("opening") ?? "");
        const openingDate = String(data.get("openingDate") ?? "");
        await save({
          type: "createAccount",
          account: {
            id: crypto.randomUUID(),
            name: String(data.get("name")).trim(),
            kind: data.get("kind") as Account["kind"],
            role: data.get("role") as Account["role"],
            currency: "AUD",
            version: 1,
            openingBalanceCents: openingText ? parseAud(openingText) : null,
            openingDate: openingDate || null,
          },
        });
      } else {
        if (!confirmed)
          throw new Error(
            "Confirm the account, amount, and allocation before saving.",
          );
        const amount = parseAud(String(data.get("amount")));
        const house = parseAud(String(data.get("house") || "0"));
        if (amount <= 0 || house < 0 || house > amount)
          throw new Error(
            "Expense must be positive; House portion must be between zero and the expense total.",
          );
        const personal = sumCents([amount, -house]);
        const allocations: Expense["allocations"] = [];
        if (house)
          allocations.push({
            id: crypto.randomUUID(),
            bucket: "house",
            personId: null,
            amountCents: house,
          });
        if (personal)
          allocations.push({
            id: crypto.randomUUID(),
            bucket: "personal",
            personId: null,
            amountCents: personal,
          });
        const expense: Expense = {
          id: crypto.randomUUID(),
          accountId: String(data.get("account")),
          date: String(data.get("date")),
          description: String(data.get("description")).trim(),
          currency: "AUD",
          amountCents: amount,
          allocations,
          version: 1,
        };
        if (original) {
          await save({
            type: "correctExpense",
            expenseId: original.id,
            reason: String(data.get("reason")).trim(),
            replacement: expense,
          });
        } else {
          await save({ type: "createExpense", expense });
        }
      }
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id={titleId}>
            {modal === "account"
              ? "Add account"
              : original
                ? "Correct expense"
                : "Add expense"}
          </h2>
          <button
            type="button"
            className="icon-button"
            title="Close"
            aria-label="Close"
            onClick={close}
            disabled={busy || pending}
          >
            <X size={20} />
          </button>
        </div>
        {error && (
          <div className="banner error" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}
        <fieldset disabled={busy || pending}>
          {modal === "account" ? (
            <>
              <label>
                Account name
                <input
                  name="name"
                  required
                  maxLength={100}
                  autoFocus
                  autoComplete="off"
                />
              </label>
              <div className="form-grid">
                <label>
                  Account type
                  <select name="kind">
                    <option value="asset">Bank / cash / wallet</option>
                    <option value="credit">Credit card</option>
                  </select>
                </label>
                <label>
                  Ownership
                  <select name="role">
                    <option value="personal">Personal</option>
                    <option value="common">House common account</option>
                  </select>
                </label>
              </div>
              <label>
                Opening balance (AUD, optional)
                <input
                  name="opening"
                  inputMode="decimal"
                  placeholder="Unknown"
                />
              </label>
              <label>
                Opening balance date
                <input
                  name="openingDate"
                  type="date"
                  min="1900-01-01"
                  max="9999-12-31"
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Description
                <input
                  name="description"
                  defaultValue={original?.description}
                  required
                  maxLength={300}
                  autoFocus
                  autoComplete="off"
                />
              </label>
              <div className="form-grid">
                <label>
                  Posting date
                  <input
                    name="date"
                    defaultValue={original?.date}
                    type="date"
                    required
                    min="1900-01-01"
                    max="9999-12-31"
                  />
                </label>
                <label>
                  Paid from
                  <select
                    name="account"
                    required
                    defaultValue={original?.accountId}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Expense total (AUD)
                  <input
                    name="amount"
                    defaultValue={
                      original
                        ? formatAud(original.amountCents).slice(4)
                        : undefined
                    }
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                  />
                </label>
                <label>
                  House portion (AUD)
                  <input
                    name="house"
                    inputMode="decimal"
                    defaultValue={
                      original
                        ? formatAud(
                            sumCents(
                              original.allocations
                                .filter((line) => line.bucket === "house")
                                .map((line) => line.amountCents),
                            ),
                          ).slice(4)
                        : "0.00"
                    }
                  />
                </label>
              </div>
              {original && (
                <label>
                  Correction reason
                  <input
                    name="reason"
                    required
                    maxLength={300}
                    autoComplete="off"
                  />
                </label>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  required
                />
                I confirm the remaining portion is personal.
              </label>
            </>
          )}
        </fieldset>
        {pending && !busy && (
          <p className="banner error" role="status">
            Save outcome is unknown. Only the original command can be retried.
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={close}
            disabled={busy || pending}
          >
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            <Check size={17} />
            {busy
              ? "Saving..."
              : pending
                ? "Retry original command"
                : modal === "account"
                  ? "Save account"
                  : original
                    ? "Confirm correction"
                    : "Save expense"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
