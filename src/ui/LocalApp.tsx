import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Banknote,
  ChartNoAxesCombined,
  ClipboardCheck,
  Database,
  FileClock,
  FileInput,
  HeartPulse,
  House,
  Landmark,
  ListChecks,
  Search,
  Users,
} from "lucide-react";
import { FileStore, isPickerCancellation, nextAutosaveDelayMs } from "../adapters/file-store";
import { emptyLedger, ledgerProblem, parseLedger, stringifyLedger } from "../adapters/file-ledger";
import { categoryMemoryKey, type Account, type BankRow, type Baseline, type Entry, type Entity, type Ledger, type Settlement } from "../domain/ledger";
import type { EntryRule } from "../domain/rules";
import { firstRule } from "../domain/rules";
import { existingEntryFor, isWaitingOnOtherAccount, suggestTransfers } from "../domain/transfers";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type ViewName = "Home" | "Activity" | "Import" | "Review" | "Settle" | "Accounts" | "People" | "Balances" | "Reports" | "Data" | "Rules" | "Health" | "History";
const knownViews: ViewName[] = ["Home", "Activity", "Import", "Review", "Settle", "Accounts", "People", "Balances", "Reports", "Data", "Rules", "Health", "History"];
type RecordWithTimestamp = { id: string; updatedAt: string };

