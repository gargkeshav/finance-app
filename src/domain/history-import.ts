import Papa from "papaparse";
import {
  balances,
  defaultSplitPreset,
  HOUSE_ENTITY_ID,
  SELF_ENTITY_ID,
  splitPreset,
  type BankRow,
  type Entry,
  type Entity,
  type EntryKind,
  type GroupType,
  type Ledger,
  type Portion,
} from "./ledger";
import { ledgerProblem } from "../adapters/file-ledger";
import { STARTER_CATEGORIES } from "./taxonomy";
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
  myCents: number | null;
  association: string;
  isRefund: boolean;
  status: string;
  subtype: string;
  group: string;
  historyKey: string;
  bankRowId: string | null;
  note: string;
  tags: string[];
}

export type GroupMap =
  | { to: "person" | "group"; name: string; groupType?: GroupType }
  | { to: "self"; tag?: string };

export type SubtypeMap =
  | { to: "category"; name: string | null }
  | { to: "merchant"; displayName: string; category: string | null }
  | { to: "tag"; tag: string; category: string | null };

export interface HistoryMapping {
  groups: Record<string, GroupMap>;
  subtypes: Record<string, SubtypeMap>;
  blankShare: "theyOweAll" | "splitEqual" | "groupDefault";
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
  payments: HistoryImportRow[];
  problems: HistoryImportProblem[];
  accountId: string;
}

export interface HistoryImportOptions {
  replace: boolean;
  removeEntityIds?: string[];
  removeCategoryIds?: string[];
}

export interface HistoryImportPreview {
  byKind: Record<EntryKind, number>;
  payments: number;
  needsShare: number;
  entitiesCreated: string[];
  entitiesMerged: string[];
  categoriesCreated: string[];
  categoriesMerged: string[];
  unreferencedEntities: Entity[];
  unreferencedCategories: NonNullable<Ledger["categories"]>;
  balancesBefore: ReturnType<typeof balances>["byEntity"];
  balancesAfter: ReturnType<typeof balances>["byEntity"];
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

  const plan: HistoryImportPlan = { matched: [], created: [], skipped: [], pending: [], payments: [], problems: [], accountId };
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
      const myRaw = (row["My share"] ?? "").trim();
      const myAmount = myRaw ? parseAmount(myRaw) : null;
      const issue = (reason: string) => plan.problems.push({ lineNumber, date: date ?? "", description, reason });

      if (!date) { issue("Date must be D/M/YYYY or YYYY-MM-DD."); continue; }
      if (amount === null || amount === 0) { issue("Debit($AUD) must contain a non-zero AUD amount."); continue; }
      if (houseAmount === null) { issue("Our share must be a valid AUD amount."); continue; }
      if (myRaw && myAmount === null) { issue("My share must be a valid AUD amount."); continue; }
      if (status && status.toLowerCase() !== "settled") { issue("Status must be Settled or blank."); continue; }
      if (association && !ASSOCIATIONS.has(association)) { issue("Share must be a supported association value or blank."); continue; }
      if ((association === "friend" || association === "group" || association === "trip") && !group) {
        issue("Group is required for Friend, Group, and Trip rows."); continue;
      }
      const historyKey = await digestLine(rawLine);
      const bankAmountCents = Math.abs(amount);
      const houseCents = Math.abs(houseAmount);
      const myCents = myAmount === null ? null : Math.abs(myAmount);
      const tags = (row.Tags ?? "").split(/[;,]/).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      const rowPlan: HistoryImportRow = {
        lineNumber,
        date,
        description,
        bankAmountCents,
        amountCents: Math.max(
          bankAmountCents,
          houseCents + ((association === "friend" || association === "group" || association === "trip") ? myCents ?? 0 : 0),
        ),
        houseCents,
        myCents,
        association,
        isRefund: amount < 0 || association === "refund",
        status,
        subtype,
        group,
        historyKey,
        bankRowId: null,
        note: (row.Notes ?? "").trim(),
        tags,
      };
      const bankRow = matchBankRow(date, rowPlan.bankAmountCents, accountId, ledger, claimedRows);
      if (bankRow) {
        rowPlan.bankRowId = bankRow.id;
        claimedRows.add(bankRow.id);
        plan.matched.push(rowPlan);
      }
      if (!association) plan.pending.push(rowPlan);
      else if (association === "payment") plan.payments.push(rowPlan);
      else plan.created.push(rowPlan);
  }
  return plan;
}

