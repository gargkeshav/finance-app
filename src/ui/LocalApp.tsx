import { useEffect, useRef, useState } from "react";
import { FileStore, isPickerCancellation } from "../adapters/file-store";
import { emptyLedger, ledgerProblem, stringifyLedger } from "../adapters/file-ledger";
import type { Account, BankRow, Baseline, Entry, Entity, Ledger, Settlement } from "../domain/ledger";
import type { EntryFilter } from "../domain/query";
import { ActivityView } from "./views/ActivityView";
import { AccountsView } from "./views/AccountsView";
import { BalancesView } from "./views/BalancesView";
import { DataView } from "./views/DataView";
import { ImportView } from "./views/ImportView";
import { PeopleView } from "./views/PeopleView";
import { ReviewView } from "./views/ReviewView";
import { SettleView } from "./views/SettleView";

type ViewName = "Activity" | "Import" | "Review" | "Settle" | "Accounts" | "People" | "Balances" | "Data";
type RecordWithTimestamp = { id: string; updatedAt: string };

function updateRecords<T extends RecordWithTimestamp>(
  previous: T[],
  next: T[],
  updatedAt: string,
): T[] {
  return next.map((record) => {
    const existing = previous.find((item) => item.id === record.id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(record)) {
      return { ...record, updatedAt };
    }
    return existing;
  });
}

