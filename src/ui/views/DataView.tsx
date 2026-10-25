import type { StorageMode } from "../../adapters/file-store";

interface DataViewProps {
  mode: StorageMode;
  onSave: () => void;
}

export function DataView({ mode, onSave }: DataViewProps) {
  return (
    <>
      <header className="page-heading">
        <h1>Data</h1>
        <button className="primary" onClick={onSave} type="button">Save JSON</button>
      </header>
      <section className="form-grid">
        <p>Active storage mode: {mode === "in-place" ? "open and save one local file" : "download and upload JSON"}.</p>
        <p>The ledger file is unencrypted. Keep it somewhere private and make regular backups.</p>
      </section>
    </>
  );
}