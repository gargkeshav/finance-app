import Papa from "papaparse";
import { HOUSE_ENTITY_ID, SELF_ENTITY_ID, type BankRow, type Entry, type Entity, type Ledger, type Portion } from "./ledger";
import { isBankDate, parseAud } from "./value";

const REQUIRED_HEADERS = ["Date", "Description", "Debit($AUD)", "Status", "SubType", "Group", "Our share", "Share"];
const ASSOCIATIONS = new Set(["friend", "group", "house", "payment", "personal", "refund", "trip"]);

export interface HistoryImportRow {
  lineNumber: number;
  date: string;
  description: string;
  amountCents: number;
  bankAmountCents: number;
  houseCents: number;
  association: string;
  isRefund: boolean;
  status: string;
  subtype: string;
  group: string;
  historyKey: string;
  bankRowId: string | null;
  note: string;
}

export interface HistoryImportProblem {
  lineNumber: number;
  date: string;
  description: string;
  reason: string;
}

export interface HistoryImportPlan {
  matched: HistoryImportRow[];
  created: HistoryImportRow[];
  skipped: HistoryImportRow[];
  pending: HistoryImportRow[];
  problems: HistoryImportProblem[];
  accountId: string;
}

type CsvRow = Record<string, string>;

function parseDate(value: string): string | null {
  const text = value.trim();
  let date = text;
  const localDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (localDate) date = `${localDate[3]}-${localDate[2].padStart(2, "0")}-${localDate[1].padStart(2, "0")}`;
  return isBankDate(date) ? date : null;
}

function parseAmount(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parenthesized = /^\((.*)\)$/.exec(text);
  const normalized = (parenthesized ? parenthesized[1] : text).replace(/[$,\s]/g, "");
  try {
    const amount = parseAud(normalized);
    return parenthesized && amount > 0 ? -amount : amount;
  } catch {
    return null;
  }
}

function digestLine(line: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(line)).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