export function LocalApp() {
  const [initialState] = useState(() => {
    const ledger = emptyLedger();
    return { ledger, savedContent: stringifyLedger(ledger) };
  });
  const [ledger, setLedger] = useState<Ledger>(initialState.ledger);
  const [savedContent, setSavedContent] = useState(initialState.savedContent);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<ViewName>("Activity");
  const [activityFilter, setActivityFilter] = useState<EntryFilter>({});
  const [settlementRow, setSettlementRow] = useState<BankRow | null>(null);
  const [fileStore] = useState(() => new FileStore());
  const uploadInput = useRef<HTMLInputElement>(null);
  let currentContent = "";
  let serializationError = "";
  try {
    currentContent = stringifyLedger(ledger);
  } catch (reason) {
    serializationError = reason instanceof Error ? reason.message : "The ledger cannot be saved.";
  }
  const hasUnsavedChanges = Boolean(serializationError) || currentContent !== savedContent;
  const visibleError = serializationError || error;
  const reviewCount = (ledger.bankRows ?? []).filter(
    (row) => !row.entryId && !row.settlementId && !row.skipped,
  ).length;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    function saveOnShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveLedger(false);
      }
    }
    window.addEventListener("keydown", saveOnShortcut);
    return () => window.removeEventListener("keydown", saveOnShortcut);
  }, [fileStore, ledger]);

  function update(next: Ledger) {
    const problem = ledgerProblem(next);
    if (problem) {
      setError(problem);
      setMessage("");
      return;
    }
    setError("");
    setLedger((previous) => {
      const updatedAt = new Date().toISOString();
      return {
        ...next,
        entities: updateRecords<Entity>(previous.entities, next.entities, updatedAt),
        accounts: updateRecords<Account>(previous.accounts, next.accounts, updatedAt),
        entries: updateRecords<Entry>(previous.entries, next.entries, updatedAt),
        baselines: updateRecords<Baseline>(previous.baselines, next.baselines, updatedAt),
        settlements: updateRecords<Settlement>(previous.settlements ?? [], next.settlements ?? [], updatedAt),
      };
    });
  }

  function navigate(nextView: ViewName) {
    setMessage("");
    setError("");
    setView(nextView);
  }

  function openActivity(filter: EntryFilter = {}) {
    setActivityFilter(filter);
    navigate("Activity");
  }

  function canReplaceLedger(): boolean {
    return !hasUnsavedChanges || window.confirm("Discard unsaved changes and open another ledger?");
  }

  function acceptOpenedLedger(result: { ledger: Ledger; fileName: string }) {
    const content = stringifyLedger(result.ledger);
    const waitingRows = (result.ledger.bankRows ?? []).filter(
      (row) => !row.entryId && !row.settlementId && !row.skipped,
    ).length;
    setLedger(result.ledger);
    setSavedContent(content);
    setFileName(result.fileName);
    setView(waitingRows > 0 ? "Review" : "Activity");
    setMessage("Ledger opened.");
    setError("");
  }

  async function openLedger() {
    if (!canReplaceLedger()) return;
    if (fileStore.mode === "download") {
      uploadInput.current?.click();
      return;
    }
    try {
      acceptOpenedLedger(await fileStore.openPickedFile());
    } catch (reason) {
      if (isPickerCancellation(reason)) return;
      setError(reason instanceof Error ? reason.message : "The ledger file could not be opened.");
      setMessage("");
    }
  }

  async function uploadLedger(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      acceptOpenedLedger(await fileStore.openUploadedFile(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The ledger file could not be opened.");
      setMessage("");
    }
  }

  async function saveLedger(saveAs: boolean) {
    try {
      const content = currentContent;
      const savedFileName = saveAs
        ? await fileStore.saveAs(ledger)
        : await fileStore.save(ledger);
      setSavedContent(content);
      setFileName(savedFileName);
      setMessage("Ledger saved.");
      setError("");
    } catch (reason) {
      if (isPickerCancellation(reason)) return;
      setError(reason instanceof Error ? reason.message : "The ledger could not be saved.");
      setMessage("");
    }
  }

  async function saveNow(nextLedger: Ledger): Promise<void> {
    if (fileStore.mode === "download") return;
    const content = stringifyLedger(nextLedger);
    const savedFileName = await fileStore.save(nextLedger);
    setSavedContent(content);
    setFileName(savedFileName);
    setError("");
    setMessage("");
  }

  const views = {
    Import: <ImportView ledger={ledger} update={update} />,
    Review: <ReviewView ledger={ledger} update={update} onSettle={(row) => { setSettlementRow(row); navigate("Settle"); }} />,
    Activity: <ActivityView ledger={ledger} update={update} saveNow={saveNow} activityFilter={activityFilter} openActivity={openActivity} onNavigate={navigate} />,
    Settle: <SettleView ledger={ledger} update={update} bankRow={settlementRow} onSaved={() => setSettlementRow(null)} />,
    Accounts: <AccountsView ledger={ledger} update={update} />,
    People: <PeopleView ledger={ledger} update={update} />,
    Balances: <BalancesView ledger={ledger} update={update} />,
    Data: <DataView mode={fileStore.mode} onSave={() => void saveLedger(false)} />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">Finance</div>
        <nav>
          <div className="nav-group">Daily</div>
          {(["Review", "Activity", "Settle", "Balances", "Import"] as const).map((name) => (
            <button className={`nav-item${view === name ? " active" : ""}`} key={name} onClick={() => navigate(name)} type="button">
              {name}
              {name === "Review" && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}
            </button>
          ))}
          <div className="nav-group">Setup</div>
          {(["Accounts", "People", "Data"] as const).map((name) => (
            <button className={`nav-item${view === name ? " active" : ""}`} key={name} onClick={() => navigate(name)} type="button">
              {name}
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>{fileName || "No file open"}</span>
          {hasUnsavedChanges && <span className="status-chip" role="status">Unsaved</span>}
          <button className="secondary" onClick={openLedger} type="button">Open</button>
          <button className="secondary" onClick={() => void saveLedger(true)} type="button">Save as</button>
          <button className="primary" onClick={() => void saveLedger(false)} type="button">Save</button>
          <input
            ref={uploadInput}
            accept="application/json,.json,.finance.json"
            aria-label="Open ledger JSON file"
            onChange={uploadLedger}
            style={{ display: "none" }}
            type="file"
          />
        </header>
        {message && <p className="banner success" role="status">{message}</p>}
        {visibleError && <p className="banner error" role="alert">{visibleError}</p>}
        {views[view]}
      </main>
    </div>
  );
}