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
    <div className="grid min-w-0 gap-6">
      <header><h1 className="text-2xl font-semibold tracking-tight">History</h1></header>
      <Card>
        <CardHeader><CardTitle>Changes</CardTitle><CardDescription>Recent labelled changes to this ledger.</CardDescription></CardHeader>
        <CardContent>
          {newestFirst.length === 0 ? <p className="text-sm text-muted-foreground">Labelled changes will appear here.</p> : (
            <div className="w-full min-w-0 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>By</TableHead><TableHead>Change</TableHead><TableHead>Records</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{newestFirst.map((change, index) => (
                  <TableRow key={change.id}>
                    <TableCell className="whitespace-nowrap">{new Date(change.at).toLocaleString()}</TableCell>
                    <TableCell>{change.actor}</TableCell>
                    <TableCell>{change.reason}</TableCell>
                    <TableCell>{changeSummary(change)}</TableCell>
                    <TableCell>{index === 0 && <Button onClick={() => setConfirmRevert(true)} type="button" variant="outline">Revert</Button>}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
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