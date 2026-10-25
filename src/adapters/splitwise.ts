import type { Entry, Entity, Ledger } from "../domain/ledger";
import { parseAud } from "../domain/value";

const baseUrl = "https://secure.splitwise.com/api/v3.0";
let apiKey = "";

export interface SplitwiseUser {
  id: number;
  first_name: string;
  last_name: string;
}

export interface SplitwiseGroup {
  id: number;
  name: string;
  members: SplitwiseUser[];
}

export interface SplitwiseExpenseShare {
  userId: number;
  name: string;
  paidCents: number;
  owedCents: number;
}

export interface SplitwiseExpenseDraft {
  groupId: number;
  costCents: number;
  description: string;
  date: string;
  shares: SplitwiseExpenseShare[];
}

export class SplitwiseNoResponseError extends Error {
  constructor() {
    super("Splitwise did not return a response. Check Splitwise before retrying.");
    this.name = "SplitwiseNoResponseError";
  }
}

export interface SplitwiseExpense {
  id: number;
  group_id: number | null;
  description: string;
  date: string;
  cost: string;
  currency_code: string;
  payment: boolean;
  updated_at: string;
  deleted_at: string | null;
  users: Array<{ user_id: number; paid_share: string; owed_share: string }>;
}

export interface SplitwiseInboxItem {
  id: string;
  splitwiseExpenseId: string;
  entityId: string;
  date: string;
  description: string;
  costCents: number;
  yourPaidCents: number;
  yourOwedCents: number;
  isPayment: boolean;
  status: "new" | "changed" | "deleted" | "done" | "dismissed";
  updatedAt: string;
  previous?: {
    date: string;
    description: string;
    costCents: number;
    yourPaidCents: number;
    yourOwedCents: number;
  };
}

interface SplitwisePayload<T> {
  errors?: unknown;
  [key: string]: unknown;
  data?: T;
}

type PullCursor = { datedAfter?: string; updatedAfter?: string };

export function setKey(key: string): void {
  apiKey = key.trim();
}

export function hasKey(): boolean {
  return apiKey.length > 0;
}

async function request<T>(path: string, params?: URLSearchParams): Promise<T> {
  if (!hasKey()) throw new Error("Connect Splitwise with an API key first.");
  const url = new URL(`${baseUrl}/${path}`);
  if (params) url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new Error("Could not reach Splitwise. Check your connection and browser CORS access.");
  }

  let payload: SplitwisePayload<T>;
  try {
    payload = await response.json() as SplitwisePayload<T>;
  } catch {
    throw new Error("Splitwise returned an unreadable response.");
  }
  const errors = payload && typeof payload === "object" ? payload.errors : undefined;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : errors && typeof errors === "object"
      ? Object.keys(errors).length > 0
      : Boolean(errors);
  if (!response.ok || hasErrors) {
    throw new Error("Splitwise rejected the request. Check the API key and account access.");
  }
  return payload as T;
}

export async function getCurrentUser(): Promise<SplitwiseUser> {
  const result = await request<{ user: SplitwiseUser }>("get_current_user");
  return result.user;
}

export async function getFriends(): Promise<SplitwiseUser[]> {
  const result = await request<{ friends: SplitwiseUser[] }>("get_friends");
  return result.friends;
}

export async function getGroups(): Promise<SplitwiseGroup[]> {
  const result = await request<{ groups: SplitwiseGroup[] }>("get_groups");
  return result.groups.filter((group) => group.id !== 0);
}

export function buildExpense(
  entry: Entry,
  portion: Entry["portions"][number],
  entity: Entity,
  members: SplitwiseUser[],
  youId: number,
): SplitwiseExpenseDraft {
  if (entry.kind !== "spend" || entry.payerEntityId !== "self") {
    throw new Error("Only spends paid by you can be posted.");
  }
  if (!entity.splitwise || !entry.portions.some((candidate) =>
    candidate.entityId === portion.entityId && candidate.amountCents === portion.amountCents
  ) || portion.entityId !== entity.id || entity.kind === "self" || entity.kind === "house") {
    throw new Error("Choose a linked person or group portion.");
  }
  if (!Number.isSafeInteger(youId) || youId <= 0) throw new Error("Splitwise returned an invalid user ID.");

  if (entity.splitwise.kind === "user") {
    const friendId = Number(entity.splitwise.id);
    if (!Number.isSafeInteger(friendId) || friendId <= 0 || friendId === youId) {
      throw new Error("The linked Splitwise friend is invalid.");
    }
    return {
      groupId: 0,
      costCents: portion.amountCents,
      description: entry.description,
      date: entry.date,
      shares: [
        { userId: youId, name: "You", paidCents: portion.amountCents, owedCents: 0 },
        { userId: friendId, name: entity.name, paidCents: 0, owedCents: portion.amountCents },
      ],
    };
  }

  if (entity.splitwise.kind !== "group") throw new Error("The linked Splitwise group is invalid.");
  const groupId = Number(entity.splitwise.id);
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new Error("The linked Splitwise group is invalid.");
  const otherMembers = members.filter((member, index) =>
    member.id !== youId && members.findIndex((candidate) => candidate.id === member.id) === index
  );
  if (!otherMembers.length || otherMembers.some((member) => !Number.isSafeInteger(member.id) || member.id <= 0)) {
    throw new Error("The linked Splitwise group has no other members.");
  }
  const selfPortion = entry.portions.find((candidate) => candidate.entityId === "self")?.amountCents ?? 0;
  const costCents = selfPortion + portion.amountCents;
  if (!Number.isSafeInteger(costCents) || costCents <= 0) throw new Error("The group expense amount is invalid.");
  const memberShare = Math.floor(portion.amountCents / otherMembers.length);
  let remainder = portion.amountCents % otherMembers.length;
  return {
    groupId,
    costCents,
    description: entry.description,
    date: entry.date,
    shares: [
      { userId: youId, name: "You", paidCents: costCents, owedCents: selfPortion },
      ...otherMembers.map((member) => {
        const owedCents = memberShare + (remainder > 0 ? 1 : 0);
        remainder -= remainder > 0 ? 1 : 0;
        return { userId: member.id, name: `${member.first_name} ${member.last_name}`.trim(), paidCents: 0, owedCents };
      }),
    ],
  };
}

