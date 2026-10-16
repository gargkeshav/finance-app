import Papa from "papaparse";
import { bankDateSchema, parseAud } from "../../domain/value";
import {
  type BankProfile,
  type BankPreview,
  observationSchema,
} from "../../application/import-contracts";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

function headerKey(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function parseBankAmount(value: string): number | null {
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

function parseBankDate(value: string, profile: BankProfile): string {
  const text = value.trim();
  let year: string, month: string, day: string;
  if (profile === "hsbc") {
    const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(text);
    if (!match) throw new Error("Expected Australian posting date D Mon YYYY.");
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const index = months.indexOf(match[2].toLowerCase());
    if (index < 0) throw new Error("Invalid posting month.");
    day = match[1];
    month = String(index + 1);
    year = match[3];
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match) throw new Error("Expected Australian posting date D/M/YYYY.");
    day = match[1];
    month = match[2];
    year = match[3];
  }
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (!bankDateSchema.safeParse(iso).success)
    throw new Error("Invalid calendar posting date.");
  return iso;
}

function candidates(first: string[]): BankProfile[] {
  const keys = first.map(headerKey);
  if (
    keys.includes("credit") &&
    keys.includes("debit") &&
    keys.includes("date")
  )
    return ["ing"];
  if (
    (keys.includes("transactiondate") || keys.includes("date")) &&
    keys.includes("amount")
  )
    return ["hsbc"];
  if (
    first.length >= 8 &&
    /^\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/.test(first[0] ?? "")
  )
    return ["anz-credit", "anz-transaction"];
  return [];
}

export function detectBankProfiles(text: string): BankProfile[] {
  const first = Papa.parse<string[]>(text, {
    preview: 1,
    delimiter: ",",
    dynamicTyping: false,
  }).data[0];
  return first ? candidates(first) : [];
}

export function parseBankCsv(text: string, profile: BankProfile): BankPreview {
  const preview: BankPreview = {
    profile,
    candidates: [],
    headers: null,
    rows: [],
    issues: [],
    warnings: [],
  };
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    preview.issues.push({
      row: null,
      message: "CSV exceeds the 5 MiB limit for this version.",
    });
    return preview;
  }
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    delimiter: ",",
    dynamicTyping: false,
  });
  for (const error of parsed.errors)
    preview.issues.push({
      row: error.row === undefined ? null : error.row + 1,
      message: `CSV syntax: ${error.message}`,
    });
  const records = parsed.data;
  if (
    !records.length ||
    records.every((row) => row.every((field) => field === ""))
  ) {
    preview.issues.push({
      row: null,
      message: "CSV contains no transaction rows.",
    });
    return preview;
  }
  preview.candidates = candidates(records[0]);
  const headered = profile === "ing" || profile === "hsbc";
  const keys = headered ? records[0].map(headerKey) : [];
  if (headered) preview.headers = records[0];
  const index = (key: string) => keys.indexOf(key);
  if (headered) {
    const expected =
      profile === "ing"
        ? ["date", "description", "credit", "debit"]
        : ["description", "amount"];
    if (
      expected.some((key) => index(key) < 0) ||
      (profile === "hsbc" && index("transactiondate") < 0 && index("date") < 0)
    ) {
      preview.issues.push({
        row: 1,
        message: "Required columns do not match the selected bank profile.",
      });
      return preview;
    }
    const named = keys.filter(Boolean);
    if (new Set(named).size !== named.length) {
      preview.issues.push({
        row: 1,
        message: "Duplicate column headers require review.",
      });
      return preview;
    }
  }
  let rowCount = 0;
  for (
    let position = headered ? 1 : 0;
    position < records.length;
    position += 1
  ) {
    const fields = records[position];
    if (
      position === records.length - 1 &&
      fields.length === 1 &&
      fields[0] === ""
    )
      continue;
    rowCount += 1;
    if (rowCount > MAX_CSV_ROWS) {
      preview.issues.push({
        row: position + 1,
        message: "CSV exceeds the 10,000-row limit.",
      });
      break;
    }
    try {
      if (fields.every((value) => !value.trim()))
        throw new Error("Blank row inside the file requires review.");
      if (headered) {
        const known = new Set(
          profile === "ing"
            ? ["date", "description", "credit", "debit", "balance"]
            : ["transactiondate", "date", "description", "amount", "balance"],
        );
        if (
          fields.some(
            (value, column) => value.trim() && !known.has(keys[column] ?? ""),
          )
        ) {
          throw new Error(
            "Unexpected nonempty column. Source fields retained; this row cannot be committed.",
          );
        }
        if (fields.length < (profile === "ing" ? 4 : 3))
          throw new Error("Row has too few columns.");
      } else if (fields.length < 8 || fields.length > 50) {
        throw new Error(
          "ANZ rows require at least eight columns; trailing fields are preserved as text.",
        );
      }
      let amount: number | null;
      if (profile === "ing") {
        const credit = parseBankAmount(fields[index("credit")] ?? "");
        const debit = parseBankAmount(fields[index("debit")] ?? "");
        if (credit !== null && debit !== null)
          throw new Error(
            "Credit and debit are both populated; choose the correct source interpretation.",
          );
        if (credit !== null && credit < 0)
          throw new Error("Negative credit conflicts with the ING profile.");
        amount = credit ?? (debit === null ? null : -Math.abs(debit));
      } else {
        amount = parseBankAmount(fields[headered ? index("amount") : 1] ?? "");
      }
      if (amount === null) throw new Error("Missing amount is not zero.");
      const dateColumn = headered
        ? index("transactiondate") >= 0
          ? index("transactiondate")
          : index("date")
        : 0;
      const description = headered
        ? (fields[index("description")] ?? "")
        : fields.slice(2).join(" | ");
      const balance =
        headered && index("balance") >= 0
          ? parseBankAmount(fields[index("balance")] ?? "")
          : null;
      preview.rows.push(
        observationSchema.parse({
          ordinal: position + 1,
          rawFields: fields,
          date: parseBankDate(fields[dateColumn] ?? "", profile),
          description,
          comparisonDescription: description.replace(/\s+/g, " ").trim(),
          amountCents: amount,
          balanceCents: balance,
          currency: "AUD",
        }),
      );
    } catch (failure) {
      preview.issues.push({
        row: position + 1,
        message: failure instanceof Error ? failure.message : "Invalid row.",
      });
    }
  }
  if (profile.startsWith("anz-"))
    preview.warnings.push(
      "ANZ subtype is not identifiable from these columns. Confirm the account and profile.",
    );
  preview.warnings.push(
    "Account balances remain incomplete until opening balances and source coverage are reconciled.",
  );
  if (!preview.rows.length && !preview.issues.length)
    preview.issues.push({
      row: null,
      message: "CSV contains no transaction rows.",
    });
  return preview;
}