function keyOf(value: string): string {
  return value.trim().toLowerCase();
}

function starterNames(): string[] {
  return STARTER_CATEGORIES.flatMap((starter) => [starter.name, ...starter.children]);
}

const SUBTYPE_ALIASES: Record<string, string> = {
  food: "Restaurants and takeaway",
  swimming: "Fitness",
  internet: "Internet and phone",
  mobile: "Internet and phone",
  utility: "Utilities",
  stay: "Accommodation",
  ent: "Events and outings",
  gift: "Gifts",
  giftcard: "Gift cards",
  card: "Gift cards",
  donation: "Donations",
  misc: "General",
  shopping: "General",
};

export function suggestHistoryMapping(plan: HistoryImportPlan, ledger: Ledger): HistoryMapping {
  const mapping: HistoryMapping = {
    groups: { ...(ledger.historyMapping?.groups ?? {}) },
    subtypes: { ...(ledger.historyMapping?.subtypes ?? {}) },
    blankShare: ledger.historyMapping?.blankShare ?? "theyOweAll",
  };
  const rows = [...plan.created, ...plan.pending, ...plan.payments];
  const groupUses = new Map<string, Set<string>>();
  const subtypeValues = new Set<string>();

  for (const row of rows) {
    if (row.group) {
      const key = keyOf(row.group);
      const uses = groupUses.get(key) ?? new Set<string>();
      uses.add(row.association);
      groupUses.set(key, uses);
    }
    if (row.subtype) subtypeValues.add(row.subtype);
  }

  for (const [key, uses] of groupUses) {
    if (mapping.groups[key]) continue;
    const value = rows.find((row) => keyOf(row.group) === key)?.group ?? key;
    if (uses.has("group")) mapping.groups[key] = { to: "group", name: value, groupType: "friends" };
    else if (uses.has("trip")) mapping.groups[key] = { to: "group", name: value, groupType: "trip" };
    else if (uses.has("friend")) mapping.groups[key] = { to: "person", name: value };
    else mapping.groups[key] = { to: "person", name: value };
  }

  const availableCategories = [...(ledger.categories ?? []).map((category) => category.name), ...starterNames()];
  for (const subtype of subtypeValues) {
    const key = keyOf(subtype);
    if (mapping.subtypes[key]) continue;
    const existing = availableCategories.find((name) => keyOf(name) === key);
    const target = existing ?? SUBTYPE_ALIASES[key] ?? subtype;
    mapping.subtypes[key] = { to: "category", name: target || null };
  }
  return mapping;
}

function getGroupMapping(mapping: HistoryMapping, group: string): GroupMap | undefined {
  return mapping.groups[keyOf(group)];
}

function resolveEntity(ledger: Ledger, group: string, mapping: HistoryMapping, updatedAt: string): { id: string; tag?: string } {
  const selected = getGroupMapping(mapping, group) ?? { to: "person" as const, name: group };
  if (selected.to === "self") return { id: SELF_ENTITY_ID, ...(selected.tag ? { tag: keyOf(selected.tag) } : {}) };
  const kind = selected.to;
  const existing = ledger.entities.find((entity) => entity.kind === kind && keyOf(entity.name) === keyOf(selected.name));
  if (existing) return { id: existing.id };
  const entity: Entity = {
    id: crypto.randomUUID(),
    kind,
    name: selected.name.trim(),
    archived: false,
    updatedAt,
    ...(kind === "group" ? { groupType: selected.groupType ?? "other" } : {}),
  };
  ledger.entities.push(entity);
  return { id: entity.id };
}

function addCategory(ledger: Ledger, name: string, updatedAt: string, parentId?: string, nature?: string): string {
  ledger.categories ??= [];
  const existing = ledger.categories.find((category) => keyOf(category.name) === keyOf(name));
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  ledger.categories.push({
    id,
    name,
    archived: false,
    updatedAt,
    ...(parentId ? { parentId } : {}),
    ...(nature ? { nature: nature as NonNullable<Ledger["categories"]>[number]["nature"] } : {}),
  });
  return id;
}

