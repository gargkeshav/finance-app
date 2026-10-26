import { useEffect, useRef, useState } from "react";
import { FileStore, isPickerCancellation, nextAutosaveDelayMs } from "../adapters/file-store";
import { emptyLedger, ledgerProblem, parseLedger, stringifyLedger } from "../adapters/file-ledger";
import type { Account, BankRow, Baseline, Entry, Entity, Ledger, Settlement } from "../domain/ledger";
import type { EntryRule } from "../domain/rules";
import type { EntryFilter } from "../domain/query";
import { buildChangeSet, revertChangeSet } from "../domain/history";
import type { ChangeActor } from "../domain/history";
import { ActivityView } from "./views/ActivityView";
import { HomeView } from "./views/HomeView";
import { AccountsView } from "./views/AccountsView";
import { BalancesView } from "./views/BalancesView";
import { EntityView } from "./views/EntityView";
import { DataView } from "./views/DataView";
import { findIssues } from "../domain/health";
import { HealthView } from "./views/HealthView";
import { HistoryView } from "./views/HistoryView";
import { ImportView } from "./views/ImportView";
import { PeopleView } from "./views/PeopleView";
import { ReportsView } from "./views/ReportsView";
import { ReviewView } from "./views/ReviewView";
import { RulesView } from "./views/RulesView";
import { SettleView } from "./views/SettleView";
import { decodeRoute, encodeRoute } from "./route";