function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export async function postExpense(draft: SplitwiseExpenseDraft): Promise<number> {
  if (!hasKey()) throw new Error("Connect Splitwise with an API key first.");
  const userIds = new Set<number>();
  const validShares = draft.shares.length >= 2 && draft.shares.every((share) => {
    const valid = Number.isSafeInteger(share.userId) && share.userId > 0 && !userIds.has(share.userId) &&
      Number.isSafeInteger(share.paidCents) && share.paidCents >= 0 &&
      Number.isSafeInteger(share.owedCents) && share.owedCents >= 0;
    userIds.add(share.userId);
    return valid;
  });
  if (!Number.isSafeInteger(draft.costCents) || draft.costCents <= 0 || !validShares) {
    throw new Error("Splitwise paid and owed shares must each sum to the expense cost.");
  }
  const paidTotal = draft.shares.reduce((total, share) => total + BigInt(share.paidCents), 0n);
  const owedTotal = draft.shares.reduce((total, share) => total + BigInt(share.owedCents), 0n);
  if (paidTotal !== BigInt(draft.costCents) || owedTotal !== BigInt(draft.costCents)) {
    throw new Error("Splitwise paid and owed shares must each sum to the expense cost.");
  }
  const body = new URLSearchParams({
    cost: formatCents(draft.costCents),
    description: draft.description,
    date: draft.date,
    currency_code: "AUD",
    group_id: String(draft.groupId),
  });
  draft.shares.forEach((share, index) => {
    body.set(`users__${index}__user_id`, String(share.userId));
    body.set(`users__${index}__paid_share`, formatCents(share.paidCents));
    body.set(`users__${index}__owed_share`, formatCents(share.owedCents));
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/create_expense`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    throw new SplitwiseNoResponseError();
  }

  let payload: { expenses?: Array<{ id?: number }>; errors?: unknown };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new Error("Splitwise returned an unreadable response.");
  }
  if (!payload || typeof payload !== "object") throw new Error("Splitwise returned an unreadable response.");
  const errors = payload && typeof payload === "object" ? payload.errors : undefined;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : errors && typeof errors === "object"
      ? Object.keys(errors).length > 0
      : Boolean(errors);
  const expenseId = payload.expenses?.[0]?.id;
  if (!response.ok || hasErrors || !Number.isSafeInteger(expenseId) || (expenseId ?? 0) <= 0) {
    throw new Error("Splitwise rejected the expense. Check the shares and account access.");
  }
  return expenseId as number;
}

export async function getExpenses(
  link: { kind: "user" | "group"; id: string },
  cursor: PullCursor,
): Promise<SplitwiseExpense[]> {
  const expenses: SplitwiseExpense[] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      [link.kind === "user" ? "friend_id" : "group_id"]: link.id,
      limit: "100",
      offset: String(offset),
    });
    if (cursor.datedAfter) params.set("dated_after", cursor.datedAfter);
    if (cursor.updatedAfter) params.set("updated_after", cursor.updatedAfter);
    const result = await request<{ expenses: SplitwiseExpense[] }>("get_expenses", params);
    const page = result.expenses;
    for (const expense of page) {
      if (expense.currency_code !== "AUD") throw new Error("Splitwise expenses must use AUD.");
      parseAud(expense.cost);
      for (const user of expense.users) {
        parseAud(user.paid_share);
        parseAud(user.owed_share);
      }
    }
    expenses.push(...page);
    if (page.length < 100) return expenses;
    offset += page.length;
  }
}

function valuesFor(expense: SplitwiseExpense, currentUserId: number) {
  const currentUser = expense.users.find((user) => user.user_id === currentUserId);
  return {
    costCents: parseAud(expense.cost),
    yourPaidCents: currentUser ? parseAud(currentUser.paid_share) : 0,
    yourOwedCents: currentUser ? parseAud(currentUser.owed_share) : 0,
  };
}

export function pullIntoInbox(
  ledger: Ledger,
  entity: Entity,
  expenses: SplitwiseExpense[],
  currentUserId: number,
  pulledAt = new Date().toISOString(),
): Ledger {
  if (!entity.splitwise) throw new Error("Link this person or group to Splitwise first.");
  const inbox = ledger.splitwiseInbox ?? [];
  const nextInbox = [...inbox];

  for (const expense of expenses) {
    if (entity.splitwise.kind === "user" && expense.group_id !== null && expense.group_id !== 0) continue;
    const { costCents, yourPaidCents, yourOwedCents } = valuesFor(expense, currentUserId);
    if (yourPaidCents === 0 && yourOwedCents === 0) continue;
    const expenseId = String(expense.id);
    const existingInbox = nextInbox.find((item) => item.splitwiseExpenseId === expenseId);
    const existingEntry = ledger.entries.find((entry) => entry.splitwiseExpenseId === expenseId);
    const existingPost = (ledger.splitwisePosts ?? []).find((post) => post.splitwiseExpenseId === expenseId);
    const priorUpdatedAt = existingInbox?.updatedAt ?? existingPost?.updatedAt;
    if (existingEntry || existingPost || existingInbox) {
      if (expense.deleted_at || priorUpdatedAt !== expense.updated_at) {
        const previous = existingInbox ? {
          date: existingInbox.date,
          description: existingInbox.description,
          costCents: existingInbox.costCents,
          yourPaidCents: existingInbox.yourPaidCents,
          yourOwedCents: existingInbox.yourOwedCents,
        } : undefined;
        const revised = {
          id: existingInbox?.id ?? crypto.randomUUID(),
          splitwiseExpenseId: expenseId,
          entityId: entity.id,
          date: expense.date.slice(0, 10),
          description: expense.description,
          costCents,
          yourPaidCents,
          yourOwedCents,
          isPayment: expense.payment,
          status: expense.deleted_at ? "deleted" as const : "changed" as const,
          updatedAt: expense.updated_at,
          previous,
        };
        if (existingInbox) Object.assign(existingInbox, revised);
        else nextInbox.push(revised);
      }
      continue;
    }
    nextInbox.push({
      id: crypto.randomUUID(),
      splitwiseExpenseId: expenseId,
      entityId: entity.id,
      date: expense.date.slice(0, 10),
      description: expense.description,
      costCents,
      yourPaidCents,
      yourOwedCents,
      isPayment: expense.payment,
      status: expense.deleted_at ? "deleted" : "new",
      updatedAt: expense.updated_at,
    });
  }

  const syncs = ledger.splitwiseSync ?? [];
  const sync = syncs.find((item) => item.entityId === entity.id);
  const nextSyncs = sync
    ? syncs.map((item) => item === sync ? { ...item, lastPulledAt: pulledAt, updatedAt: pulledAt } : item)
    : [...syncs, { id: crypto.randomUUID(), entityId: entity.id, lastPulledAt: pulledAt, updatedAt: pulledAt }];
  return { ...ledger, splitwiseInbox: nextInbox, splitwiseSync: nextSyncs };
}

export function createSplitwiseSpend(ledger: Ledger, item: SplitwiseInboxItem): Ledger {
  if (ledger.entries.some((entry) => entry.splitwiseExpenseId === item.splitwiseExpenseId)) return ledger;
  const entity = ledger.entities.find((candidate) => candidate.id === item.entityId);
  if (!entity || item.costCents <= 0 || item.yourOwedCents > item.costCents) return ledger;
  const payerEntityId = item.yourPaidCents === 0 ? entity.id : "self";
  const portions = [
    ...(item.yourOwedCents > 0 ? [{ entityId: "self", amountCents: item.yourOwedCents }] : []),
    ...(item.costCents - item.yourOwedCents > 0
      ? [{ entityId: entity.id, amountCents: item.costCents - item.yourOwedCents }]
      : []),
  ];
  const entry: Entry = {
    id: crypto.randomUUID(),
    kind: "spend",
    date: item.date,
    description: item.description,
    amountCents: item.costCents,
    payerEntityId,
    accountId: null,
    portions,
    countsTowardDebt: true,
    splitwiseExpenseId: item.splitwiseExpenseId,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...ledger,
    entries: [...ledger.entries, entry],
    splitwiseInbox: (ledger.splitwiseInbox ?? []).map((candidate) => candidate.id === item.id
      ? { ...candidate, status: "done" }
      : candidate),
  };
}
