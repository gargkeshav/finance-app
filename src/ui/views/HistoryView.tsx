import type { ChangeSet } from "../../domain/history";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";

interface HistoryViewProps {
  history: ChangeSet[];
  onRevert: () => void;
}

function changeSummary(change: ChangeSet): string {
  const counts = new Map<string, { changed: number; added: number; removed: number }>();
  for (const record of change.records) {
    const count = counts.get(record.collection) ?? { changed: 0, added: 0, removed: 0 };
    if (record.before === null) count.added += 1;
    else if (record.after === null) count.removed += 1;
    else count.changed += 1;
    counts.set(record.collection, count);
  }

  return [...counts.entries()].map(([collection, count]) => {
    const details = [
      count.changed > 0 ? `${count.changed} changed` : "",
      count.added > 0 ? `${count.added} added` : "",
      count.removed > 0 ? `${count.removed} removed` : "",
    ].filter(Boolean).join(", ");
    return `${collection}: ${details}`;
  }).join("; ");
}

export function HistoryView({ history, onRevert }: HistoryViewProps) {
  const newestFirst = [...history].reverse();
  const [confirmRevert, setConfirmRevert] = useState(false);
  const latest = newestFirst[0];

  return (
    <div className="mx-auto grid min-w-0 gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">A record of changes made to this ledger. Only the latest change can be reverted.</p>
        </div>
        {latest && <Button onClick={() => setConfirmRevert(true)} type="button">Revert latest change</Button>}
      </header>
      <Card>
        <CardHeader><CardTitle>Changes</CardTitle><CardDescription>Recent labelled changes to this ledger.</CardDescription></CardHeader>
        <CardContent>
          {newestFirst.length === 0 ? <p className="text-sm text-muted-foreground">Labelled changes will appear here.</p> : (
            <>
              <div className="hidden w-full min-w-0 overflow-x-auto rounded-md border sm:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>By</TableHead><TableHead>Change</TableHead><TableHead>Records</TableHead></TableRow></TableHeader>
                  <TableBody>{newestFirst.map((change) => (
                    <TableRow key={change.id}>
                      <TableCell className="whitespace-nowrap">{new Date(change.at).toLocaleString()}</TableCell>
                      <TableCell>{change.actor}</TableCell>
                      <TableCell>{change.reason}</TableCell>
                      <TableCell>{changeSummary(change)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
              <ul className="grid gap-3 sm:hidden">
                {newestFirst.map((change) => (
                  <li className="grid gap-2 rounded-md border p-3" key={change.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-medium">{change.reason}</h3>
                      <span className="text-xs text-muted-foreground">{change.actor}</span>
                    </div>
                    <time className="text-sm text-muted-foreground" dateTime={change.at}>{new Date(change.at).toLocaleString()}</time>
                    <p className="text-sm">{changeSummary(change)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      <AlertDialog open={confirmRevert} onOpenChange={setConfirmRevert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert the latest change?</AlertDialogTitle>
            <AlertDialogDescription>{latest && `Revert "${latest.reason}"?`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onRevert(); setConfirmRevert(false); }}>Revert</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}