type ViewName = "Home" | "Activity" | "Import" | "Review" | "Settle" | "Accounts" | "People" | "Balances" | "Reports" | "Data" | "Rules" | "Health" | "History";
const knownViews: ViewName[] = ["Home", "Activity", "Import", "Review", "Settle", "Accounts", "People", "Balances", "Reports", "Data", "Rules", "Health", "History"];
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
  const [reopenPrompt, setReopenPrompt] = useState<{ handle: NonNullable<Awaited<ReturnType<FileStore["loadRememberedHandle"]>>>; fileName: string } | null>(null);
  const [recoveryCopy, setRecoveryCopy] = useState<Awaited<ReturnType<FileStore["readRecovery"]>>>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [undoState, setUndoState] = useState<{ ledger: Ledger; label: string } | null>(null);
  const [view, setView] = useState<ViewName>("Home");
  const [activityFilter, setActivityFilter] = useState<EntryFilter>({});
  const [ruleDescription, setRuleDescription] = useState("");
  const [settlementRow, setSettlementRow] = useState<BankRow | null>(null);
  const [openEntityId, setOpenEntityId] = useState<string | null>(null);
  const [fileStore] = useState(() => new FileStore());
  const [isSaving, setIsSaving] = useState(false);
  const [autosaveFailures, setAutosaveFailures] = useState(0);
  const [autosaveDelayMs, setAutosaveDelayMs] = useState(1000);
  const [autosaveVersion, setAutosaveVersion] = useState(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const undoTimeout = useRef<number | null>(null);
  const autosaveFailureCount = useRef(0);
  const autosaveInProgress = useRef(false);
  const lastAutosaveContent = useRef("");
  const saveLedgerRef = useRef<(saveAs: boolean, automatic?: boolean) => Promise<void>>(async () => {});
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
  const today = new Date();
  const healthIssues = findIssues(ledger, `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  const healthCount = healthIssues.reduce((total, issue) => total + issue.count, 0);

  useEffect(() => {
    function applyRoute() {
      const route = decodeRoute(window.location.hash, knownViews);
      setView(route.view as ViewName);
      if (route.view === "Activity") setActivityFilter(route.filter ?? {});
    }
    applyRoute();
    window.addEventListener("hashchange", applyRoute);
    return () => window.removeEventListener("hashchange", applyRoute);
  }, []);

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

  useEffect(() => () => {
    if (undoTimeout.current !== null) window.clearTimeout(undoTimeout.current);
  }, []);

  useEffect(() => {
    if (fileStore.mode !== "in-place") return;
    let cancelled = false;
    void (async () => {
      const handle = await fileStore.loadRememberedHandle();
      if (cancelled) return;
      if (handle) {
        setReopenPrompt({ handle, fileName: handle.name });
        return;
      }
      const recovery = await fileStore.readRecovery();
      if (!cancelled && recovery && recovery.content !== initialState.savedContent) {
        setRecoveryCopy(recovery);
      }
    })();
    return () => { cancelled = true; };
  }, [fileStore, initialState.savedContent]);

  useEffect(() => {
    if (lastAutosaveContent.current === currentContent) return;
    lastAutosaveContent.current = currentContent;
    setAutosaveDelayMs(1000);
  }, [currentContent]);

  useEffect(() => {
    if (!hasUnsavedChanges || serializationError) return;
    const content = currentContent;
    const timer = window.setTimeout(() => {
      void (async () => {
        await fileStore.writeRecovery(fileName || fileStore.fileName || "finance-ledger.finance.json", content);
        if (fileStore.mode !== "in-place" || !fileStore.hasOpenFile || autosaveInProgress.current) return;
        await saveLedgerRef.current(false, true);
      })();
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [currentContent, fileName, fileStore, hasUnsavedChanges, serializationError, autosaveDelayMs, autosaveVersion]);

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

  function update(next: Ledger, undoLabel?: string, actor: ChangeActor = "you") {
    const problem = ledgerProblem(next);
    if (problem) {
      setError(problem);
      setMessage("");
      return;
    }
    if (undoTimeout.current !== null) window.clearTimeout(undoTimeout.current);
    const actionLabel = undoLabel ?? (settlementRow ? "Record settlement" : undefined);
    if (actionLabel) {
      setUndoState({ ledger, label: actionLabel });
      undoTimeout.current = window.setTimeout(() => {
        setUndoState(null);
        undoTimeout.current = null;
      }, 10_000);
    } else {
      setUndoState(null);
      undoTimeout.current = null;
    }
    setError("");
    setLedger((previous) => {
      const updatedAt = new Date().toISOString();
      const stamped: Ledger = {
        ...next,
        history: previous.history ?? [],
        entities: updateRecords<Entity>(previous.entities, next.entities, updatedAt),
        accounts: updateRecords<Account>(previous.accounts, next.accounts, updatedAt),
        entries: updateRecords<Entry>(previous.entries, next.entries, updatedAt),
        baselines: updateRecords<Baseline>(previous.baselines, next.baselines, updatedAt),
        settlements: updateRecords<Settlement>(previous.settlements ?? [], next.settlements ?? [], updatedAt),
        rules: updateRecords<EntryRule>(previous.rules ?? [], next.rules ?? [], updatedAt),
      };
      if (!undoLabel) return stamped;
      const changeSet = buildChangeSet(previous, stamped, undoLabel, actor);
      return changeSet
        ? { ...stamped, history: [...(previous.history ?? []), changeSet].slice(-200) }
        : stamped;
    });
  }

  function revertLatestChange() {
    const history = ledger.history ?? [];
    const latest = history[history.length - 1];
    if (!latest) return;
    const result = revertChangeSet(ledger, latest);
    setLedger({ ...result.ledger, history: history.slice(0, -1) });
    setWarning(result.skipped > 0
      ? `${result.skipped} record(s) changed again since and were left as they are.`
      : "");
    setError("");
    setMessage("");
  }

  function undoLastAction() {
    if (!undoState) return;
    if (undoTimeout.current !== null) window.clearTimeout(undoTimeout.current);
    undoTimeout.current = null;
    setLedger(undoState.ledger);
    setUndoState(null);
    setError("");
    setMessage("");
  }

  function navigate(nextView: ViewName, filter?: EntryFilter) {
    if (nextView !== "Balances") setOpenEntityId(null);
    setMessage("");
    setError("");
    setWarning("");
    setView(nextView);
    const nextHash = encodeRoute({ view: nextView, filter: nextView === "Activity" ? filter ?? activityFilter : undefined });
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }

  function openActivity(filter: EntryFilter = {}) {
    setActivityFilter(filter);
    navigate("Activity", filter);
  }

  function openEntity(entityId: string) {
    setOpenEntityId(entityId);
    navigate("Balances");
  }

  function canReplaceLedger(): boolean {
    return !hasUnsavedChanges || window.confirm("Discard unsaved changes and open another ledger?");
  }

  function acceptOpenedLedger(result: { ledger: Ledger; fileName: string }, unsaved = false) {
    if (undoTimeout.current !== null) window.clearTimeout(undoTimeout.current);
    undoTimeout.current = null;
    setUndoState(null);
    const content = stringifyLedger(result.ledger);
    const waitingRows = (result.ledger.bankRows ?? []).filter(
      (row) => !row.entryId && !row.settlementId && !row.skipped,
    ).length;
    setLedger(result.ledger);
    setSavedContent(unsaved ? "" : content);
    setFileName(result.fileName);
    setReopenPrompt(null);
    setRecoveryCopy(null);
    autosaveFailureCount.current = 0;
    setAutosaveFailures(0);
    setAutosaveDelayMs(1000);
    navigate(waitingRows > 0 ? "Review" : "Home");
    setMessage("Ledger opened.");
    setError("");
    setWarning("");
  }

  async function offerRecovery(loadedContent: string) {
    const recovery = await fileStore.readRecovery();
    if (recovery && recovery.content !== loadedContent) setRecoveryCopy(recovery);
  }

  async function reopenRememberedFile() {
    if (!reopenPrompt) return;
    const { handle } = reopenPrompt;
    setReopenPrompt(null);
    try {
      const result = await fileStore.reopenHandle(handle);
      acceptOpenedLedger(result);
      await offerRecovery(stringifyLedger(result.ledger));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The ledger file could not be reopened.");
      setMessage("");
      await offerRecovery(currentContent);
    }
  }

  function useRecoveryCopy() {
    if (!recoveryCopy) return;
    try {
      const recoveredLedger = parseLedger(recoveryCopy.content);
      acceptOpenedLedger({ ledger: recoveredLedger, fileName: recoveryCopy.fileName }, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The recovered ledger could not be opened.");
      setMessage("");
      setRecoveryCopy(null);
    }
  }

  async function discardRecoveryCopy() {
    await fileStore.clearRecovery();
    setRecoveryCopy(null);
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

  async function saveLedger(saveAs: boolean, automatic = false) {
    if (autosaveInProgress.current) return;
    if (!automatic) {
      autosaveFailureCount.current = 0;
      setAutosaveFailures(0);
      setAutosaveDelayMs(1000);
    }
    autosaveInProgress.current = true;
    setIsSaving(true);
    try {
      const content = currentContent;
      const savedFileName = saveAs
        ? await fileStore.saveAs(ledger)
        : await fileStore.save(ledger);
      setSavedContent(content);
      setFileName(savedFileName);
      setMessage(automatic ? "" : "Ledger saved.");
      setError("");
      setWarning(fileStore.backupWarning);
      autosaveFailureCount.current = 0;
      setAutosaveFailures(0);
      setAutosaveDelayMs(1000);
      await fileStore.clearRecovery();
    } catch (reason) {
      if (isPickerCancellation(reason)) return;
      setError(reason instanceof Error ? reason.message : "The ledger could not be saved.");
      setMessage("");
      if (automatic) {
        const failedAttempts = autosaveFailureCount.current + 1;
        autosaveFailureCount.current = failedAttempts;
        setAutosaveFailures(failedAttempts);
        setAutosaveDelayMs(nextAutosaveDelayMs(failedAttempts));
        setAutosaveVersion((version) => version + 1);
      } else {
        autosaveFailureCount.current = 0;
        setAutosaveFailures(0);
        setAutosaveDelayMs(1000);
        setAutosaveVersion((version) => version + 1);
      }
    } finally {
      autosaveInProgress.current = false;
      setIsSaving(false);
    }
  }
  saveLedgerRef.current = saveLedger;

  async function saveNow(nextLedger: Ledger): Promise<void> {
    if (fileStore.mode === "download") return;
    autosaveFailureCount.current = 0;
    setAutosaveFailures(0);
    setAutosaveDelayMs(1000);
    const content = stringifyLedger(nextLedger);
    const savedFileName = await fileStore.save(nextLedger);
    setSavedContent(content);
    setFileName(savedFileName);
    setError("");
    setMessage("");
    setWarning(fileStore.backupWarning);
    await fileStore.clearRecovery();
  }

  async function chooseBackupFolder() {
    try {
      const folderName = await fileStore.chooseBackupFolder();
      setWarning("");
      setError("");
      setMessage(`Backups will be saved in ${folderName}.`);
    } catch (reason) {
      if (isPickerCancellation(reason)) return;
      setError(reason instanceof Error ? reason.message : "The backup folder could not be selected.");
      setMessage("");
    }
  }

  function restoreLedger(restoredLedger: Ledger) {
    if (!canReplaceLedger()) return;
    acceptOpenedLedger({ ledger: restoredLedger, fileName: fileStore.fileName || "Restored backup" });
  }

  const views = {
    Home: <HomeView ledger={ledger} healthIssues={healthIssues} reviewCount={reviewCount} openActivity={openActivity} onOpenEntity={openEntity} onNavigate={navigate} />,
    Import: <ImportView ledger={ledger} update={update} />,
    Review: <ReviewView ledger={ledger} update={update} onSettle={(row) => { setSettlementRow(row); navigate("Settle"); }} onCreateRule={(description) => { setRuleDescription(description); navigate("Rules"); }} />,
    Activity: <ActivityView ledger={ledger} update={update} saveNow={saveNow} activityFilter={activityFilter} openActivity={openActivity} onNavigate={navigate} />,
    Rules: <RulesView ledger={ledger} update={update} initialDescription={ruleDescription} onClearInitialDescription={() => setRuleDescription("")} />,
    Settle: <SettleView ledger={ledger} update={update} saveNow={saveNow} bankRow={settlementRow} onSaved={() => setSettlementRow(null)} />,
    Accounts: <AccountsView ledger={ledger} update={update} openActivity={openActivity} />,
    People: <PeopleView ledger={ledger} update={update} openActivity={openActivity} />,
    Balances: openEntityId
      ? <EntityView
        ledger={ledger}
        update={update}
        entityId={openEntityId}
        openActivity={openActivity}
        onSettle={() => { setSettlementRow(null); navigate("Settle"); }}
        onBack={() => setOpenEntityId(null)}
      />
      : <BalancesView ledger={ledger} update={update} openActivity={openActivity} onOpenEntity={setOpenEntityId} />,
    Reports: <ReportsView ledger={ledger} openActivity={openActivity} />,
    Data: <DataView
      mode={fileStore.mode}
      onSave={() => void saveLedger(false)}
      onChooseBackupFolder={fileStore.backupSupported ? () => void chooseBackupFolder() : undefined}
      onRestore={restoreLedger}
      ledger={ledger}
      update={update}
    />,
    Health: <HealthView issues={healthIssues} onNavigate={navigate} />,
    History: <HistoryView history={ledger.history ?? []} onRevert={revertLatestChange} />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">Finance</div>
        <nav>
          {(["Home"] as const).map((name) => (
            <button className={`nav-item${view === name ? " active" : ""}`} key={name} onClick={() => navigate(name)} type="button">{name}</button>
          ))}
          <div className="nav-group">Daily</div>
          {(["Review", "Activity", "Settle", "Reports"] as const).map((name) => (
            <button className={`nav-item${view === name ? " active" : ""}`} key={name} onClick={() => navigate(name)} type="button">
              {name}
              {name === "Review" && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}
            </button>
          ))}
          <details open={(["Balances", "Import", "Health"] as const).includes(view as "Balances" | "Import" | "Health")}>
            <summary className="nav-group">More</summary>
            {(["Balances", "Import", "Health"] as const).map((name) => (
              <button className={`nav-item${view === name ? " active" : ""}`} key={name} onClick={() => navigate(name)} type="button">
                {name}
                {name === "Health" && healthCount > 0 && <span className="nav-count">{healthCount}</span>}
              </button>
            ))}
          </details>
          <div className="nav-group">Setup</div>
          {(["Accounts", "People", "Rules", "Data", "History"] as const).map((name) => (
            <button className={`nav-item${view === name ? " active" : ""}`} key={name} onClick={() => navigate(name)} type="button">
              {name}
            </button>
          ))}
        </nav>
        <section className="ledger-controls" aria-label="Ledger file">
          <div className="ledger-file-name" title={fileName || "No file open"}>{fileName || "No file open"}</div>
          <div className="ledger-file-actions">
            <button className="secondary" onClick={openLedger} type="button">Open</button>
            <button className="secondary" onClick={() => void saveLedger(true)} type="button">Save as</button>
            <button className="primary" onClick={() => void saveLedger(false)} type="button">Save</button>
          </div>
          <span className="ledger-unsaved" role="status">
            {isSaving ? "Saving…" : hasUnsavedChanges ? autosaveFailures > 0 ? "Not saved · retrying" : "Saving…" : "Saved"}
          </span>
        </section>
      </aside>
      <main className="workspace">
        <div className="workspace-content">
          <input
            ref={uploadInput}
            accept="application/json,.json,.finance.json"
            aria-label="Open ledger JSON file"
            onChange={uploadLedger}
            style={{ display: "none" }}
            type="file"
          />
        {message && <p className="banner success" role="status">{message}</p>}
        {warning && <p className="banner warning" role="status">{warning}</p>}
        {undoState && <p className="banner" role="status">{undoState.label}. <button className="secondary" onClick={undoLastAction} type="button">Undo</button></p>}
        {visibleError && <p className="banner error" role="alert">{visibleError}</p>}
        {reopenPrompt && <p className="banner" role="status">Reopen <strong>{reopenPrompt.fileName}</strong>? <button className="secondary" onClick={() => void reopenRememberedFile()} type="button">Reopen</button></p>}
        {!reopenPrompt && recoveryCopy && <p className="banner" role="status">Recovered unsaved work from {new Date(recoveryCopy.savedAt).toLocaleString()}. <button className="secondary" onClick={useRecoveryCopy} type="button">Use recovered copy</button> <button className="secondary" onClick={() => void discardRecoveryCopy()} type="button">Discard</button></p>}
        {views[view]}
        </div>
      </main>
    </div>
  );
}