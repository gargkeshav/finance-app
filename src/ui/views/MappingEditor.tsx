import { useState } from "react";
import Papa from "papaparse";
import {
  type CsvColumn,
  type CsvMapping,
} from "../../adapters/csv-mapping";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MappingEditorProps {
  text: string;
  initialMapping?: CsvMapping;
  onSave: (mapping: CsvMapping) => void;
  onCancel: () => void;
}

function mappingIndex(column: CsvColumn | undefined, firstRow: string[]): number | null {
  if (!column) return null;
  if ("index" in column) {
    return Number.isInteger(column.index) && column.index >= 0 && column.index < firstRow.length
      ? column.index
      : null;
  }
  const header = column.header.trim().toLowerCase();
  const index = firstRow.findIndex((value) => value.trim().toLowerCase() === header);
  return index >= 0 ? index : null;
}

export function MappingEditor({ text, initialMapping, onSave, onCancel }: MappingEditorProps) {
  const firstRow = Papa.parse<string[]>(text, {
    preview: 1,
    delimiter: ",",
    dynamicTyping: false,
  }).data[0] ?? [];
  const [name, setName] = useState(initialMapping?.name ?? "Custom mapping");
  const [hasHeader, setHasHeader] = useState(initialMapping?.hasHeader ?? true);
  const [dateFormat, setDateFormat] = useState<CsvMapping["dateFormat"]>(
    initialMapping?.dateFormat ?? "D/M/YYYY",
  );
  const [dateIndex, setDateIndex] = useState(
    initialMapping?.dateColumn ? String(mappingIndex(initialMapping.dateColumn, firstRow) ?? "") : "",
  );
  const [amountMode, setAmountMode] = useState<"signed" | "debit-credit">(
    initialMapping && "signed" in initialMapping.amount ? "signed" :
      initialMapping ? "debit-credit" : "signed",
  );
  const [signedIndex, setSignedIndex] = useState(() => {
    if (initialMapping && "signed" in initialMapping.amount) {
      return String(mappingIndex(initialMapping.amount.signed, firstRow) ?? "");
    }
    return String(Math.min(1, Math.max(firstRow.length - 1, 0)));
  });
  const [debitIndex, setDebitIndex] = useState(() =>
    initialMapping && !("signed" in initialMapping.amount)
      ? String(mappingIndex(initialMapping.amount.debit, firstRow) ?? "")
      : "",
  );
  const [creditIndex, setCreditIndex] = useState(() =>
    initialMapping && !("signed" in initialMapping.amount)
      ? String(mappingIndex(initialMapping.amount.credit, firstRow) ?? "")
      : "",
  );
  const [negate, setNegate] = useState(
    initialMapping && "signed" in initialMapping.amount ? initialMapping.amount.negate : false,
  );
  const [balanceIndex, setBalanceIndex] = useState(() =>
    initialMapping?.balanceColumn
      ? String(mappingIndex(initialMapping.balanceColumn, firstRow) ?? "")
      : "",
  );
  const [descriptionColumnIndex, setDescriptionColumnIndex] = useState(() =>
    initialMapping?.descriptionColumns.length
      ? initialMapping.descriptionColumns.map((column) => String(mappingIndex(column, firstRow) ?? ""))
      : [String(Math.min(2, Math.max(firstRow.length - 1, 0)))],
  );

  const options = firstRow.map((value, index) => ({
    index,
    label: hasHeader && value.trim() ? value : `Column ${index + 1}`,
  }));
  const columnAt = (value: string): CsvColumn | null => {
    if (!value) return null;
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= firstRow.length) return null;
    const header = firstRow[index];
    return hasHeader && header?.trim() ? { header: header.trim() } : { index };
  };

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signedColumn = amountMode === "signed" ? columnAt(signedIndex) : null;
    const debitColumn = amountMode === "debit-credit" ? columnAt(debitIndex) : null;
    const creditColumn = amountMode === "debit-credit" ? columnAt(creditIndex) : null;
    if ((amountMode === "signed" && !signedColumn) || (amountMode === "debit-credit" && (!debitColumn || !creditColumn))) return;
    const amount: CsvMapping["amount"] = amountMode === "signed"
      ? { signed: signedColumn!, negate }
      : { debit: debitColumn!, credit: creditColumn! };
    const dateColumn = columnAt(dateIndex);
    onSave({
      id: crypto.randomUUID(),
      name: name.trim(),
      dateFormat,
      ...(dateColumn ? { dateColumn } : {}),
      hasHeader,
      amount,
      descriptionColumns: descriptionColumnIndex.map(columnAt).filter((column): column is CsvColumn => column !== null),
      balanceColumn: balanceIndex ? columnAt(balanceIndex) : null,
      updatedAt: new Date().toISOString(),
    });
  }

  const selectColumn = (
    label: string,
    value: string,
    onValueChange: (value: string) => void,
    optional = false,
  ) => (
    <Select value={value || undefined} onValueChange={(next) => onValueChange(next ?? "")}>
      <SelectTrigger aria-label={`${label} column`} className="w-full min-w-40">
        <SelectValue placeholder={optional ? "Auto detect" : "Choose column"} />
      </SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value="auto">Auto detect</SelectItem>}
        {options.map((option) => <SelectItem key={option.index} value={String(option.index)}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const effectiveDateIndex = dateIndex || "auto";
  const effectiveBalanceIndex = balanceIndex || "auto";

  return (
    <form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="mapping-name">Mapping name</Label>
          <Input id="mapping-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="mapping-date-format">Date format</Label>
          <Select value={dateFormat} onValueChange={(value) => value && setDateFormat(value as CsvMapping["dateFormat"])}>
            <SelectTrigger id="mapping-date-format"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="D/M/YYYY">D/M/YYYY</SelectItem>
              <SelectItem value="D Mon YYYY">D Mon YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} type="checkbox" />
        First row contains column names
      </label>
      <div className="grid gap-2">
        <Label>Column mapping</Label>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>CSV column</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>{selectColumn("Date", effectiveDateIndex, (value) => setDateIndex(value === "auto" ? "" : value), true)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Amount format</TableCell>
                <TableCell>
                  <Select value={amountMode} onValueChange={(value) => value && setAmountMode(value as typeof amountMode)}>
                    <SelectTrigger aria-label="Amount format" className="w-full min-w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="signed">Signed amount</SelectItem>
                      <SelectItem value="debit-credit">Separate debit and credit</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
              {amountMode === "signed" ? (
                <TableRow>
                  <TableCell>Amount</TableCell>
                  <TableCell>{selectColumn("Amount", signedIndex, setSignedIndex)}</TableCell>
                </TableRow>
              ) : (
                <>
                  <TableRow><TableCell>Debit</TableCell><TableCell>{selectColumn("Debit", debitIndex, setDebitIndex)}</TableCell></TableRow>
                  <TableRow><TableCell>Credit</TableCell><TableCell>{selectColumn("Credit", creditIndex, setCreditIndex)}</TableCell></TableRow>
                </>
              )}
              {descriptionColumnIndex.map((value, index) => (
                <TableRow key={`description-${index}`}>
                  <TableCell>Description {index + 1}</TableCell>
                  <TableCell className="flex items-center gap-2">
                    {selectColumn(`Description ${index + 1}`, value, (next) => setDescriptionColumnIndex((current) => current.map((item, currentIndex) => currentIndex === index ? next : item)), true)}
                    {descriptionColumnIndex.length > 1 && <Button aria-label={`Remove description column ${index + 1}`} onClick={() => setDescriptionColumnIndex((current) => current.filter((_, currentIndex) => currentIndex !== index))} size="sm" type="button" variant="outline">Remove</Button>}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2}>
                  <Button onClick={() => setDescriptionColumnIndex((current) => [...current, "auto"])} size="sm" type="button" variant="outline">Add description column</Button>
                </TableCell>
              </TableRow>
              <TableRow><TableCell>Balance</TableCell><TableCell>{selectColumn("Balance", effectiveBalanceIndex, (value) => setBalanceIndex(value === "auto" ? "" : value), true)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
      {amountMode === "signed" && (
        <label className="flex items-center gap-2 text-sm">
          <input checked={negate} onChange={(event) => setNegate(event.target.checked)} type="checkbox" />
          Reverse amount sign
        </label>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="outline">Cancel</Button>
        <Button disabled={!firstRow.length || !name.trim() || (amountMode === "signed" ? !columnAt(signedIndex) : !columnAt(debitIndex) || !columnAt(creditIndex))} type="submit">Save mapping</Button>
      </div>
    </form>
  );
}