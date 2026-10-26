import { parseLedger, stringifyLedger } from "./file-ledger";
import type { Ledger } from "../domain/ledger";

const fileTypes = [
  {
    description: "Finance ledger",
    accept: { "application/json": [".finance.json"] },
  },
];

export type StorageMode = "in-place" | "download";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

type ReopenableFileHandle = FileSystemFileHandle & {
  queryPermission: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
};

export type RecoveryCopy = {
  fileName: string;
  content: string;
  savedAt: string;
};

export function nextAutosaveDelayMs(failedAttempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(failedAttempts, 5));
}

export function getStorageMode(): StorageMode {
  return window.showOpenFilePicker && window.showSaveFilePicker
    ? "in-place"
    : "download";
}

export function isPickerCancellation(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

export class FileStore {
  private handle: FinanceFileHandle | null = null;
  private currentFileName = "";
  private backupDirectory: FileSystemDirectoryHandle | null = null;
  private currentBackupWarning = "";
  private databasePromise: Promise<IDBDatabase | null> | null = null;
  private reopenEnabled = true;
  private recoveryEnabled = true;

  get mode(): StorageMode {
    return getStorageMode();
  }

  get fileName(): string {
    return this.currentFileName;
  }

  get hasOpenFile(): boolean {
    return this.handle !== null;
  }

  get backupSupported(): boolean {
    return typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
  }

  get backupWarning(): string {
    return this.currentBackupWarning;
  }

  async chooseBackupFolder(): Promise<string> {
    if (!this.backupSupported) throw new Error("Backups need Chrome or Edge with folder access support.");
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker!;
    const directory = await picker({ mode: "readwrite" });
    this.backupDirectory = directory;
    this.currentBackupWarning = "";
    return directory.name;
  }

  async openPickedFile(): Promise<{ ledger: Ledger; fileName: string }> {
    if (this.mode !== "in-place" || !window.showOpenFilePicker) {
      throw new Error("Opening a file picker is not supported in this browser.");
    }

    const [handle] = await window.showOpenFilePicker({
      types: fileTypes,
      excludeAcceptAllOption: true,
      multiple: false,
    });
    if (!handle) throw new Error("No file was selected.");

    const file = await handle.getFile();
    const ledger = parseLedger(await file.text());
    this.handle = handle;
    this.currentFileName = handle.name;
    await this.rememberHandle(handle);
    return { ledger, fileName: handle.name };
  }

  async rememberHandle(handle: FinanceFileHandle): Promise<void> {
    if (!this.reopenEnabled) return;
    try {
      const database = await this.database();
      if (!database) return;
      const transaction = database.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, "last");
      await this.transactionComplete(transaction);
    } catch {
      this.reopenEnabled = false;
    }
  }

  async forgetHandle(): Promise<void> {
    if (!this.reopenEnabled) return;
    try {
      const database = await this.database();
      if (!database) return;
      const transaction = database.transaction("handles", "readwrite");
      transaction.objectStore("handles").delete("last");
      await this.transactionComplete(transaction);
    } catch {
      this.reopenEnabled = false;
    }
  }

  async loadRememberedHandle(): Promise<FinanceFileHandle | null> {
    if (!this.reopenEnabled) return null;
    try {
      const database = await this.database();
      if (!database) return null;
      const transaction = database.transaction("handles", "readonly");
      const handle = await this.requestResult<FinanceFileHandle | undefined>(
        transaction.objectStore("handles").get("last"),
      );
      await this.transactionComplete(transaction);
      return handle ?? null;
    } catch {
      this.reopenEnabled = false;
      return null;
    }
  }

  async reopenHandle(handle: FinanceFileHandle): Promise<{ ledger: Ledger; fileName: string }> {
    const reopenable = handle as ReopenableFileHandle;
    let permission = await reopenable.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      permission = await reopenable.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") {
      throw new Error(`Permission to reopen ${handle.name} was not granted.`);
    }
    const file = await handle.getFile();
    const ledger = parseLedger(await file.text());
    this.handle = handle;
    this.currentFileName = handle.name;
    await this.rememberHandle(handle);
    return { ledger, fileName: handle.name };
  }

  async writeRecovery(fileName: string, content: string): Promise<void> {
    if (!this.recoveryEnabled) return;
    try {
      const database = await this.database();
      if (!database) return;
      const recovery: RecoveryCopy = { fileName, content, savedAt: new Date().toISOString() };
      const transaction = database.transaction("recovery", "readwrite");
      transaction.objectStore("recovery").put(recovery, "current");
      await this.transactionComplete(transaction);
    } catch {
      this.recoveryEnabled = false;
    }
  }

  async readRecovery(): Promise<RecoveryCopy | null> {
    if (!this.recoveryEnabled) return null;
    try {
      const database = await this.database();
      if (!database) return null;
      const transaction = database.transaction("recovery", "readonly");
      const recovery = await this.requestResult<RecoveryCopy | undefined>(
        transaction.objectStore("recovery").get("current"),
      );
      await this.transactionComplete(transaction);
      return recovery ?? null;
    } catch {
      this.recoveryEnabled = false;
      return null;
    }
  }

  async clearRecovery(): Promise<void> {
    if (!this.recoveryEnabled) return;
    try {
      const database = await this.database();
      if (!database) return;
      const transaction = database.transaction("recovery", "readwrite");
      transaction.objectStore("recovery").delete("current");
      await this.transactionComplete(transaction);
    } catch {
      this.recoveryEnabled = false;
    }
  }

  async openUploadedFile(file: File): Promise<{ ledger: Ledger; fileName: string }> {
    const ledger = parseLedger(await file.text());
    this.handle = null;
    this.currentFileName = file.name;
    return { ledger, fileName: file.name };
  }

  async save(ledger: Ledger): Promise<string> {
    const contents = stringifyLedger(ledger);
    this.currentBackupWarning = "";
    if (this.mode === "download") {
      const name = this.downloadContents(contents);
      await this.backup(contents);
      return name;
    }
    if (!this.handle) return this.saveAs(ledger);

    await this.write(this.handle, contents);
    await this.backup(contents);
    return this.currentFileName;
  }

  async saveAs(ledger: Ledger): Promise<string> {
    const contents = stringifyLedger(ledger);
    this.currentBackupWarning = "";
    if (this.mode === "download" || !window.showSaveFilePicker) {
      const name = this.downloadContents(contents);
      await this.backup(contents);
      return name;
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: "finance-ledger.finance.json",
      types: fileTypes,
      excludeAcceptAllOption: true,
    });
    await this.write(handle, contents);
    this.handle = handle;
    this.currentFileName = handle.name;
    await this.rememberHandle(handle);
    await this.backup(contents);
    return handle.name;
  }

  private async database(): Promise<IDBDatabase | null> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        try {
          const request = indexedDB.open("financeApp", 1);
          request.onupgradeneeded = () => {
            try {
              const database = request.result;
              if (!database.objectStoreNames.contains("handles")) database.createObjectStore("handles");
              if (!database.objectStoreNames.contains("recovery")) database.createObjectStore("recovery");
            } catch (reason) {
              reject(reason);
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("The local file database is blocked."));
        } catch (reason) {
          reject(reason);
        }
      }).catch(() => {
        this.reopenEnabled = false;
        this.recoveryEnabled = false;
        return null;
      });
    }
    return this.databasePromise;
  }

  private requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private async backup(contents: string): Promise<void> {
    if (!this.backupDirectory) return;
    try {
      const name = this.backupFileName(new Date());
      const handle = await this.backupDirectory.getFileHandle(name, { create: true });
      await this.write(handle, contents);
      const matches: Array<{ name: string; handle: FileSystemFileHandle }> = [];
      for await (const [fileName, entry] of this.backupDirectory.entries()) {
        if (entry.kind === "file" && /^ledger-\d{8}-\d{6}\.finance\.json$/.test(fileName)) {
          matches.push({ name: fileName, handle: entry });
        }
      }
      matches.sort((first, second) => second.name.localeCompare(first.name));
      for (const older of matches.slice(20)) {
        await this.backupDirectory.removeEntry(older.name);
      }
      this.currentBackupWarning = "";
    } catch {
      this.currentBackupWarning = "The ledger was saved, but its folder backup could not be created or cleaned up.";
    }
  }

  private backupFileName(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `ledger-${day}-${time}.finance.json`;
  }

  private async write(handle: FinanceFileHandle, contents: string): Promise<void> {
    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (reason) {
      await writable.abort?.();
      throw reason;
    }
  }

  private downloadContents(contents: string): string {
    const fileName = this.currentFileName || "finance-ledger.finance.json";
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    this.currentFileName = fileName;
    return fileName;
  }
}