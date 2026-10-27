import { useRef, useState } from "react";
import { parseLedger } from "../../adapters/file-ledger";
import type { Ledger } from "../../domain/ledger";
import type { StorageMode } from "../../adapters/file-store";
import { HistoryImportView } from "./HistoryImportView";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface DataViewProps {
  mode: StorageMode;
  onSave: () => void;
  onChooseBackupFolder?: () => void;
  onRestore?: (ledger: Ledger) => void;
  ledger?: Ledger;
  update?: (ledger: Ledger) => void;
}

interface RestorePreview {
  ledger: Ledger;
  fileName: string;
}

export function DataView({ mode, onSave, onChooseBackupFolder, onRestore, ledger, update }: DataViewProps) {
  const backupInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
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
    onRestore(preview.ledger);
    setRestoreOpen(false);
    setPreview(null);
  }

  return (
    <div className="grid min-w-0 gap-6">
      <header><h1 className="text-2xl font-semibold tracking-tight">Data</h1></header>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>{ledger?.categories?.length ?? 0} categories in this ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          {ledger?.categories?.length ? (
            <div className="w-full min-w-0 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Parent</TableHead></TableRow></TableHeader>
                <TableBody>{ledger.categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.name}</TableCell>
                    <TableCell>{ledger.categories?.find((parent) => parent.id === category.parentId)?.name ?? "—"}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No categories in this ledger.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>Save the current ledger as a JSON file.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm">Active storage mode: {mode === "in-place" ? "open and save one local file" : "download and upload JSON"}.</p>
          {mode === "download" && <p className="text-sm text-muted-foreground">Android Chrome uses download and upload because its file picker API is unavailable.</p>}
          <Button className="w-fit" onClick={onSave} type="button">Save JSON</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>The ledger file is unencrypted. Keep it somewhere private and make regular backups.</CardDescription>
        </CardHeader>
        <CardContent className="grid justify-items-start gap-3">
          <Button disabled={!onChooseBackupFolder} onClick={onChooseBackupFolder} type="button" variant="outline">Choose backup folder</Button>
          {!onChooseBackupFolder && <p className="text-sm text-muted-foreground">Backups need Chrome or Edge with folder access support.</p>}
          <Button onClick={() => backupInput.current?.click()} type="button" variant="outline">Restore from backup</Button>
          <input
            ref={backupInput}
            accept="application/json,.json,.finance.json"
            aria-label="Choose a backup file"
            className="sr-only"
            onChange={(event) => void readBackup(event)}
            type="file"
          />
          {preview && (
            <div className="grid w-full gap-3 rounded-md border p-4" aria-label="Backup preview">
              <h2 className="font-medium">{preview.fileName}</h2>
              <p className="text-sm text-muted-foreground">{preview.ledger.entries.length} entries, {(preview.ledger.bankRows ?? []).length} rows, {(preview.ledger.settlements ?? []).length} settlements.</p>
              <Button className="w-fit" onClick={() => setRestoreOpen(true)} type="button">Restore this backup</Button>
              <Button className="w-fit" onClick={() => setPreview(null)} type="button" variant="outline">Cancel</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview && `Restore ${preview.fileName}? This backup contains ${preview.ledger.entries.length} entries, ${(preview.ledger.bankRows ?? []).length} rows, and ${(preview.ledger.settlements ?? []).length} settlements.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>Restore backup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {import.meta.env.DEV && ledger && update && <HistoryImportView ledger={ledger} update={update} />}
    </div>
  );
}