const navigationGroups = [
  {
    label: "Daily",
    items: [
      { name: "Home", icon: House },
      { name: "Review", icon: ClipboardCheck },
      { name: "Activity", icon: Activity },
      { name: "Settle", icon: Banknote },
    ],
  },
  {
    label: "Money",
    items: [
      { name: "Accounts", icon: Landmark },
      { name: "People", icon: Users },
      { name: "Balances", icon: Banknote },
      { name: "Reports", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Setup",
    items: [
      { name: "Import", icon: FileInput },
      { name: "Rules", icon: ListChecks },
      { name: "Data", icon: Database },
      { name: "History", icon: FileClock },
      { name: "Health", icon: HeartPulse },
    ],
  },
] as const;

function SidebarNavigation({
  view,
  reviewCount,
  healthCount,
  navigate,
}: {
  view: ViewName;
  reviewCount: number;
  healthCount: number;
  navigate: (view: ViewName) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarContent>
      {navigationGroups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map(({ name, icon: Icon }) => (
                <SidebarMenuItem key={name}>
                  <SidebarMenuButton
                    isActive={view === name}
                    onClick={() => {
                      navigate(name);
                      if (isMobile) setOpenMobile(false);
                    }}
                    tooltip={name}
                  >
                    <Icon />
                    <span>{name}</span>
                  </SidebarMenuButton>
                  {name === "Review" && reviewCount > 0 && <SidebarMenuBadge>{reviewCount}</SidebarMenuBadge>}
                  {name === "Health" && healthCount > 0 && <SidebarMenuBadge>{healthCount}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}

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
  const [commandOpen, setCommandOpen] = useState(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [activityAddSpendRequest, setActivityAddSpendRequest] = useState(0);
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
  const replaceLedgerAction = useRef<(() => void) | null>(null);
  let currentContent = "";
  let serializationError = "";
  try {
    currentContent = stringifyLedger(ledger);
  } catch (reason) {
    serializationError = reason instanceof Error ? reason.message : "The ledger cannot be saved.";
  }
  const hasUnsavedChanges = Boolean(serializationError) || currentContent !== savedContent;
  const visibleError = serializationError || error;
  const pendingReviewRows = (ledger.bankRows ?? []).filter(
    (row) => !row.entryId && !row.settlementId && !row.skipped,
  );
  const pairedReviewTransfers = suggestTransfers(ledger);
  const reviewCount = pendingReviewRows.filter((row) => {
    if (existingEntryFor(ledger, row)) return false;
    const rule = firstRule(ledger.rules ?? [], row, ledger.accounts.find((account) => account.id === row.accountId));
    const memoryApplies = ledger.categoryMemory?.some((memory) => memory.key === categoryMemoryKey(row.accountId, row.description));
    return Boolean(rule || memoryApplies || !isWaitingOnOtherAccount(ledger, row, pairedReviewTransfers));
  }).length;
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
    toast.success(message);
    setMessage("");
  }, [message]);

  useEffect(() => {
    if (!warning) return;
    toast.warning(warning);
    setWarning("");
  }, [warning]);

  useEffect(() => {
    if (!visibleError) return;
    toast.error(visibleError);
  }, [visibleError]);

  useEffect(() => {
    if (!undoState) return;
    toast(undoState.label, {
      duration: 10_000,
      action: { label: "Undo", onClick: undoLastAction },
    });
  }, [undoState]);

  useEffect(() => {
    function openCommand(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", openCommand);
    return () => window.removeEventListener("keydown", openCommand);
  }, []);

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
    const undoable = actionLabel === "Record settlement" || /^(Delete|Archive|Skip|Bulk)/.test(actionLabel ?? "");
    if (actionLabel && undoable) {
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
      if (!actionLabel) return stamped;
      const changeSet = buildChangeSet(previous, stamped, actionLabel, actor);
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

  function requestReplaceLedger(action: () => void) {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    replaceLedgerAction.current = action;
    setConfirmReplaceOpen(true);
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

  async function performOpenLedger() {
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

  function openLedger() {
    requestReplaceLedger(() => { void performOpenLedger(); });
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
    requestReplaceLedger(() => acceptOpenedLedger({ ledger: restoredLedger, fileName: fileStore.fileName || "Restored backup" }));
  }

  const views = {
    Home: <HomeView ledger={ledger} healthIssues={healthIssues} reviewCount={reviewCount} openActivity={openActivity} onOpenEntity={openEntity} onNavigate={navigate} />,
    Import: <ImportView ledger={ledger} update={update} />,
    Review: <ReviewView ledger={ledger} update={update} onSettle={(row) => { setSettlementRow(row); navigate("Settle"); }} onCreateRule={(description) => { setRuleDescription(description); navigate("Rules"); }} />,
    Activity: <ActivityView
      ledger={ledger}
      update={update}
      saveNow={saveNow}
      activityFilter={activityFilter}
      openActivity={openActivity}
      onNavigate={navigate}
      addSpendRequest={activityAddSpendRequest}
    />,
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

  const saveStatus = isSaving
    ? "Saving…"
    : hasUnsavedChanges
      ? autosaveFailures > 0
        ? "Not saved · retrying"
        : fileStore.mode === "in-place" && fileStore.hasOpenFile
          ? "Saving…"
          : "Not saved"
      : "Saved";

  function runCommand(action: () => void) {
    setCommandOpen(false);
    action();
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-2 font-semibold">
            <House className="size-5" />
            <span>Finance</span>
          </div>
        </SidebarHeader>
        <SidebarNavigation view={view} reviewCount={reviewCount} healthCount={healthCount} navigate={navigate} />
        <SidebarFooter>
          <section aria-label="Ledger file" className="flex min-w-0 flex-col gap-2">
            <div className="truncate text-sm" title={fileName || "No file open"}>{fileName || "No file open"}</div>
            <span className="text-xs text-muted-foreground" role="status">{saveStatus}</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button className="w-full justify-start" variant="outline" />}>
                Ledger file actions
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={openLedger}>Open</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void saveLedger(false)}>Save</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void saveLedger(true)}>Save as</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </section>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger aria-label="Toggle navigation" />
          <span className="font-medium">{view}</span>
          <div className="ml-auto">
            <Button aria-label="Search ⌘K" onClick={() => setCommandOpen(true)} variant="outline">
              <Search />
              <span>Search</span>
              <Kbd className="bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">⌘K</Kbd>
            </Button>
          </div>
        </header>
        <main className="min-w-0 p-4 md:p-6">
          <input
            ref={uploadInput}
            accept="application/json,.json,.finance.json"
            aria-label="Open ledger JSON file"
            onChange={uploadLedger}
            className="sr-only"
            type="file"
          />
          {reopenPrompt && (
            <Alert className="mb-4">
              <AlertTitle>Reopen ledger</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                Reopen {reopenPrompt.fileName}?
                <Button onClick={() => void reopenRememberedFile()} size="sm" type="button">Reopen</Button>
              </AlertDescription>
            </Alert>
          )}
          {!reopenPrompt && recoveryCopy && (
            <Alert className="mb-4">
              <AlertTitle>Recovered unsaved work</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                A copy saved {new Date(recoveryCopy.savedAt).toLocaleString()} is available.
                <Button onClick={useRecoveryCopy} size="sm" type="button">Use recovered copy</Button>
                <Button onClick={() => void discardRecoveryCopy()} size="sm" variant="outline" type="button">Discard</Button>
              </AlertDescription>
            </Alert>
          )}
          {views[view]}
        </main>
      </SidebarInset>
      <Toaster />
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Command palette">
        <Command>
          <CommandInput aria-label="Search views and actions" placeholder="Search views and actions..." />
          <CommandList>
            <CommandEmpty>No matching commands.</CommandEmpty>
            <CommandGroup heading="Go to">
              {knownViews.map((name) => (
                <CommandItem key={name} value={`Go to ${name}`} onSelect={() => runCommand(() => navigate(name))}>
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem value="Add spend" onSelect={() => runCommand(() => {
                setActivityAddSpendRequest((request) => request + 1);
                navigate("Activity");
              })}>Add spend</CommandItem>
              <CommandItem value="Open file" onSelect={() => runCommand(openLedger)}>Open file</CommandItem>
              <CommandItem value="Save" onSelect={() => runCommand(() => void saveLedger(false))}>Save</CommandItem>
              <CommandItem value="Import CSV" onSelect={() => runCommand(() => navigate("Import"))}>Import CSV</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Opening another ledger will replace your unsaved changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { replaceLedgerAction.current = null; }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const action = replaceLedgerAction.current;
              replaceLedgerAction.current = null;
              setConfirmReplaceOpen(false);
              action?.();
            }}>Discard and continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}