function resolveCategory(ledger: Ledger, name: string | null, updatedAt: string): string | null {
  if (!name?.trim()) return null;
  const trimmed = name.trim();
  const existing = ledger.categories?.find((category) => keyOf(category.name) === keyOf(trimmed));
  if (existing) return existing.id;
  const parent = STARTER_CATEGORIES.find((starter) => keyOf(starter.name) === keyOf(trimmed));
  if (parent) return addCategory(ledger, parent.name, updatedAt, undefined, parent.nature);
  for (const starter of STARTER_CATEGORIES) {
    const child = starter.children.find((candidate) => keyOf(candidate) === keyOf(trimmed));
    if (!child) continue;
    const parentId = addCategory(ledger, starter.name, updatedAt, undefined, starter.nature);
    return addCategory(ledger, child, updatedAt, parentId);
  }
  return addCategory(ledger, trimmed, updatedAt);
}

function subtypeFor(mapping: HistoryMapping, subtype: string): SubtypeMap {
  return mapping.subtypes[keyOf(subtype)] ?? { to: "category", name: subtype || null };
}

function categoryForRow(ledger: Ledger, row: HistoryImportRow, mapping: HistoryMapping, updatedAt: string): {
  categoryId: string | null;
  displayName?: string;
  tags: string[];
} {
  const selected = subtypeFor(mapping, row.subtype);
  if (selected.to === "category") return { categoryId: resolveCategory(ledger, selected.name, updatedAt), tags: [] };
  if (selected.to === "merchant") return {
    categoryId: resolveCategory(ledger, selected.category, updatedAt),
    displayName: selected.displayName.trim() || undefined,
    tags: [],
  };
  return {
    categoryId: resolveCategory(ledger, selected.category, updatedAt),
    tags: selected.tag.trim() ? [keyOf(selected.tag)] : [],
  };
}

function equalShares(remainder: number, entityId: string): Portion[] {
  return splitPreset(remainder, SELF_ENTITY_ID, { kind: "equal", entityIds: [SELF_ENTITY_ID, entityId] });
}

function portionsFor(row: HistoryImportRow, mapping: HistoryMapping, ledger: Ledger, updatedAt: string): {
  kind: Entry["kind"];
  portions: Portion[];
  tags: string[];
} {
  if (row.association === "payment") return { kind: "transfer", portions: [], tags: [] };
  const kind: Entry["kind"] = row.isRefund ? "refund" : "spend";
  const usesGroup = row.association === "friend" || row.association === "group" || row.association === "trip" || row.association === "refund";
  const group = usesGroup && row.group ? resolveEntity(ledger, row.group, mapping, updatedAt) : undefined;
  const tags = group?.tag ? [group.tag] : [];
  if (row.isRefund) return {
    kind,
    portions: [{ entityId: group?.id ?? SELF_ENTITY_ID, amountCents: row.amountCents }],
    tags,
  };

  if (!row.association) return {
    kind: "spend",
    portions: [{ entityId: SELF_ENTITY_ID, amountCents: row.amountCents }],
    tags: [...tags, "needs-share"],
  };

  if (row.association === "personal" || row.association === "house") {
    const houseCents = row.association === "house" && row.houseCents === 0 ? row.amountCents : row.houseCents;
    const remainder = row.amountCents - houseCents;
    return {
      kind,
      portions: [
        ...(houseCents > 0 ? [{ entityId: HOUSE_ENTITY_ID, amountCents: houseCents }] : []),
        ...(remainder > 0 ? [{ entityId: SELF_ENTITY_ID, amountCents: remainder }] : []),
      ],
      tags,
    };
  }

  if (row.association === "friend" || row.association === "group" || row.association === "trip") {
    if (!group || group.id === SELF_ENTITY_ID) return { kind, portions: [{ entityId: SELF_ENTITY_ID, amountCents: row.amountCents }], tags };
    const portions: Portion[] = [];
    const houseCents = Math.min(row.houseCents, row.amountCents);
    if (houseCents > 0) portions.push({ entityId: HOUSE_ENTITY_ID, amountCents: houseCents });
    const myCents = Math.min(row.myCents ?? 0, row.amountCents - houseCents);
    if (myCents > 0) portions.push({ entityId: SELF_ENTITY_ID, amountCents: myCents });
    const remainder = row.amountCents - houseCents - myCents;
    if (remainder > 0) {
      if (mapping.blankShare === "theyOweAll") portions.push({ entityId: group.id, amountCents: remainder });
      else if (mapping.blankShare === "splitEqual") portions.push(...equalShares(remainder, group.id));
      else {
        const preset = defaultSplitPreset(ledger.entities.find((entity) => entity.id === group.id)!, remainder);
        portions.push(...(preset ? splitPreset(remainder, SELF_ENTITY_ID, preset) : equalShares(remainder, group.id)));
      }
    }
    return { kind, portions, tags };
  }

  return { kind, portions: [{ entityId: SELF_ENTITY_ID, amountCents: row.amountCents }], tags };
}

