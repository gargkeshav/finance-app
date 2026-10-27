import { useState } from "react";
import {
  BANK_PRESETS,
  findNewRows,
  parseWithMapping,
  suggestPresets,
  type CsvMapping,
} from "../../adapters/csv-mapping";
import type { BankRow, Ledger, LedgerImport } from "../../domain/ledger";
import { formatMoney } from "../../domain/value";
import { MappingEditor } from "./MappingEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const stepFourComplete = Boolean(parsed && !parsed.errors.length && !sameFile && (duplicateCount === 0 || duplicateChoice !== null));

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

  async function processFile(file: File | undefined) {
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

  async function loadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await processFile(file);
  }

  function dropFile(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void processFile(event.dataTransfer.files[0]);
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
    <div className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Import CSV</h1>
        <Button disabled={!stepFourComplete} onClick={commit} type="button">Import {rowsToAdd.length} rows</Button>
      </header>
      {message && <p className="text-sm text-positive" role="status">{message}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Choose a CSV file</CardTitle>
          <CardDescription>Select an account, then drop a CSV here or browse for it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Account
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={accountId} onChange={(event) => changeAccount(event.target.value)} required>
              <option value="">Choose an account</option>
              {ledger.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label
            className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-center text-sm hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring"
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropFile}
          >
            <span className="font-medium">Drop a CSV file here or choose a file</span>
            <input accept=".csv,text/csv" className="sr-only" onChange={(event) => void loadFile(event)} type="file" />
            {fileName && <span className="mt-1 text-muted-foreground">{fileName}</span>}
          </label>
        </CardContent>
      </Card>
      {text && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Column mapping</CardTitle>
                <CardDescription>Choose how this file's columns map to bank rows.</CardDescription>
              </div>
              <Button onClick={() => setShowMappingEditor(true)} type="button" variant="outline">New format</Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid max-w-md gap-2 text-sm font-medium">
              Format
              <Select value={mappingId} onValueChange={(value) => value && chooseMapping(value)}>
                <SelectTrigger aria-label="Format"><SelectValue placeholder="Choose a format" /></SelectTrigger>
                <SelectContent>
                  {mappingOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}{option.suggested ? " · Suggested" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {selectedMapping && <Badge variant="secondary">Ready to preview</Badge>}
          </CardContent>
        </Card>
      )}
      <Sheet open={showMappingEditor} onOpenChange={setShowMappingEditor}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader><SheetTitle>New format</SheetTitle></SheetHeader>
          {text && <MappingEditor initialMapping={selectedMapping} onCancel={() => setShowMappingEditor(false)} onSave={saveMappingChoice} text={text} />}
        </SheetContent>
      </Sheet>
      {parsed && (
        <Card>
          <CardHeader>
            <CardTitle>Preview rows</CardTitle>
            <CardDescription>{newRows.length} new, {duplicateCount} already imported.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {sameFile && <p className="text-sm text-warning">This file has already been imported for this account. No rows were added.</p>}
            <label className="flex items-center gap-2 text-sm">
              <input checked={olderHistory} onChange={(event) => setOlderHistory(event.target.checked)} type="checkbox" />
              Older history: keep out of balances
            </label>
            <p className="text-sm text-muted-foreground">Use this for old statements. The rows appear in reports but do not change who owes what.</p>
            {duplicateCount > 0 && <fieldset className="grid gap-2 rounded-md border p-4">
              <legend className="px-1 text-sm font-medium">{duplicateCount} already imported. Choose whether to skip or add these rows again.</legend>
              <label className="flex items-center gap-2 text-sm"><input checked={duplicateChoice === "skip"} onChange={() => setDuplicateChoice("skip")} type="radio" />Skip existing rows</label>
              <label className="flex items-center gap-2 text-sm"><input checked={duplicateChoice === "add"} onChange={() => setDuplicateChoice("add")} type="radio" />Add them anyway</label>
            </fieldset>}
            {parsed.errors.length > 0 && <div className="rounded-md border border-destructive/50 p-4 text-sm text-destructive" role="alert">
              <strong>Errors ({parsed.errors.length})</strong>
              <ul className="mt-2 list-disc pl-5">{parsed.errors.map((rowError, index) => <li key={`${rowError.line}-${index}`}>Line {rowError.line}: {rowError.message}</li>)}</ul>
            </div>}
            <div className="w-full min-w-0 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Line</TableHead><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>{parsed.rows.slice(0, 20).map((row) => <TableRow key={`${row.line}-${row.date}`}>
                  <TableCell>{row.line}</TableCell><TableCell className="whitespace-nowrap">{row.date}</TableCell><TableCell>{row.description}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(row.amountCents)}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
              {!parsed.rows.length && <p className="p-4 text-sm text-muted-foreground">No valid rows to preview.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}