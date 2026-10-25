import { useState } from "react";
import Papa from "papaparse";
import {
  type CsvColumn,
  type CsvMapping,
} from "../../adapters/csv-mapping";

interface MappingEditorProps {
  text: string;
  initialMapping?: CsvMapping;
  onSave: (mapping: CsvMapping) => void;
  onCancel: () => void;
}

function mappingIndex(column: CsvColumn | undefined, firstRow: string[]): number {
  if (!column) return -1;
  if ("index" in column) return column.index;
  return firstRow.findIndex((value) => value === column.header);
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
    initialMapping?.dateColumn ? String(mappingIndex(initialMapping.dateColumn, firstRow)) : "",
  );
  const [amountMode, setAmountMode] = useState<"signed" | "debit-credit">(
    initialMapping && "signed" in initialMapping.amount ? "signed" :
      initialMapping ? "debit-credit" : "signed",
  );
  const [signedIndex, setSignedIndex] = useState(() => {
    if (initialMapping && "signed" in initialMapping.amount) {
      return String(mappingIndex(initialMapping.amount.signed, firstRow));
    }
    return String(Math.min(1, Math.max(firstRow.length - 1, 0)));
  });
  const [debitIndex, setDebitIndex] = useState(() =>
    initialMapping && !("signed" in initialMapping.amount)
      ? String(mappingIndex(initialMapping.amount.debit, firstRow))
      : "",
  );
  const [creditIndex, setCreditIndex] = useState(() =>
    initialMapping && !("signed" in initialMapping.amount)
      ? String(mappingIndex(initialMapping.amount.credit, firstRow))
      : "",
  );
  const [negate, setNegate] = useState(
    initialMapping && "signed" in initialMapping.amount ? initialMapping.amount.negate : false,
  );
  const [descriptionIndexes, setDescriptionIndexes] = useState(() =>
    initialMapping?.descriptionColumns.map((column) => String(mappingIndex(column, firstRow))) ??
      (firstRow.length > 2 ? ["2"] : []),
  );
  const [balanceIndex, setBalanceIndex] = useState(() =>
    initialMapping?.balanceColumn
      ? String(mappingIndex(initialMapping.balanceColumn, firstRow))
      : "",
  );

  const options = firstRow.map((value, index) => ({
    index,
    label: hasHeader && value.trim() ? value : `Column ${index + 1}`,
  }));
  const columnAt = (value: string): CsvColumn => {
    const index = Number(value);
    const header = firstRow[index];
    return hasHeader && header?.trim() ? { header } : { index };
  };

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount: CsvMapping["amount"] = amountMode === "signed"
      ? { signed: columnAt(signedIndex), negate }
      : { debit: columnAt(debitIndex), credit: columnAt(creditIndex) };
    onSave({
      id: crypto.randomUUID(),
      name: name.trim(),
      dateFormat,
      ...(dateIndex ? { dateColumn: columnAt(dateIndex) } : {}),
      hasHeader,
      amount,
      descriptionColumns: descriptionIndexes.map(columnAt),
      balanceColumn: balanceIndex ? columnAt(balanceIndex) : null,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <form className="form-grid" onSubmit={save}>
      <h2>New mapping</h2>
      <label>
        Mapping name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="checkbox-label">
        <input
          checked={hasHeader}
          onChange={(event) => setHasHeader(event.target.checked)}
          type="checkbox"
        />
        First row contains column names
      </label>
      <label>
        Date format
        <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as CsvMapping["dateFormat"])}>
          <option value="D/M/YYYY">D/M/YYYY</option>
          <option value="D Mon YYYY">D Mon YYYY</option>
        </select>
      </label>
      <label>
        Date column
        <select value={dateIndex} onChange={(event) => setDateIndex(event.target.value)}>
          <option value="">Auto detect</option>
          {options.map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}
        </select>
      </label>
      <label>
        Amount format
        <select value={amountMode} onChange={(event) => setAmountMode(event.target.value as typeof amountMode)}>
          <option value="signed">Signed amount</option>
          <option value="debit-credit">Separate debit and credit</option>
        </select>
      </label>
      {amountMode === "signed" ? (
        <>
          <label>
            Amount column
            <select value={signedIndex} onChange={(event) => setSignedIndex(event.target.value)} required>
              {options.map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}
            </select>
          </label>
          <label className="checkbox-label">
            <input checked={negate} onChange={(event) => setNegate(event.target.checked)} type="checkbox" />
            Reverse amount sign
          </label>
        </>
      ) : (
        <>
          <label>
            Debit column
            <select value={debitIndex} onChange={(event) => setDebitIndex(event.target.value)} required>
              {options.map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Credit column
            <select value={creditIndex} onChange={(event) => setCreditIndex(event.target.value)} required>
              {options.map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}
            </select>
          </label>
        </>
      )}
      <label>
        Description columns
        <select
          multiple
          value={descriptionIndexes}
          onChange={(event) => setDescriptionIndexes(
            Array.from(event.currentTarget.selectedOptions, (option) => option.value),
          )}
        >
          {options.map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}
        </select>
      </label>
      <label>
        Balance column
        <select value={balanceIndex} onChange={(event) => setBalanceIndex(event.target.value)}>
          <option value="">None</option>
          {options.map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}
        </select>
      </label>
      <div className="dialog-actions">
        <button className="primary" disabled={!firstRow.length || !name.trim()} type="submit">Save mapping</button>
        <button className="secondary" onClick={onCancel} type="button">Cancel</button>
      </div>
    </form>
  );
}