function matchBankRow(
  date: string,
  amountCents: number,
  accountId: string,
  ledger: Ledger,
  claimed: Set<string>,
): BankRow | null {
  const candidates = (ledger.bankRows ?? []).filter((row) =>
    row.accountId === accountId && row.entryId === null && row.settlementId === null && !row.skipped &&
    !claimed.has(row.id) && Math.abs(row.amountCents) === amountCents,
  );
  const sameDate = candidates.filter((row) => row.date === date);
  if (sameDate.length === 1) return sameDate[0];
  if (sameDate.length > 1) return null;
  const near = candidates.filter((row) => {
    const difference = Math.abs(Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`));
    return difference <= 2 * 24 * 60 * 60 * 1000;
  });
  return near.length === 1 ? near[0] : null;
}

export async function planHistoryImport(text: string, ledger: Ledger, accountId: string): Promise<HistoryImportPlan> {
  const account = ledger.accounts.find((candidate) => candidate.id === accountId);
  if (!account || account.type !== "credit") throw new Error("Choose a credit account for the history import.");

  const cleanText = text.replace(/^\uFEFF/, "");
  const headerResult = Papa.parse<string[]>(cleanText, { preview: 1, skipEmptyLines: false });
  const headers = headerResult.data[0] ?? [];
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(", ")}.`);

  const plan: HistoryImportPlan = { matched: [], created: [], skipped: [], pending: [], problems: [], accountId };
  const existingKeys = new Set(ledger.entries.map((entry) => entry.historyKey).filter((key): key is string => Boolean(key)));
  const claimedRows = new Set<string>();
  let rawStart = cleanText.indexOf("\n") + 1;
  const parsedRows: { row: CsvRow; rawLine: string; lineNumber: number }[] = [];
  Papa.parse<CsvRow>(cleanText, {
    header: true,
    skipEmptyLines: "greedy",
    step: (result) => {
      const rawEnd = result.meta.cursor;
      const rawLine = cleanText.slice(rawStart, rawEnd).replace(/\r?\n$/, "");
      rawStart = rawEnd;
      const lineNumber = result.meta.cursor > 0 ? Math.max(2, cleanText.slice(0, rawEnd).split("\n").length) : 2;
      parsedRows.push({ row: result.data, rawLine, lineNumber });
    },
  });

  for (const { row, rawLine, lineNumber } of parsedRows) {
      const date = parseDate(row.Date ?? "");
      const description = (row.Description ?? "").trim();
      const amount = parseAmount(row["Debit($AUD)"] ?? "");
      const status = (row.Status ?? "").trim();
      const subtype = (row.SubType ?? "").trim();
      const group = (row.Group ?? "").trim();
      const associationText = (row.Share ?? "").trim();
      const association = associationText.toLowerCase();
      const houseRaw = (row["Our share"] ?? "").trim();
      const houseAmount = houseRaw ? parseAmount(houseRaw) : 0;
      const issue = (reason: string) => plan.problems.push({ lineNumber, date: date ?? "", description, reason });

      if (!date) { issue("Date must be D/M/YYYY or YYYY-MM-DD."); continue; }
      if (amount === null || amount === 0) { issue("Debit($AUD) must contain a non-zero AUD amount."); continue; }
      if (houseAmount === null) { issue("Our share must be a valid AUD amount."); continue; }
      if (status && status.toLowerCase() !== "settled") { issue("Status must be Settled or blank."); continue; }
      if (association && !ASSOCIATIONS.has(association)) { issue("Share must be a supported association value or blank."); continue; }
      if ((association === "friend" || association === "group" || association === "trip") && !group) {
        issue("Group is required for Friend, Group, and Trip rows."); continue;
      }
      const historyKey = await digestLine(rawLine);
      const rowPlan: HistoryImportRow = {
        lineNumber,
        date,
        description,
        bankAmountCents: Math.abs(amount),
        amountCents: Math.max(Math.abs(amount), Math.abs(houseAmount)),
        houseCents: Math.abs(houseAmount),
        association,
        isRefund: amount < 0 || association === "refund",
        status,
        subtype,
        group,
        historyKey,
        bankRowId: null,
        note: Math.abs(houseAmount) > Math.abs(amount) ? "Gift card or points" : "",
      };
      if (existingKeys.has(historyKey)) {
        plan.skipped.push(rowPlan);
      } else {
        if (!association) {
          plan.pending.push(rowPlan);
        } else {
          const bankRow = matchBankRow(date, rowPlan.bankAmountCents, accountId, ledger, claimedRows);
          if (bankRow) {
            rowPlan.bankRowId = bankRow.id;
            claimedRows.add(bankRow.id);
            plan.matched.push(rowPlan);
          }
          if (association === "payment") plan.skipped.push(rowPlan);
          else plan.created.push(rowPlan);
        }
      }
  }
  return plan;
}

function findOrCreateEntity(ledger: Ledger, name: string, kind: Entity["kind"], updatedAt: string): string {
  const existing = ledger.entities.find((entity) => entity.kind === kind && entity.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  ledger.entities.push({ id, kind, name, archived: false, updatedAt });
  return id;
}

function findOrCreateCategory(ledger: Ledger, name: string, updatedAt: string): string | null {
  if (!name || ASSOCIATIONS.has(name.toLowerCase())) return null;
  ledger.categories ??= [];
  const existing = ledger.categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  ledger.categories.push({ id, name, archived: false, updatedAt });
  return id;
}

function portionsFor(row: HistoryImportRow, ledger: Ledger): { kind: Entry["kind"]; portions: Portion[] } {
  const association = row.association;
  const kind: Entry["kind"] = row.isRefund ? "refund" : "spend";
  let houseCents = row.houseCents;
  if (association === "house" && !houseCents) houseCents = row.amountCents;
  if (association === "refund" && !houseCents) {
    return { kind, portions: [{ entityId: SELF_ENTITY_ID, amountCents: row.amountCents }] };
  }

  const portions: Portion[] = [];
  if (houseCents > 0) portions.push({ entityId: HOUSE_ENTITY_ID, amountCents: houseCents });
  const remainder = row.amountCents - houseCents;
  if (remainder > 0) {
    if (association === "friend") {
      portions.push({ entityId: findOrCreateEntity(ledger, row.group, "person", new Date().toISOString()), amountCents: remainder });
    } else if (association === "group" || association === "trip") {
      portions.push({ entityId: findOrCreateEntity(ledger, row.group, "group", new Date().toISOString()), amountCents: remainder });
    } else {
      portions.push({ entityId: SELF_ENTITY_ID, amountCents: remainder });
    }
  }
  return { kind, portions };
}

export function applyHistoryImport(plan: HistoryImportPlan, ledger: Ledger): Ledger {
  const next: Ledger = {
    ...ledger,
    entities: [...ledger.entities],
    entries: [...ledger.entries],
    categories: [...(ledger.categories ?? [])],
    bankRows: [...(ledger.bankRows ?? [])],
  };
  const updatedAt = new Date().toISOString();
  const skippedPayments = new Set(plan.skipped.filter((row) => row.association === "payment" && row.bankRowId).map((row) => row.bankRowId));
  next.bankRows = (next.bankRows ?? []).map((row) => skippedPayments.has(row.id) ? { ...row, skipped: true, updatedAt } : row);
  const knownKeys = new Set(next.entries.map((entry) => entry.historyKey).filter((key): key is string => Boolean(key)));

  for (const row of plan.created) {
    if (knownKeys.has(row.historyKey)) continue;
    const { kind, portions } = portionsFor(row, next);
    const categoryId = findOrCreateCategory(next, row.subtype, updatedAt);
    const entry: Entry = {
      id: crypto.randomUUID(),
      kind,
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      payerEntityId: SELF_ENTITY_ID,
      accountId: plan.accountId,
      portions,
      ...(row.bankRowId ? { bankRowIds: [row.bankRowId] } : {}),
      source: "history",
      categoryId,
      tags: ["history"],
      ...(row.note ? { note: row.note, extraReimbursable: false } : {}),
      historyKey: row.historyKey,
      countsTowardDebt: row.status.toLowerCase() !== "settled",
      updatedAt,
    };
    next.entries.push(entry);
    if (row.bankRowId) {
      next.bankRows = next.bankRows.map((bankRow) => bankRow.id === row.bankRowId ? { ...bankRow, entryId: entry.id, updatedAt } : bankRow);
    }
  }
  return next;
}