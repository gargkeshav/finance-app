import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountCoverage, checkpointDifferences, HOUSE_ENTITY_ID, type Account, type BalanceCheckpoint, type Ledger } from "../../domain/ledger";
import { formatMoney, isBankDate, parseAud } from "../../domain/value";
import { cardPaymentCheck } from "../../domain/transfers";
import type { EntryFilter } from "../../domain/query";

interface AccountsViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  openActivity: (filter: EntryFilter) => void;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function AccountsView({ ledger, update, openActivity }: AccountsViewProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("asset");
  const [payerEntityId, setPayerEntityId] = useState("self");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [checkpointAccountId, setCheckpointAccountId] = useState<string | null>(null);
  const [checkpointDate, setCheckpointDate] = useState("");
  const [checkpointBalance, setCheckpointBalance] = useState("");
  const [checkpointNote, setCheckpointNote] = useState("");
  const [error, setError] = useState("");

  function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter an account name.");
      return;
    }

    if (editingId) {
      update({
        ...ledger,
        accounts: ledger.accounts.map((account) =>
          account.id === editingId ? { ...account, name: trimmedName } : account,
        ),
      });
    } else {
      const account: Account = {
        id: crypto.randomUUID(),
        name: trimmedName,
        type,
        payerEntityId,
        updatedAt: new Date().toISOString(),
      };
      update({ ...ledger, accounts: [...ledger.accounts, account] });
    }
    setName("");
    setEditingId(null);
    setError("");
    setAccountDialogOpen(false);
  }

  function editAccount(account: Account) {
    setEditingId(account.id);
    setName(account.name);
    setType(account.type);
    setPayerEntityId(account.payerEntityId);
    setError("");
    setAccountDialogOpen(true);
  }

  function saveCheckpoint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let balanceCents: number;
    try {
      balanceCents = parseAud(checkpointBalance);
    } catch {
      setError("Enter a valid checkpoint balance.");
      return;
    }
    if (!checkpointAccountId || !isBankDate(checkpointDate)) {
      setError("Enter a valid checkpoint date.");
      return;
    }
    const isCard = ledger.accounts.find((account) => account.id === checkpointAccountId)?.type === "credit";
    const checkpoint: BalanceCheckpoint = {
      id: crypto.randomUUID(),
      accountId: checkpointAccountId,
      date: checkpointDate,
      // Cards are entered as the amount owed and stored like bank rows, negative when owed.
      balanceCents: isCard ? -balanceCents : balanceCents,
      note: checkpointNote.trim(),
      updatedAt: new Date().toISOString(),
    };
    update({ ...ledger, checkpoints: [...(ledger.checkpoints ?? []), checkpoint] });
    setCheckpointAccountId(null);
    setCheckpointDate("");
    setCheckpointBalance("");
    setCheckpointNote("");
    setError("");
  }

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Accounts</h1>
        <Button
          onClick={() => {
            setEditingId(null);
            setName("");
            setType("asset");
            setPayerEntityId("self");
            setError("");
            setAccountDialogOpen(true);
          }}
          type="button"
        >
          Add account
        </Button>
      </header>

      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Rename account" : "Add account"}</DialogTitle>
            <DialogDescription>{editingId ? "Change the display name for this account." : "Add an asset or credit account to your ledger."}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={saveAccount}>
            <div className="grid gap-2"><Label htmlFor="account-name">Name</Label><Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
            {!editingId && <>
              <div className="grid gap-2"><Label htmlFor="account-type">Type</Label><Select value={type} onValueChange={(value) => setType(value as Account["type"])}>
                <SelectTrigger id="account-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="asset">Asset</SelectItem><SelectItem value="credit">Credit</SelectItem></SelectContent>
              </Select></div>
              <div className="grid gap-2"><Label htmlFor="account-payer">Paid by</Label>
                <Combobox value={payerEntityId} onValueChange={(value) => setPayerEntityId(value ?? "")}>
                  <ComboboxInput id="account-payer" placeholder="Choose a payer" />
                  <ComboboxContent>
                    <ComboboxEmpty>No matching people.</ComboboxEmpty>
                    <ComboboxList>
                      {ledger.entities.filter((entity) => !entity.archived && (entity.kind === "self" || entity.kind === "house" || entity.kind === "person")).map((entity) => (
                        <ComboboxItem key={entity.id} value={entity.id}>{entity.kind === "self" ? "You" : entity.name}</ComboboxItem>
                      ))}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
            </>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAccountDialogOpen(false)} type="button">Cancel</Button>
              <Button type="submit">{editingId ? "Rename account" : "Add account"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader className="bg-card"><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Name</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Type</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Paid by</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Coverage</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Balance checkpoints</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold" /></TableRow></TableHeader>
          <TableBody>
            {ledger.accounts.map((account) => {
              const payer = ledger.entities.find((entity) => entity.id === account.payerEntityId);
              const coverage = accountCoverage(ledger, account.id);
              const differences = checkpointDifferences(ledger, account.id);
              return (
                <TableRow key={account.id}>
                  <TableCell><Button variant="link" className="h-auto p-0" onClick={() => openActivity({ accountId: account.id })} type="button">{account.name}</Button></TableCell>
                  <TableCell>{account.type === "asset" ? "Asset" : "Credit"}</TableCell>
                  <TableCell>{account.payerEntityId === HOUSE_ENTITY_ID ? "House" : payer?.kind === "self" ? "You" : payer?.name ?? "Unknown"}</TableCell>
                  <TableCell>
                    {coverage.ranges.length ? coverage.ranges.map((range) => <div key={`${range.from}-${range.to}`}>{range.from} to {range.to}</div>) : "No imported coverage"}
                    {coverage.gaps.map((gap) => <div key={`${gap.from}-${gap.to}`}>Gap: {gap.from} to {gap.to}</div>)}
                  </TableCell>
                  <TableCell>
                    {(ledger.checkpoints ?? []).filter((item) => item.accountId === account.id).sort((first, second) => first.date.localeCompare(second.date)).map((checkpoint) => (
                      <div key={checkpoint.id}>{checkpoint.date}: <span className="text-right tabular-nums">{formatMoney(checkpoint.balanceCents)}</span>{checkpoint.note ? ` · ${checkpoint.note}` : ""}</div>
                    ))}
                    {differences.map((item) => <div key={`${item.earlier.id}-${item.later.id}`}>{item.earlier.date} to {item.later.date}: difference <span className={item.differenceCents === 0 ? "text-right tabular-nums" : "text-right tabular-nums text-negative"}>{formatMoney(item.differenceCents)}</span></div>)}
                  </TableCell>
                  <TableCell><div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => editAccount(account)} type="button">Rename account</Button>
                    <Button variant="outline" onClick={() => { setCheckpointAccountId(account.id); setError(""); }} type="button">Add checkpoint</Button>
                  </div></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {ledger.accounts.length === 0 && <p className="text-sm text-muted-foreground p-4">No accounts yet.</p>}
      </div>
      <section className="grid gap-3">
        {ledger.accounts.filter((account) => account.type === "credit").map((account) => {
          const paymentCheck = cardPaymentCheck(ledger, account.id);
          const duplicatePaymentIds = new Set(paymentCheck.rows.flatMap((row) =>
            paymentCheck.rows.some((other) =>
              other.payment.id !== row.payment.id &&
              other.payment.date === row.payment.date &&
              other.payment.amountCents === row.payment.amountCents,
            ) ? [row.payment.id] : [],
          ));
          return (
            <Card key={account.id} className="min-w-0 max-w-full">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                  <span>{account.name} payments</span>
                  <span className={paymentCheck.owedNowCents < 0 ? "text-positive" : "text-negative"}>
                    {paymentCheck.owedNowCents < 0
                      ? `In credit ${formatMoney(Math.abs(paymentCheck.owedNowCents))}`
                      : `Owed ${formatMoney(paymentCheck.owedNowCents)}`}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-4">
                <p className="text-sm text-muted-foreground">A sudden jump means a row may be missing or doubled near that date.</p>
                <div className="w-full min-w-0 max-w-full overflow-x-auto">
                  <Table tabIndex={0}>
                    <TableHeader className="bg-card"><TableRow><TableHead className="!text-secondary-foreground !text-xl !font-bold">Date</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Payment</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Charges since previous payment</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Estimated owed after</TableHead><TableHead className="!text-secondary-foreground !text-xl !font-bold">Paid from</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {paymentCheck.rows.map((row, index) => {
                        const previousPaymentDate = paymentCheck.rows[index - 1]?.payment.date;
                        return (
                          <TableRow key={row.payment.id}>
                            <TableCell>{row.payment.date}{duplicatePaymentIds.has(row.payment.id) && <Badge variant="outline" className="ml-2">Possible duplicate</Badge>}</TableCell>
                            <TableCell><Button variant="link" className="h-auto p-0" onClick={() => openActivity({ accountId: account.id, kind: "transfer" })} type="button">{formatMoney(row.payment.amountCents)}</Button></TableCell>
                            <TableCell><Button variant="link" className="h-auto p-0" onClick={() => openActivity({ accountId: account.id, from: previousPaymentDate ? nextDate(previousPaymentDate) : undefined, to: row.payment.date })} type="button">{formatMoney(row.chargesSinceCents)}</Button></TableCell>
                            <TableCell>{formatMoney(row.owedAfterCents)}</TableCell>
                            <TableCell>{row.fundedFrom ?? "Not seen yet"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {paymentCheck.rows.length === 0 && <p className="text-sm text-muted-foreground">No card payments found.</p>}
                {paymentCheck.rows[0] && paymentCheck.rows[0].payment.amountCents > paymentCheck.rows[0].chargesSinceCents && !paymentCheck.anchoredOn && (
                  <p className="text-sm text-muted-foreground">Add a balance checkpoint at the start of this card&apos;s history.</p>
                )}
                {(() => {
                  if (paymentCheck.anchoredOn || paymentCheck.rows.length < 3) return null;
                  const lowestCents = Math.min(...paymentCheck.rows.map((row) => row.owedAfterCents));
                  const largestPaymentCents = Math.max(...paymentCheck.rows.map((row) => row.payment.amountCents));
                  if (lowestCents <= largestPaymentCents) return null;
                  return (
                    <div className="rounded-md border border-warning/40 p-3 text-sm" role="status">
                      Payments look missing: the estimate never drops below {formatMoney(lowestCents)} after a payment, so about that much was paid
                      before {paymentCheck.rows[0].payment.date}, the first payment recorded. Add a checkpoint with the amount owed on a recent statement to correct it.
                    </div>
                  );
                })()}
                {paymentCheck.anchoredOn && <p className="text-sm text-muted-foreground">Estimate starts from the {paymentCheck.anchoredOn} checkpoint.</p>}
              </CardContent>
            </Card>
          );
        })}
      </section>
      <Dialog open={Boolean(checkpointAccountId)} onOpenChange={(open) => { if (!open) setCheckpointAccountId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add checkpoint</DialogTitle>
            <DialogDescription>Add a balance checkpoint for {ledger.accounts.find((account) => account.id === checkpointAccountId)?.name}.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={saveCheckpoint}>
            <div className="grid gap-2"><Label htmlFor="checkpoint-date">Date</Label><Input id="checkpoint-date" type="date" value={checkpointDate} onChange={(event) => setCheckpointDate(event.target.value)} required /></div>
            <div className="grid gap-2"><Label htmlFor="checkpoint-balance">{ledger.accounts.find((account) => account.id === checkpointAccountId)?.type === "credit" ? "Amount owed on the statement (AUD)" : "Balance (AUD)"}</Label><Input id="checkpoint-balance" inputMode="decimal" value={checkpointBalance} onChange={(event) => setCheckpointBalance(event.target.value)} required /></div>
            <div className="grid gap-2"><Label htmlFor="checkpoint-note">Note</Label><Input id="checkpoint-note" value={checkpointNote} onChange={(event) => setCheckpointNote(event.target.value)} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCheckpointAccountId(null)} type="button">Cancel</Button>
              <Button type="submit">Add checkpoint</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}