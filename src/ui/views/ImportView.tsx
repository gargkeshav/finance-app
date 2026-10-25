import { useState } from "react";
import {
  BANK_PRESETS,
  findNewRows,
  parseWithMapping,
  suggestPresets,
  type CsvMapping,
} from "../../adapters/csv-mapping";
import type { BankRow, Ledger, LedgerImport } from "../../domain/ledger";
import { formatAud } from "../../domain/value";
import { MappingEditor } from "./MappingEditor";

interface ImportViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
}

type DuplicateChoice = "skip" | "add";

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ImportView({ ledger, update }: ImportViewProps) {
  const [accountId, setAccountId] = useState(ledger.accounts[0]?.id ?? "");
  const [mappingId, setMappingId] = useState(() =>
    ledger.accounts.find((account) => account.id === ledger.accounts[0]?.id)?.mappingId ?? "",
  );
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [contentHash, setContentHash] = useState("");
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [olderHistory, setOlderHistory] = useState(false);
  const [duplicateChoice, setDuplicateChoice] = useState<DuplicateChoice | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const account = ledger.accounts.find((item) => item.id === accountId);
  const mappings = ledger.mappings ?? [];
  const imports = ledger.imports ?? [];
  const bankRows = ledger.bankRows ?? [];
  const selectedMapping = mappings.find((mapping) => mapping.id === mappingId) ??
    BANK_PRESETS.find((mapping) => mapping.id === mappingId) ??
    BANK_PRESETS.find((mapping) => mapping.name === mappingId);
  const parsed = text && selectedMapping ? parseWithMapping(text, selectedMapping) : null;
  const accountImports = imports.filter((item) => item.accountId === accountId);
  const sameFile = Boolean(contentHash && accountImports.some((item) => item.contentHash === contentHash));
  const existingRows = bankRows.filter((row) => row.accountId === accountId);
  const newRows = parsed ? findNewRows(existingRows, parsed.rows) : [];
  const duplicateCount = parsed ? parsed.rows.length - newRows.length : 0;
  const rowsToAdd = duplicateChoice === "add" ? parsed?.rows ?? [] : newRows;

  function saveMappingChoice(mapping: CsvMapping) {
    const nextMappings = mappings.some((item) => item.id === mapping.id)
      ? mappings.map((item) => item.id === mapping.id ? mapping : item)
      : [...mappings, mapping];
    update({
      ...ledger,
      mappings: nextMappings,
      accounts: ledger.accounts.map((item) => item.id === accountId
        ? { ...item, mappingId: mapping.id }
        : item),
    });
    setMappingId(mapping.id);
    setShowMappingEditor(false);
    setMessage("Mapping saved to account.");
    setError("");
  }

  function chooseMapping(id: string) {
    setMappingId(id);
    setDuplicateChoice(null);
    setMessage("");
    setError("");
  }

  async function loadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("");
    setError("");
    setDuplicateChoice(null);
    try {
      const contents = await file.text();
      setText(contents);
      setFileName(file.name);
      setContentHash(await sha256(contents));
      setSuggestedNames(suggestPresets(contents));
    } catch (reason) {
      setText("");
      setContentHash("");
      setError(reason instanceof Error ? reason.message : "The CSV could not be read.");
    }
  }

  function changeAccount(nextAccountId: string) {
    setAccountId(nextAccountId);
    setMappingId(ledger.accounts.find((item) => item.id === nextAccountId)?.mappingId ?? "");
    setDuplicateChoice(null);
    setMessage("");
  }

  function commit() {
    if (!account || !selectedMapping || !parsed || parsed.errors.length || sameFile) return;
    if (duplicateCount > 0 && duplicateChoice === null) return;
    const now = new Date().toISOString();
    const chosenRows = rowsToAdd;
    const allParsedRows = parsed.rows;
    const importRecord: LedgerImport = {
      id: crypto.randomUUID(),
      accountId,
      mappingId: selectedMapping.id,
      fileName,
      contentHash,
      dateFrom: allParsedRows.length ? allParsedRows.reduce((earliest, row) => row.date < earliest ? row.date : earliest, allParsedRows[0].date) : null,
      dateTo: allParsedRows.length ? allParsedRows.reduce((latest, row) => row.date > latest ? row.date : latest, allParsedRows[0].date) : null,
      countsTowardDebt: !olderHistory,
      importedAt: now,
      updatedAt: now,
    };
    const addedRows: BankRow[] = chosenRows.map((row) => ({
      id: crypto.randomUUID(),
      accountId,
      importId: importRecord.id,
      line: row.line,
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      balanceCents: row.balanceCents,
      raw: row.raw,
      entryId: null,
      settlementId: null,
      skipped: false,
      dismissedTransferIds: [],
      updatedAt: now,
    }));
    const nextMappings = mappings.some((item) => item.id === selectedMapping.id)
      ? mappings
      : [...mappings, selectedMapping];
    update({
      ...ledger,
      mappings: nextMappings,
      accounts: ledger.accounts.map((item) => item.id === accountId
        ? { ...item, mappingId: selectedMapping.id }
        : item),
      imports: [...imports, importRecord],
      bankRows: [...bankRows, ...addedRows],
    });
    setMessage(`Import complete: ${addedRows.length} row${addedRows.length === 1 ? "" : "s"} added.`);
    setError("");
    setText("");
    setFileName("");
    setContentHash("");
    setDuplicateChoice(null);
    setOlderHistory(false);
  }

  const presetOptions = BANK_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    suggested: suggestedNames.includes(preset.name),
  })).sort((first, second) => Number(second.suggested) - Number(first.suggested));
  const mappingOptions = [
    ...presetOptions,
    ...mappings.filter((mapping) => !BANK_PRESETS.some((preset) => preset.id === mapping.id))
      .map((mapping) => ({ id: mapping.id, name: mapping.name, suggested: false })),
  ];

  return (
    <>
      <header className="page-heading">
        <h1>Import CSV</h1>
        <button className="primary" disabled={!account || !selectedMapping || !parsed || parsed.errors.length > 0 || sameFile || (duplicateCount > 0 && duplicateChoice === null)} onClick={commit} type="button">Import rows</button>
      </header>
      {message && <p className="banner success" role="status">{message}</p>}
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="form-grid">
        <label>
          Account
          <select value={accountId} onChange={(event) => changeAccount(event.target.value)} required>
            <option value="">Choose an account</option>
            {ledger.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          CSV file
          <input accept=".csv,text/csv" onChange={(event) => void loadFile(event)} type="file" />
        </label>
        {text && (
          <>
            <label>
              Mapping
              <select value={mappingId} onChange={(event) => chooseMapping(event.target.value)}>
                <option value="">Choose a mapping</option>
                {mappingOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.suggested ? " (Suggested)" : ""}</option>)}
              </select>
            </label>
            <button className="secondary" onClick={() => setShowMappingEditor(true)} type="button">New mapping</button>
          </>
        )}
      </div>
      {showMappingEditor && text && (
        <MappingEditor
          initialMapping={selectedMapping}
          onCancel={() => setShowMappingEditor(false)}
          onSave={saveMappingChoice}
          text={text}
        />
      )}
      {sameFile && <p className="banner">This file has already been imported for this account. No rows were added.</p>}
      {parsed && !sameFile && (
        <>
          <label className="checkbox-label">
            <input checked={olderHistory} onChange={(event) => setOlderHistory(event.target.checked)} type="checkbox" />
            Older history: keep out of balances
          </label>
          {duplicateCount > 0 && (
            <fieldset className="filters">
              <legend>{duplicateCount} existing row{duplicateCount === 1 ? "" : "s"} found</legend>
              <label className="checkbox-label">
                <input checked={duplicateChoice === "skip"} onChange={() => setDuplicateChoice("skip")} type="radio" />
                Skip {duplicateCount} existing rows
              </label>
              <label className="checkbox-label">
                <input checked={duplicateChoice === "add"} onChange={() => setDuplicateChoice("add")} type="radio" />
                Add them anyway
              </label>
            </fieldset>
          )}
          {parsed.errors.length > 0 && (
            <section aria-label="CSV row errors">
              <h2>Errors ({parsed.errors.length})</h2>
              <ul>{parsed.errors.map((rowError, index) => <li key={`${rowError.line}-${index}`}>Line {rowError.line}: {rowError.message}</li>)}</ul>
            </section>
          )}
          <div className="table-scroll">
            <table>
              <thead><tr><th>Line</th><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
              <tbody>
                {(parsed.rows.slice(0, 20)).map((row) => (
                  <tr key={`${row.line}-${row.date}`}>
                    <td>{row.line}</td>
                    <td className="date-cell">{row.date}</td>
                    <td>{row.description}</td>
                    <td className="amount">{formatAud(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!parsed.rows.length && <p className="empty-state compact">No valid rows to preview.</p>}
          </div>
        </>
      )}
    </>
  );
}