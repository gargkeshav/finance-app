import { useRef, useState } from "react";
import { parseLedger } from "../../adapters/file-ledger";
import type { Ledger } from "../../domain/ledger";
import type { StorageMode } from "../../adapters/file-store";

interface DataViewProps {
  mode: StorageMode;
  onSave: () => void;
  onChooseBackupFolder?: () => void;
  onRestore?: (ledger: Ledger) => void;
}

interface RestorePreview {
  ledger: Ledger;
  fileName: string;
}

export function DataView({ mode, onSave, onChooseBackupFolder, onRestore }: DataViewProps) {
  const backupInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [error, setError] = useState("");

  async function readBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    setPreview(null);
    if (!file) return;
    try {
      setPreview({ ledger: parseLedger(await file.text()), fileName: file.name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The backup file could not be opened.");
    }
  }

  function confirmRestore() {
    if (!preview || !onRestore) return;
    const { ledger, fileName } = preview;
    const confirmed = window.confirm(
      `Restore ${fileName}? This backup contains ${ledger.entries.length} entries, ${(ledger.bankRows ?? []).length} rows, and ${(ledger.settlements ?? []).length} settlements.`,
    );
    if (confirmed) onRestore(ledger);
  }

  return (
    <>
      <header className="page-heading">
        <h1>Data</h1>
        <button className="primary" onClick={onSave} type="button">Save JSON</button>
      </header>
      <section className="form-grid">
        <p>Active storage mode: {mode === "in-place" ? "open and save one local file" : "download and upload JSON"}.</p>
        <p>The ledger file is unencrypted. Keep it somewhere private and make regular backups.</p>
        <div>
          <button className="secondary" onClick={onChooseBackupFolder} type="button" disabled={!onChooseBackupFolder}>
            Choose backup folder
          </button>
          {!onChooseBackupFolder && <p className="hint">Backups need Chrome or Edge with folder access support.</p>}
        </div>
        <div>
          <button className="secondary" onClick={() => backupInput.current?.click()} type="button">Restore from backup</button>
          <input
            ref={backupInput}
            accept="application/json,.json,.finance.json"
            aria-label="Choose a backup file"
            onChange={(event) => void readBackup(event)}
            style={{ display: "none" }}
            type="file"
          />
        </div>
        {error && <p className="banner error" role="alert">{error}</p>}
        {preview && (
          <section className="card" aria-label="Backup preview">
            <h2>{preview.fileName}</h2>
            <p>{preview.ledger.entries.length} entries, {(preview.ledger.bankRows ?? []).length} rows, {(preview.ledger.settlements ?? []).length} settlements.</p>
            <div className="dialog-actions">
              <button className="primary" onClick={confirmRestore} type="button">Restore this backup</button>
              <button className="secondary" onClick={() => setPreview(null)} type="button">Cancel</button>
            </div>
          </section>
        )}
      </section>
    </>
  );
}