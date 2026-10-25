import { parseLedger, stringifyLedger } from "./file-ledger";
import type { Ledger } from "../domain/ledger";

const fileTypes = [
  {
    description: "Finance ledger",
    accept: { "application/json": [".finance.json"] },
  },
];

export type StorageMode = "in-place" | "download";

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

  get mode(): StorageMode {
    return getStorageMode();
  }

  get fileName(): string {
    return this.currentFileName;
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
    if (this.mode === "download") return this.download(ledger);
    if (!this.handle) return this.saveAs(ledger);

    await this.write(this.handle, stringifyLedger(ledger));
    return this.currentFileName;
  }

  async saveAs(ledger: Ledger): Promise<string> {
    const contents = stringifyLedger(ledger);
    if (this.mode === "download" || !window.showSaveFilePicker) {
      return this.downloadContents(contents);
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: "finance-ledger.finance.json",
      types: fileTypes,
      excludeAcceptAllOption: true,
    });
    await this.write(handle, contents);
    this.handle = handle;
    this.currentFileName = handle.name;
    return handle.name;
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

  private download(ledger: Ledger): string {
    return this.downloadContents(stringifyLedger(ledger));
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