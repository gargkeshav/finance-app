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

  get mode(): StorageMode {
    return getStorageMode();
  }

  get fileName(): string {
    return this.currentFileName;
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
    return { ledger, fileName: handle.name };
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
    await this.backup(contents);
    return handle.name;
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