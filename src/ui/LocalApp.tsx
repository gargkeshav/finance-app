import { useEffect, useRef, useState } from "react";
import { FileStore, isPickerCancellation } from "../adapters/file-store";
import { emptyLedger, stringifyLedger } from "../adapters/file-ledger";
import type { Account, Baseline, Entry, Entity, Ledger } from "../domain/ledger";
import { ActivityView } from "./views/ActivityView";
import { AccountsView } from "./views/AccountsView";
import { BalancesView } from "./views/BalancesView";
import { DataView } from "./views/DataView";
import { PeopleView } from "./views/PeopleView";

type ViewName = "Activity" | "Accounts" | "People" | "Balances" | "Data";
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
  const [fileStore] = useState(() => new FileStore());
  const uploadInput = useRef<HTMLInputElement>(null);
  const currentContent = stringifyLedger(ledger);
  const hasUnsavedChanges = currentContent !== savedContent;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  function update(next: Ledger) {
    setLedger((previous) => {
      const updatedAt = new Date().toISOString();
      return {
        ...next,
        entities: updateRecords<Entity>(previous.entities, next.entities, updatedAt),
        accounts: updateRecords<Account>(previous.accounts, next.accounts, updatedAt),
        entries: updateRecords<Entry>(previous.entries, next.entries, updatedAt),
        baselines: updateRecords<Baseline>(previous.baselines, next.baselines, updatedAt),
      };
    });
  }

  function canReplaceLedger(): boolean {
    return !hasUnsavedChanges || window.confirm("Discard unsaved changes and open another ledger?");
  }

  function acceptOpenedLedger(result: { ledger: Ledger; fileName: string }) {
    const content = stringifyLedger(result.ledger);
    setLedger(result.ledger);
    setSavedContent(content);
    setFileName(result.fileName);
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

  const views = {
    Activity: <ActivityView ledger={ledger} update={update} />,
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
          {(["Activity", "Accounts", "People", "Balances", "Data"] as const).map(
            (name) => (
              <button
                className={`nav-item${view === name ? " active" : ""}`}
                key={name}
                onClick={() => setView(name)}
                type="button"
              >
                {name}
              </button>
            ),
          )}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>{fileName || "No file open"}</span>
          {hasUnsavedChanges && <span role="status">Unsaved changes</span>}
          <button className="secondary" onClick={openLedger} type="button">Open</button>
          <button className="secondary" onClick={() => void saveLedger(false)} type="button">Save</button>
          <button className="primary" onClick={() => void saveLedger(true)} type="button">Save as</button>
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
        {error && <p className="banner error" role="alert">{error}</p>}
        {views[view]}
      </main>
    </div>
  );
}