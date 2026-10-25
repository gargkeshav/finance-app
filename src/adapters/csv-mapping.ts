import Papa from "papaparse";
import { z } from "zod";
import { bankDateSchema, centsSchema, parseAud } from "../domain/value";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

export const csvColumnSchema = z.union([
  z.object({ header: z.string() }),
  z.object({ index: z.number().int().nonnegative() }),
]);

const amountMappingSchema = z.union([
  z.object({ signed: csvColumnSchema, negate: z.boolean() }),
  z.object({ debit: csvColumnSchema, credit: csvColumnSchema }),
]);

export const csvMappingSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dateFormat: z.enum(["D/M/YYYY", "D Mon YYYY"]),
  dateColumn: csvColumnSchema.optional(),
  hasHeader: z.boolean(),
  amount: amountMappingSchema,
  descriptionColumns: z.array(csvColumnSchema),
  balanceColumn: csvColumnSchema.nullable(),
  updatedAt: z.string().min(1),
});

export type CsvColumn = z.infer<typeof csvColumnSchema>;
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export type ParsedBankRow = {
  line: number;
  date: string;
  description: string;
  amountCents: number;
  balanceCents: number | null;
  raw: string[];
};

export type CsvRowError = { line: number; message: string };
export type CsvMappingResult = {
  rows: ParsedBankRow[];
  errors: CsvRowError[];
};

const presetUpdatedAt = "1970-01-01T00:00:00.000Z";
const header = (value: string): CsvColumn => ({ header: value });
const index = (value: number): CsvColumn => ({ index: value });

export const BANK_PRESETS: readonly CsvMapping[] = [
  {
    id: "ing",
    name: "ING",
    dateFormat: "D/M/YYYY",
    hasHeader: true,
    amount: { debit: header("Debit"), credit: header("Credit") },
    descriptionColumns: [header("Description")],
    balanceColumn: header("Balance"),
    updatedAt: presetUpdatedAt,
  },
  {
    id: "hsbc",
    name: "HSBC",
    dateFormat: "D Mon YYYY",
    hasHeader: true,
    amount: { signed: header("Amount"), negate: false },
    descriptionColumns: [header("Description")],
    balanceColumn: header("Balance"),
    updatedAt: presetUpdatedAt,
  },
  {
    id: "anz-credit",
    name: "ANZ Credit Card",
    dateFormat: "D/M/YYYY",
    hasHeader: false,
    amount: { signed: index(1), negate: false },
    descriptionColumns: Array.from({ length: 48 }, (_, offset) => index(offset + 2)),
    balanceColumn: null,
    updatedAt: presetUpdatedAt,
  },
  {
    id: "anz-transaction",
    name: "ANZ Transaction",
    dateFormat: "D/M/YYYY",
    hasHeader: false,
    amount: { signed: index(1), negate: false },
    descriptionColumns: Array.from({ length: 48 }, (_, offset) => index(offset + 2)),
    balanceColumn: null,
    updatedAt: presetUpdatedAt,
  },
];

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function parseAmount(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(
      "Invalid AUD amount; expected signed dollars and at most two decimal places.",
    );
  }
  return parseAud(
    text
      .replaceAll(",", "")
      .replace(/^\+/, "")
      .replace(/^(-?)0+(?=\d)/, "$1"),
  );
}

function parseDate(value: string, format: CsvMapping["dateFormat"]): string {
  const text = value.trim();
  let year: string;
  let month: string;
  let day: string;
  if (format === "D Mon YYYY") {
    const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(text);
    if (!match) throw new Error("Expected Australian posting date D Mon YYYY.");
    const months = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    const monthIndex = months.indexOf(match[2].toLowerCase());
    if (monthIndex < 0) throw new Error("Invalid posting month.");
    day = match[1];
    month = String(monthIndex + 1);
    year = match[3];
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match) throw new Error("Expected Australian posting date D/M/YYYY.");
    day = match[1];
    month = match[2];
    year = match[3];
  }
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = bankDateSchema.safeParse(iso);
  if (!parsed.success) throw new Error("Invalid calendar posting date.");
  return parsed.data;
}

function resolveColumn(column: CsvColumn, headers: string[]): number | null {
  if ("index" in column) return column.index;
  const target = headerKey(column.header);
  const found = headers.findIndex((value) => headerKey(value) === target);
  return found < 0 ? null : found;
}

function fieldAt(fields: string[], column: number | null): string {
  return column === null ? "" : (fields[column] ?? "");
}

function parseMappedAmount(
  fields: string[],
  mapping: CsvMapping["amount"],
  headers: string[],
): number {
  if ("signed" in mapping) {
    const value = parseAmount(fieldAt(fields, resolveColumn(mapping.signed, headers)));
    if (value === null) throw new Error("Missing amount is not zero.");
    return mapping.negate ? -value : value;
  }

  const debit = parseAmount(fieldAt(fields, resolveColumn(mapping.debit, headers)));
  const credit = parseAmount(fieldAt(fields, resolveColumn(mapping.credit, headers)));
  if (debit !== null && credit !== null) {
    throw new Error("Credit and debit are both populated; choose the correct source interpretation.");
  }
  if (credit !== null && credit < 0) {
    throw new Error("Negative credit conflicts with the selected mapping.");
  }
  if (debit !== null) return centsSchema.parse(-Math.abs(debit));
  if (credit !== null) return credit;
  throw new Error("Missing amount is not zero.");
}

