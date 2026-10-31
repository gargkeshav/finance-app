import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { balances, type Debt, type Ledger, type Settlement } from "../../domain/ledger";
import { formatAud, formatMoney, parseAud } from "../../domain/value";

const headClass = "!text-secondary-foreground !font-semibold";

/** Debts where you are neither side, such as House owing Trisha, with a way to record when one pays the other. */
export function BetweenOthers({ ledger, update }: { ledger: Ledger; update: (next: Ledger, undoLabel?: string) => void }) {
  const [payment, setPayment] = useState<{ key: string; amount: string; date: string } | null>(null);
  const [error, setError] = useState("");
  const debts = balances(ledger).betweenEntities;
  const name = (id: string) => ledger.entities.find((entity) => entity.id === id)?.name ?? "Unknown";
  if (!debts.length) return null;

  function record(debt: Debt) {
    if (!payment) return;
    let amountCents: number;
    try {
      amountCents = parseAud(payment.amount.replace(/[$,\s]/g, ""));
    } catch {
      setError("Enter an amount like 120.50.");
      return;
    }
    if (amountCents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) {
      setError("Enter an amount above zero and a date.");
      return;
    }
    const settlement: Settlement = {
      id: crypto.randomUUID(),
      date: payment.date,
      entityId: debt.debtorId,
      paidToEntityId: debt.creditorId,
      direction: "theyPaidYou",
      amountCents,
      bankRowIds: [],
      note: `${name(debt.debtorId)} paid ${name(debt.creditorId)}`,
      splitwisePaymentId: null,
      updatedAt: new Date().toISOString(),
    };
    update({ ...ledger, settlements: [...(ledger.settlements ?? []), settlement] }, "Record payment between others");
    setPayment(null);
    setError("");
  }

  return (
    <section className="grid gap-2" aria-label="Between others">
      <h2>Between others</h2>
      <p className="text-sm text-muted-foreground">Money owed between two other parties, such as the House account and your partner. Record it here when one pays the other.</p>
      <div className="w-full min-w-0 max-w-full overflow-x-auto">
        <Table tabIndex={0}>
          <TableHeader><TableRow>
            <TableHead className={headClass}>Who owes</TableHead>
            <TableHead className={headClass}>Owed to</TableHead>
            <TableHead className={headClass}>Amount</TableHead>
            <TableHead className={headClass} />
          </TableRow></TableHeader>
          <TableBody>
            {debts.map((debt) => {
              const key = `${debt.debtorId}-${debt.creditorId}`;
              return (
                <TableRow key={key}>
                  <TableCell>{name(debt.debtorId)}</TableCell>
                  <TableCell>{name(debt.creditorId)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(debt.amountCents)}</TableCell>
                  <TableCell>
                    {payment?.key === key ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid gap-1 text-sm">Date<Input type="date" value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} /></label>
                        <label className="grid gap-1 text-sm">Amount<Input inputMode="decimal" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} aria-invalid={Boolean(error)} /></label>
                        <Button onClick={() => record(debt)} type="button">Save payment</Button>
                        <Button onClick={() => { setPayment(null); setError(""); }} type="button" variant="outline">Cancel</Button>
                        {error && <p className="w-full text-sm text-destructive" role="alert">{error}</p>}
                      </div>
                    ) : (
                      <Button
                        onClick={() => { setPayment({ key, amount: formatAud(debt.amountCents).slice(4), date: new Date().toISOString().slice(0, 10) }); setError(""); }}
                        type="button"
                        variant="outline"
                      >
                        Record payment
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