function isEntityReferenced(ledger: Ledger, id: string): boolean {
  return ledger.entries.some((entry) => entry.payerEntityId === id || entry.portions.some((portion) => portion.entityId === id)) ||
    ledger.accounts.some((account) => account.payerEntityId === id) ||
    ledger.baselines.some((baseline) => baseline.entityId === id) ||
    (ledger.settlements ?? []).some((settlement) => settlement.entityId === id) ||
    ledger.entities.some((entity) => entity.id !== id && entity.members?.some((member) => member.entityId === id));
}

function isCategoryReferenced(ledger: Ledger, id: string): boolean {
  return ledger.entries.some((entry) => entry.categoryId === id) ||
    (ledger.categoryMemory ?? []).some((memory) => memory.categoryId === id) ||
    (ledger.rules ?? []).some((rule) => rule.action.categoryId === id) ||
    (ledger.categories ?? []).some((category) => category.parentId === id);
}

function removeSelectedUnreferenced(ledger: Ledger, entityIds: string[], categoryIds: string[]): void {
  const removableEntities = new Set(entityIds.filter((id) => {
    const entity = ledger.entities.find((candidate) => candidate.id === id);
    return entity && entity.kind !== "self" && entity.kind !== "house" && !isEntityReferenced(ledger, id);
  }));
  const removableCategories = new Set(categoryIds.filter((id) => !isCategoryReferenced(ledger, id)));
  ledger.entities = ledger.entities.filter((entity) => !removableEntities.has(entity.id));
  ledger.categories = (ledger.categories ?? []).filter((category) => !removableCategories.has(category.id));
}

function unreferenced(ledger: Ledger): { entities: Entity[]; categories: NonNullable<Ledger["categories"]> } {
  return {
    entities: ledger.entities.filter((entity) => entity.kind !== "self" && entity.kind !== "house" && !isEntityReferenced(ledger, entity.id)),
    categories: (ledger.categories ?? []).filter((category) => !isCategoryReferenced(ledger, category.id)),
  };
}

function mappedEntries(plan: HistoryImportPlan): HistoryImportRow[] {
  return [...plan.created, ...plan.pending, ...plan.payments];
}