export function parseWithMapping(text: string, mapping: CsvMapping): CsvMappingResult {
  const result: CsvMappingResult = { rows: [], errors: [] };
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    result.errors.push({ line: 1, message: "CSV exceeds the 5 MiB limit for this version." });
    return result;
  }

  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    delimiter: ",",
    dynamicTyping: false,
  });
  for (const error of parsed.errors) {
    result.errors.push({
      line: (error.row ?? 0) + 1,
      message: `CSV syntax: ${error.message}`,
    });
  }

  const records = parsed.data;
  if (!records.length || records.every((row) => row.every((field) => field === ""))) {
    result.errors.push({ line: 1, message: "CSV contains no transaction rows." });
    return result;
  }

  const headers = mapping.hasHeader ? records[0] : [];
  const firstDataPosition = mapping.hasHeader ? 1 : 0;
  if (mapping.hasHeader) {
    const namedHeaders = headers.map(headerKey).filter(Boolean);
    if (new Set(namedHeaders).size !== namedHeaders.length) {
      result.errors.push({ line: 1, message: "Duplicate column headers require review." });
      return result;
    }
  }

  const amountColumns = [
    ...( "signed" in mapping.amount
      ? [resolveColumn(mapping.amount.signed, headers)]
      : [resolveColumn(mapping.amount.debit, headers), resolveColumn(mapping.amount.credit, headers)]),
  ];
  const descriptionColumns = mapping.descriptionColumns.map((column) =>
    resolveColumn(column, headers),
  );
  const transactionDateColumn = headers.findIndex(
    (value) => headerKey(value) === "transactiondate",
  );
  const dateColumn = mapping.dateColumn
    ? resolveColumn(mapping.dateColumn, headers)
    : mapping.hasHeader
      ? transactionDateColumn >= 0
        ? transactionDateColumn
        : headers.findIndex((value) => headerKey(value) === "date")
      : 0;
  if (
    dateColumn === null ||
    dateColumn < 0 ||
    amountColumns.some((column) => column === null) ||
    (mapping.hasHeader && descriptionColumns.some((column) => column === null))
  ) {
    result.errors.push({ line: 1, message: "The mapping refers to a missing column." });
    return result;
  }

  let rowCount = 0;
  for (let position = firstDataPosition; position < records.length; position += 1) {
    const fields = records[position];
    if (position === records.length - 1 && fields.length === 1 && fields[0] === "") continue;
    rowCount += 1;
    const line = position + 1;
    if (rowCount > MAX_CSV_ROWS) {
      result.errors.push({ line, message: "CSV exceeds the 10,000-row limit." });
      break;
    }
    try {
      if (fields.every((value) => !value.trim())) {
        throw new Error("Blank row inside the file requires review.");
      }
      if (mapping.id.startsWith("anz-") && (fields.length < 8 || fields.length > 50)) {
        throw new Error(
          "ANZ rows require at least eight columns; trailing fields are preserved as text.",
        );
      }
      const requiredRowColumns = [
        dateColumn,
        ...amountColumns.filter((value): value is number => value !== null),
        ...(mapping.hasHeader
          ? descriptionColumns.filter((value): value is number => value !== null)
          : []),
      ];
      const largestRequired = Math.max(...requiredRowColumns);
      if (fields.length <= largestRequired) throw new Error("Row has too few columns.");

      const description = descriptionColumns
        .filter((column): column is number => column !== null)
        .filter((column) => mapping.hasHeader || column < fields.length)
        .map((column) => fields[column] ?? "")
        .join(" | ");
      const balanceColumn = mapping.balanceColumn
        ? resolveColumn(mapping.balanceColumn, headers)
        : null;
      const rawBalance = balanceColumn !== null && balanceColumn < fields.length
        ? parseAmount(fields[balanceColumn])
        : null;

      result.rows.push({
        line,
        date: parseDate(fields[dateColumn] ?? "", mapping.dateFormat),
        description,
        amountCents: parseMappedAmount(fields, mapping.amount, headers),
        balanceCents: rawBalance,
        raw: fields,
      });
    } catch (failure) {
      result.errors.push({
        line,
        message: failure instanceof Error ? failure.message : "Invalid row.",
      });
    }
  }
  if (!result.rows.length && !result.errors.length) {
    result.errors.push({ line: 1, message: "CSV contains no transaction rows." });
  }
  return result;
}

function presetCandidates(first: string[]): CsvMapping[] {
  const keys = first.map(headerKey);
  if (keys.includes("credit") && keys.includes("debit") && keys.includes("date")) {
    return [BANK_PRESETS[0]];
  }
  if (
    (keys.includes("transactiondate") || keys.includes("date")) &&
    keys.includes("amount")
  ) {
    return [BANK_PRESETS[1]];
  }
  if (first.length >= 8 && /^\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/.test(first[0] ?? "")) {
    return [BANK_PRESETS[2], BANK_PRESETS[3]];
  }
  return [];
}

export function suggestPresets(text: string): string[] {
  const first = Papa.parse<string[]>(text, {
    preview: 1,
    delimiter: ",",
    dynamicTyping: false,
  }).data[0];
  return first ? presetCandidates(first).map((preset) => preset.name) : [];
}

function rowKey(row: Pick<ParsedBankRow, "date" | "amountCents" | "description">): string {
  return JSON.stringify([row.date, row.amountCents, row.description]);
}

export function findNewRows(
  existing: readonly Pick<ParsedBankRow, "date" | "amountCents" | "description">[],
  parsed: readonly ParsedBankRow[],
): ParsedBankRow[] {
  const counts = new Map<string, number>();
  for (const row of existing) {
    const key = rowKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const newRows: ParsedBankRow[] = [];
  for (const row of parsed) {
    const key = rowKey(row);
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) counts.set(key, remaining - 1);
    else newRows.push(row);
  }
  return newRows;
}