export function applyHistoryImport(
  plan: HistoryImportPlan,
  ledger: Ledger,
  mapping: HistoryMapping = suggestHistoryMapping(plan, ledger),
  options: HistoryImportOptions = { replace: false },
): Ledger {
  const historyEntries = ledger.entries.filter((entry) => entry.source === "history");
  if (options.replace && historyEntries.some((entry) => entry.bankRowIds?.length)) {
    throw new Error("Unlink bank rows from history entries first.");
  }

  const next: Ledger = {
    ...ledger,
    entities: [...ledger.entities],
    entries: ledger.entries.filter((entry) => !options.replace || entry.source !== "history"),
    categories: [...(ledger.categories ?? [])],
    bankRows: [...(ledger.bankRows ?? [])],
  };
  const updatedAt = new Date().toISOString();
  const knownKeys = new Set(next.entries.map((entry) => entry.historyKey).filter((key): key is string => Boolean(key)));

  for (const row of mappedEntries(plan)) {
    if (knownKeys.has(row.historyKey)) continue;
    const rowMapping = categoryForRow(next, row, mapping, updatedAt);
    const { kind, portions, tags: groupTags } = portionsFor(row, mapping, next, updatedAt);
    const payment = kind === "transfer";
    const giftCardCovered = !payment && row.houseCents > row.bankAmountCents;
    const note = row.note || (giftCardCovered || row.amountCents > row.bankAmountCents ? "Gift card or points" : "");
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
      categoryId: rowMapping.categoryId,
      ...(rowMapping.displayName ? { displayName: rowMapping.displayName } : {}),
      tags: ["history", ...row.tags, ...groupTags, ...rowMapping.tags,
        ...(payment ? ["card-payment"] : []), ...(row.association === "pending" ? ["needs-share"] : []),
        ...(giftCardCovered ? ["gift-card"] : [])],
      ...(note ? { note, extraReimbursable: false } : {}),
      ...(row.amountCents > row.bankAmountCents ? { chargedCents: row.bankAmountCents } : {}),
      historyKey: row.historyKey,
      countsTowardDebt: !payment && row.status.toLowerCase() !== "settled",
      updatedAt,
    };
    next.entries.push(entry);
    if (row.bankRowId) {
      next.bankRows = (next.bankRows ?? []).map((bankRow) => bankRow.id === row.bankRowId
        ? { ...bankRow, entryId: entry.id, skipped: false, updatedAt }
        : bankRow);
    }
  }

  next.historyMapping = {
    groups: { ...mapping.groups },
    subtypes: { ...mapping.subtypes },
    blankShare: mapping.blankShare,
  };
  removeSelectedUnreferenced(next, options.removeEntityIds ?? [], options.removeCategoryIds ?? []);
  const problem = ledgerProblem(next);
  if (problem) throw new Error(problem);
  return next;
}

function mergedNames(
  mappings: Record<string, GroupMap | SubtypeMap>,
  existingNames: string[],
  nameOf: (mapping: GroupMap | SubtypeMap) => string | null,
): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const mapping of Object.values(mappings)) {
    const name = nameOf(mapping)?.trim();
    if (!name) continue;
    const key = keyOf(name);
    const current = counts.get(key) ?? { name, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].filter((item) => item.count > 1 || existingNames.some((name) => keyOf(name) === keyOf(item.name)))
    .map((item) => item.name);
}

export function previewHistoryImport(
  plan: HistoryImportPlan,
  ledger: Ledger,
  mapping: HistoryMapping = suggestHistoryMapping(plan, ledger),
  options: HistoryImportOptions = { replace: false },
): HistoryImportPreview {
  const next = applyHistoryImport(plan, ledger, mapping, { ...options, removeEntityIds: [], removeCategoryIds: [] });
  const unused = unreferenced(next);
  const createdEntities = next.entities.filter((entity) => !ledger.entities.some((old) => old.id === entity.id));
  const createdCategories = (next.categories ?? []).filter((category) => !(ledger.categories ?? []).some((old) => old.id === category.id));
  const categoriesByMapping: Record<string, GroupMap | SubtypeMap> = Object.fromEntries(Object.entries(mapping.subtypes));
  const groupMap: Record<string, GroupMap | SubtypeMap> = Object.fromEntries(Object.entries(mapping.groups));
  const rows = mappedEntries(plan);
  const byKind: Record<EntryKind, number> = { spend: 0, refund: 0, transfer: 0, income: 0 };
  for (const row of rows) byKind[row.association === "payment" ? "transfer" : row.isRefund ? "refund" : "spend"] += 1;
  return {
    byKind,
    payments: plan.payments.length,
    needsShare: plan.pending.length,
    entitiesCreated: createdEntities.map((entity) => entity.name),
    entitiesMerged: mergedNames(groupMap, ledger.entities.map((entity) => entity.name), (item) =>
      item.to === "person" || item.to === "group" ? item.name : null),
    categoriesCreated: createdCategories.map((category) => category.name),
    categoriesMerged: mergedNames(categoriesByMapping, (ledger.categories ?? []).map((category) => category.name), (item) =>
      item.to === "category" ? item.name : item.to === "merchant" || item.to === "tag" ? item.category : null),
    unreferencedEntities: unused.entities,
    unreferencedCategories: unused.categories,
    balancesBefore: balances(ledger).byEntity,
    balancesAfter: balances(next).byEntity,
  };
}