# Finance app: distillation

A dense reference to the app's intent and its implementation as of batch 41 (branch `claude/finance-app-reconciliation-48d40d`). It was written from the docs and the source; no `*.finance.json` was read. Line numbers are `file:line` at the time of writing. If this file disagrees with `copilot-instructions.md`, `PHASE2–4.md`, or a prompt, those files win for workflow rules, and the code wins for behaviour.

---

## 1. Purpose and intentions

A local, single-user **AUD** ledger that runs in the browser under `npm run dev` (`http://127.0.0.1:5173`). There is no desktop app or backend. One JSON file (`*.finance.json`) is the whole database.

What the user wants it to do:

| Goal | How the model expresses it |
|---|---|
| Track **personal** spending | `self` portions, plus half of every `house` portion (personal report) |
| Track **House** (joint household) spending | A `house` entity; House accounts have `payerEntityId: "house"`; House portions on your card mean House owes you |
| Track **shared debts** with a partner or housemate (for example Trisha) and friends | `person` entities; a portion for a non-payer entity is a debt (`debtsOf`) |
| Track **groups** (trips, friend circles, projects) | `group` entities with `groupType`, optional `members` and `defaultAllocation`. A group is **one** entity, not a list of debtors |
| **Splitwise** friends and groups | Entities linked by `entity.splitwise = { kind: "user" \| "group", id }`; pull to an inbox, post expenses and payments |
| **Bank CSV import** (ING, HSBC, ANZ credit, ANZ transaction, custom) | `mappings` → `imports` → immutable `bankRows` → Review turns rows into entries, transfers, or settlements |
| **Settlement** (paying back) | `settlements` (self ↔ one entity, allocated oldest-first by `openItems`; or, with `paidToEntityId`, between two other entities, e.g. House paying Trisha) |
| Reconcile **automatically** | Rules, category memory, transfer pairing, history matching. Only rows that need a decision reach the user (Review's "needs you") |
| One-off **historic import** of a hand-kept ANZ credit spreadsheet | `history-import.ts` (H1, then v2 in batch 29) |

Roadmap ("Later", not yet prompts): recurring payments, month close, settle-up helpers, receipt photos stored locally, optional encryption (PHASE3); eventually a phone app with OCR and a backend (README). Quick add and the command palette from PHASE3's list were done in batch 38 (⌘K).

---

## 2. Money rules and invariants

These come from `.github/copilot-instructions.md` ("Money rules"), `CONTEXT.md`, and PHASE3 "Model rules", checked against the code.

1. **Money is integer cents.** No floats. `centsSchema` is a safe integer (`value.ts:4`). Parsing goes through `parseAud` (`value.ts:11`, decimal.js, at most 2 dp). Sums use BigInt (`sumCents`, `value.ts:35`).
2. **Dates are `YYYY-MM-DD`**, with no timezone shifts. `bankDateSchema` / `isBankDate` (`value.ts:56,73`) requires year ≥ 1900. Day arithmetic uses `Date.UTC`.
3. **Every account has a payer entity** (`Account.payerEntityId`). An entity is self, House, a person, or a group.
4. **A spend has one payer, and its portions sum to its amount.** Portions are unique per entity and positive (`validateSpend`, `ledger.ts:352`; enforced for `spend` **and** `refund` in `entrySchema.superRefine`, `file-ledger.ts:167`).
5. **A portion for an entity other than the payer is a debt**: that entity owes the payer. A portion for the payer is report-only. From batch 26, only portions with `treatment ?? "claim" === "claim"` create debt; `writeOff`, `gift`, and `reportOnly` do not (`debtsOf`, `ledger.ts:374`).
6. **A House account is always paid by House.** A self portion on it means you owe House.
7. **Personal report = self portions + half of House portions, with the odd cent to self** (`Math.ceil(|house|/2)`). That half is never a debt. Household scope = all House portions (`report` `ledger.ts:411`, `scopeAmount` `reports.ts:72`, `filteredTotals` `query.ts:86`). Refunds count negative.
8. **Transfers, settlements, income, and skipped rows are never spending.** `report`/`scopeAmount` only look at `spend`/`refund`.
9. **Bank rows never change.** Interpretation lives on entries. Rows only gain links (`entryId`, `settlementId`, `skipped`, `dismissedTransferIds`).
10. **Every record has `id` and `updatedAt`.** There is no global revision counter. `schemaVersion: 1` is fixed; new keys are optional and default on load. A version above 1 is rejected (`migrate`, `file-ledger.ts:447`).
11. **`countsTowardDebt: false`** removes an entry from debts (older-history imports, settled history rows, Splitwise deletions kept out), but not from reports.
12. **An amended amount needs a note.** A bank-linked `spend` whose amount differs from the |sum| of its rows must have a non-empty `note` (`file-ledger.ts:393-397`). When the bank amount is *smaller* than the entry and `extraReimbursable` is false, debts are **scaled down** to the bank amount, with the rounding remainder on the largest debt (`debtsOf`, `ledger.ts:385-408`).
13. **A refund must reference an existing spend** (`refundOf`), except history refunds (`source: "history"`).
14. **Each fact has one home** (PHASE3): category = what, `displayName` = where (merchant), portions/entities = who, `groupType` = kind of group, `treatment` = claimed or not, tags = why/occasion, `note` = free text, account = how it was paid. A card payment is a transfer, never spending. System tags: `history`, `card-payment`, `needs-share`, `gift-card` (plus `deleted-in-splitwise`, set by Review).
15. **Automation fills review rows only, and stores its source** (`source: "rule" | "memory"`, `ruleId`). From batch 33, rules may edit existing entries only with `scope` `existingEntries`/`both`, and by default never edit `manual`/sourceless entries (`protectManualEdits`).
16. **Privacy**: never read or commit the real ledger, real CSVs, or Splitwise cURL. The cURL lives only in dev-server memory.

---

## 3. Data model

`Ledger` and the core interfaces live in `src/domain/ledger.ts:17-177`. Zod schemas (the persisted truth) live in `src/adapters/file-ledger.ts:70-399`. `file-ledger.ts:12-29` **augments** `Entity`, `Entry`, and `Ledger` through `declare module` with the Splitwise and history fields, so those fields are only typed when `file-ledger.ts` is in the compilation.

### 3.1 Top-level file (`ledgerSchema`, `file-ledger.ts:340`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `schemaVersion` | `1` | required | |
| `entities` | `Entity[]` | `[]` | `emptyLedger()` seeds `{id:"self",kind:"self",name:"You"}` and `{id:"house",kind:"house",name:"House"}` |
| `accounts` | `Account[]` | `[]` | |
| `entries` | `Entry[]` | `[]` | spends, refunds, transfers, income |
| `baselines` | `Baseline[]` | `[]` | opening balances per entity |
| `settlements` | `Settlement[]` | `[]` | |
| `mappings` | `CsvMapping[]` | `[]` | saved CSV column mappings |
| `imports` | `LedgerImport[]` | `[]` | one per committed CSV file |
| `bankRows` | `BankRow[]` | `[]` | immutable evidence |
| `checkpoints` | `BalanceCheckpoint[]` | `[]` | known account balances |
| `splitwiseSync` | `SplitwiseSync[]` | `[]` | last pull per entity |
| `splitwiseInbox` | `SplitwiseInbox[]` | `[]` | pulled expenses awaiting review |
| `splitwisePosts` | `SplitwisePost[]` | `[]` | outgoing posts and their state |
| `categories` | `Category[]` | `[]` | two-level tree, with no cycles (validated) |
| `categoryMemory` | `CategoryMemory[]` | `[]` | remembered category/entity per account+merchant |
| `merchantNames` | `MerchantName[]` | `[]` | remembered display names |
| `rules` | `EntryRule[]` | `[]` | |
| `history` | `ChangeSet[]` | `[]` | change log, last 200 kept (`LocalApp.tsx:385`) |
| `historyMapping` | `HistoryMapping` | optional | last history-import choices |
| `lastSplitByAccount` | `Record<accountId, SplitPreset>` | optional | "Last split on this account" |

`superRefine` checks category parent existence and cycles, that a refund's `refundOf` points to a `spend`, and the amended-amount note rule.

### 3.2 Entity (`entitySchema`, `file-ledger.ts:112`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `"self"` and `"house"` are fixed ids (`SELF_ENTITY_ID`, `HOUSE_ENTITY_ID`, `ledger.ts:7-8`) |
| `kind` | `"self" \| "house" \| "person" \| "group"` | |
| `name` | string (non-empty) | |
| `archived` | boolean | hidden from pickers; still in balances |
| `groupType?` | `"household" \| "trip" \| "friends" \| "project" \| "other"` | batch 25 |
| `members?` | `{ entityId, weight: int>0 }[]` | used only by `defaultSplitPreset`, never for debts |
| `defaultAllocation?` | `{mode:"shares"}` \| `{mode:"percent", yourPercent: 0..100}` | default split for new spends |
| `splitwise?` | `{ kind: "user" \| "group", id: string }` | Splitwise link (augmented) |
| `updatedAt` | string | |

`house` with no `defaultAllocation` defaults to `halfHouse` (`defaultSplitPreset`, `ledger.ts:284`).

### 3.3 Account (`file-ledger.ts:127`)

`id`, `name`, `type: "asset" | "credit"`, `payerEntityId`, `mappingId?` (the saved CSV mapping or preset id), `updatedAt`. The Accounts UI offers You, House, and people as payers, but not groups (batch 40).

### 3.4 Entry (`entrySchema`, `file-ledger.ts:142`)

| Field | Type / default | Meaning |
|---|---|---|
| `id` | string | |
| `kind` | `"spend" \| "transfer" \| "income" \| "refund"` | |
| `date` | `YYYY-MM-DD` | |
| `description` | string | raw bank description (never replaced by the display name) |
| `amountCents` | int > 0 | always positive; the sign comes from `kind` |
| `payerEntityId` | string | who paid |
| `accountId` | string \| null | null for Splitwise-born and same-payer transfer entries |
| `portions` | `Portion[]` | `[]` for transfer and income |
| `refundOf?` | string \| null | required for non-history refunds |
| `bankRowIds` | string[] = `[]` | linked evidence |
| `categoryId` | string \| null = `null` | |
| `tags` | string[] = `[]` | |
| `note` | string = `""` | |
| `extraReimbursable` | bool = `false` | when the entry is larger than the bank amount, true keeps the full debt |
| `chargedCents?` | int > 0 | what the account actually charged (gift card or points), batch 29 |
| `historyKey?` | string | SHA-256 of the raw history CSV line; dedupe key |
| `countsTowardDebt` | boolean (required) | |
| `splitwiseExpenseId?` | string \| null | link to a Splitwise expense |
| `source?` | `"manual" \| "bank" \| "splitwise" \| "rule" \| "memory" \| "history"` | origin; when missing it is derived (see §8) |
| `ruleId?` | string | rule that created it |
| `displayName?` | string | merchant name shown beside `description` |
| `updatedAt` | string | |

**Portion** (`file-ledger.ts:136`): `{ entityId, amountCents: int>0, treatment?: "claim" | "writeOff" | "gift" | "reportOnly" }`. `undefined` means claim.

### 3.5 Baseline, Settlement, Checkpoint

- **Baseline** (`file-ledger.ts:180`): `{ id, entityId, amountCents (signed: + = they owe you), updatedAt }`. It has no date and sorts first in `openItems`. Edited in Balances.
- **Settlement** (`file-ledger.ts:187`): `{ id, date, entityId, direction: "theyPaidYou" | "youPaidThem", amountCents>0, bankRowIds = [], note, splitwisePaymentId: string|null = null, updatedAt }`. Between self and `entityId`, unless optional `paidToEntityId` is set: then `entityId` paid `paidToEntityId` (e.g. House → Trisha), `direction` is `theyPaidYou` by convention, and it only reduces that pair in `betweenEntities`. Own-balance code (`openItems`, cash flow, Settle and Entity lists) skips these.
- **BalanceCheckpoint** (`file-ledger.ts:229`): `{ id, accountId, date, balanceCents (signed), note, updatedAt }`.

### 3.6 Imports and bank rows

- **LedgerImport** (`file-ledger.ts:199`): `{ id, accountId, mappingId, fileName, contentHash (SHA-256 of the text), dateFrom|null, dateTo|null, countsTowardDebt, importedAt, updatedAt }`. `countsTowardDebt = !olderHistory` ("Older history: keep out of balances"). Coverage is computed from `dateFrom`/`dateTo`.
- **BankRow** (`file-ledger.ts:212`): `{ id, accountId, importId, line, date, description, amountCents (signed: − out, + in), balanceCents|null, raw: string[], entryId|null, settlementId|null, skipped = false, dismissedTransferIds = [], updatedAt }`. A row is **pending** when `!entryId && !settlementId && !skipped`.
- **CsvMapping** (`csv-mapping.ts:18`): `{ id, name, dateFormat: "D/M/YYYY" | "D Mon YYYY", dateColumn?, hasHeader, amount: {signed: Col, negate} | {debit: Col, credit: Col}, descriptionColumns: Col[], balanceColumn: Col|null, updatedAt }`, where `Col = {header: string} | {index: int}`.

### 3.7 Categories, memory, merchants, rules

- **Category** (`file-ledger.ts:238`): `{ id, name, archived, updatedAt, parentId?, nature?: "essential" | "discretionary" | "oneOff" | "reimbursable" | "business" | "savings" }`. Nature is inherited up the tree (`categoryNature`, `ledger.ts:318`). Starter set: `STARTER_CATEGORIES` (`taxonomy.ts:3`), added by `addStarterCategories`.
- **CategoryMemory** (`file-ledger.ts:247`): `{ id, key = "<accountId>:<cleanMerchantKey(description)>", categoryId, entityId|null (set only when one portion covers the whole amount), updatedAt }`. Written after a bank-linked categorised spend (`categoryMemoryAfterSpend`, `ledger.ts:335`).
- **MerchantName** (`file-ledger.ts:255`): `{ id, key = cleanMerchantKey(description), displayName, updatedAt }` (`merchantNameAfterSpend`, `ledger.ts:302`). `cleanMerchantKey` = lowercase, remove digits, collapse whitespace (`merchants.ts:1`).
- **SplitPreset** (`ledger.ts:43`): `payer | halfHouse | allHouse | entity{entityId} | equal{entityIds} | shares{shares[{entityId,weight}]} | percentEntity{entityId, yourPercent}`.
- **EntryRule** (`rules.ts:4`, schema `file-ledger.ts:272`): `{ id, name, order, enabled, match: { text, mode: "contains"|"startsWith", descriptionRegex?, weekday?: 0..6[] (UTC), accountId|null, sign: "out"|"in"|"any", minCents|null, maxCents|null }, scope?: "newRows"|"existingEntries"|"both" = "newRows", protectManualEdits? = true, action: { displayName|null, categoryId|null, split: SplitPreset|null, tags[] }, autoConfirm = false, updatedAt }`.

### 3.8 Splitwise records (`file-ledger.ts:31-110`)

- **SplitwiseSync**: `{ id, entityId, lastPulledAt, updatedAt }`.
- **SplitwiseInbox**: `{ id, splitwiseExpenseId, entityId, date, description, costCents, yourPaidCents, yourOwedCents, isPayment, status: "new"|"changed"|"deleted"|"done"|"dismissed", updatedAt (= remote updated_at), previous?: {date, description, costCents, yourPaidCents, yourOwedCents} }`.
- **SplitwisePost**: `{ id, entryId|null, settlementId?, entityId, state: "posting"|"posted"|"unknown", splitwiseExpenseId|null, remoteUpdatedAt?|null, updatedAt }`. Exactly one of `entryId` or `settlementId` is set (refine at `:106`).

### 3.9 History (change log) and history mapping

- **ChangeSet** (`history.ts:12`): `{ id, at, actor: "you"|"rule"|"import"|"splitwise"|"matcher"|"system", reason, records: {collection, id, before, after}[] }`. It diffs only `entities, accounts, entries, baselines, settlements, bankRows, categories, rules` (`history.ts:20`).
- **HistoryMapping** (`history-import.ts:51`): `{ groups: Record<lcKey, {to:"person"|"group", name, groupType?} | {to:"self", tag?}>, subtypes: Record<lcKey, {to:"category", name|null} | {to:"merchant", displayName, category|null} | {to:"tag", tag, category|null}>, blankShare: "theyOweAll"|"splitEqual"|"groupDefault" }`.

### 3.10 Derived (never stored)

`Debt {debtorId, creditorId, amountCents}`, `BalanceReport {byEntity, betweenEntities}`, `OpenItem {id, date, description, source: "baseline"|"entry"|"credit", amountCents, openAmountCents}`, `AccountCoverage {ranges, gaps}`, `CheckpointDifference`, `PossibleTransfer`, `CardPaymentCheck`, `HealthIssue`, and the report rows.

---

## 4. Core algorithms

### 4.1 Splitting — `splitPreset(amount, payer, preset)` `ledger.ts:221`
- `halfHouse`: self = `ceil(a/2)`, House = the rest (odd cent to self).
- `percentEntity`: self = `ceil(a·p/100)` (BigInt), entity = the rest.
- `shares`: floor by weight; leftover cents go one at a time to the highest weight, ties broken by entityId.
- `equal`: floor; leftover cents go to the first ids in the order given.
- Zero portions are dropped.
- `defaultSplitPreset(entity)` `:284`: House with no allocation → `halfHouse`; group `percent` → `percentEntity`; group `shares` → `shares` of the members, plus self with weight 1 if missing. It is applied once when a group or House is picked in a new SpendForm (`SpendForm.tsx:249-256`).

### 4.2 Debts and balances
- `debtsOf(entry, bankRows)` `ledger.ts:374`: only `spend`/`refund` with `countsTowardDebt`. One debt per claim portion whose entity ≠ payer. Refunds produce **negative** debts. Bank-amount scaling as in §2.12.
- `balances(ledger)` `ledger.ts:440`: `byEntity[e]` for every non-self entity = baseline + (debts where e owes self) − (debts where self owes e) − `theyPaidYou` settlements + `youPaidThem` settlements. **Positive means they owe you.** Debts between two non-self entities (for example House ↔ a friend when House paid) are netted per pair into `betweenEntities`. Only settlements with `paidToEntityId` touch `betweenEntities` (as a reverse pair debt); Balances → Between others has **Record payment** to create one.
- `openItems(ledger, entityId)` `ledger.ts:555`: builds `theyOweYou` and `youOweThem` lists from the baseline (dated "", first) and from entry debts that involve self, sorted oldest first (date, then id). Settlements, oldest first, consume the matching list. Leftover money becomes a `source:"credit"` item on the **opposite** list ("Credit from <date> payment"; batch 40). Negative (refund) debts flip direction. Items with open amount 0 are filtered out.
- `openEntryIds` `:633` → the `settled` filter in Activity (`query.ts:75`).

### 4.3 Reports — `src/domain/reports.ts`
- `scopeAmount(entry, "personal"|"household")` `:72` is the base for every report.
- `monthly` `:119` (last N months up to the current month), `byCategory` `:159` (month × category matrix), `byNature` `:96`, `topMerchants` `:205` (by `displayName`, else `cleanMerchantKey`), `cashFlow` `:240` (income, transfers, and settlements in and out; transfers with no bank rows are skipped as evidence only).
- `report()` (`ledger.ts:411`) drives Home and Balances; `filteredTotals` (`query.ts:86`) drives Activity totals.

### 4.4 CSV import overlap and matching
- `findNewRows(existing, parsed)` `csv-mapping.ts:337`: a multiset on `[date, amountCents, description]`, so N identical existing rows absorb N identical parsed rows. ImportView asks once: "Skip N existing rows" or "Add them anyway".
- Same `contentHash` on the same account → blocked (`ImportView.tsx`, `sameFile`).
- `accountCoverage(ledger, accountId)` `ledger.ts:510`: merges import date ranges (adjacent days merge) and reports gaps.
- `checkpointDifferences` `ledger.ts:533`: Δcheckpoint − Σ bank rows in `(earlier, later]`.

### 4.5 Review pipeline (`ReviewView.tsx`, `transfers.ts`)
Each pending bank row is put into one of three groups:
1. **Already recorded**: `existingEntryFor(ledger, row)` `transfers.ts:110` finds a spend (row < 0) or refund (row > 0) on the same account with no bank rows, `(chargedCents ?? amountCents) === |row|`, within 2 days; or a `card-payment` transfer within 3 days that matches the card's positive row or a negative row on a same-payer asset account. A same-date match is preferred; an ambiguous match returns `null`. "Link" / "Link all" appends the row id (`update(..., "Link bank rows to existing entries", "matcher")`).
2. **Waiting**: `isWaitingOnOtherAccount` `:139`. The row is not paired, and no other account's coverage reaches `row.date + 3 days`. A row with a rule or memory is never waiting.
3. **Needs you**: everything else. The nav badge counts only these (`LocalApp.tsx:230-235`).

Actions on a row:
- **Spend**: `saveSpend` `ReviewView.tsx:397` sets the payer from the account, `countsTowardDebt` from the import, `source` = rule/memory/bank, and updates `categoryMemory`, `merchantNames`, and `lastSplitByAccount`.
- **Refund**: `saveRefund` `:425`, with portions scaled from the original (`scaledPortions`).
- **Income**: `:449`.
- **Skip**: `:476`.
- **Settlement**: opens Settle prefilled; positive means `theyPaidYou`.
- **Transfer**: `confirmTransfer`.
- Bulk Skip/Spend, "Accept suggested spends" (memory), and auto-confirm for rules where `canAutoConfirm` (`rules.ts:201`: `autoConfirm && split !== null`, outflows only).

Rule selection: `firstRule` `rules.ts:195` (lowest `order`, then id). `matchesCore` `:58`: regex (case-insensitive) or text contains/startsWith, plus UTC weekday, account, sign, and |amount| bounds.

### 4.6 Transfer suggestion — `suggestTransfers` `transfers.ts:161`
Pending rows on **different accounts** with **opposite signs**, **equal |amount|**, within **3 days**, not dismissed. A pair is suggested only if **each row has exactly one candidate** (ambiguity suppresses it).

`confirmTransfer(ledger, out, in, choice?)` `:216`:
- Same payer on both accounts → a `transfer` entry (`accountId: null`, no portions, `countsTowardDebt:false`, `bankRowIds:[out,in]`), and both rows get `entryId`.
- self ↔ House → the user chooses `"contribution"` (a transfer, no debt) or `"settlement"` (a House settlement: self→House is `youPaidThem`, House→self is `theyPaidYou`; both rows get `settlementId`).
- Any other payer pair → `null` (unsupported).

`cardCycle(ledger, paymentRow)` `:199`: the sum of a card's outflows since the previous transfer-linked payment row, and the difference from the payment.

### 4.7 Card payments check — `cardPaymentCheck(ledger, cardId)` `transfers.ts:64`
- Payments are transfers with `accountId === card`, or transfers linked to a positive row on the card.
- Charges are spends minus refunds on the card, each counted at the linked bank amount, else `chargedCents ?? amountCents`.
- It walks payments oldest first and returns `{ rows: [{payment, chargesSinceCents, owedAfterCents, fundedFrom}], owedNowCents }`. `fundedFrom` is the asset-account name behind a linked negative row.
- The UI (AccountsView) shows "Owed"/"In credit", a hint to add a checkpoint, and a "Possible duplicate" badge for same-day, same-amount payments.

### 4.8 History import (ANZ credit history) — `src/domain/history-import.ts`
Dev-only UI: `HistoryImportView`, rendered inside `DataView` when `import.meta.env.DEV` (`DataView.tsx:128`).

- **Required headers** `:20`: `Date, Description, Debit($AUD), Status, SubType, Group, Our share, Share`. Optional: `My share, Tags, Notes`.
- `planHistoryImport(text, ledger, creditAccountId)` `:144`:
  - Validates each row. Date is `D/M/YYYY` or ISO; the amount is non-zero (parentheses mean negative); `Status` is `Settled` or blank; `Share` is one of `friend, group, house, payment, personal, refund, trip` or blank; friend/group/trip need `Group`.
  - `historyKey` = SHA-256 of the raw line.
  - `amountCents = max(|debit|, ourShare + (friend/group/trip ? myShare : 0))`.
  - `matchBankRow` `:123` links a unique pending row on the account (same date, else a unique one within 2 days).
  - Buckets: `created` (associated), `pending` (blank Share), `payments`, `problems`; `matched` is a parallel list. `skipped` is never filled.
- `suggestHistoryMapping` `:257` maps groups (group → friends group, trip → trip group, friend → person) and subtypes (existing or starter category name → `SUBTYPE_ALIASES` `:241` → same name).
- `portionsFor` `:377`:
  - `payment` → transfer with no portions.
  - Refund → one portion to the group entity or self.
  - Blank → a self spend tagged `needs-share`.
  - `personal`/`house` → House = `Our share` (house with blank share = all), self = the rest.
  - friend/group/trip → House = `Our share`, self = `My share`, and the remainder follows `blankShare` (`theyOweAll` | `splitEqual` | `groupDefault` via `defaultSplitPreset`).
- `applyHistoryImport(plan, ledger, mapping, {replace, removeEntityIds, removeCategoryIds})` `:470`:
  - `replace` drops all `source:"history"` entries, and throws if any are bank-linked.
  - Skips known `historyKey`s.
  - Entries: payer self, `accountId` = the card, `source:"history"`, tags `history` + CSV tags + `card-payment`/`gift-card`, `chargedCents` when the amount exceeds the debit (note "Gift card or points"), and `countsTowardDebt = !payment && status !== "settled"`.
  - Saves `historyMapping`, then validates with `ledgerProblem`.
- `previewHistoryImport` `:557`: counts, created/merged names, unreferenced entities and categories, and balances before and after.

### 4.9 Health — `findIssues(ledger, today)` `health.ts:34`
It reports:
- rows waiting in review;
- checkpoint differences ≠ 0;
- coverage gaps;
- open items older than 60 days, per entity;
- Splitwise posts that are `posting`/`unknown` plus inbox items that are `new`/`changed`/`deleted`;
- uncategorised spends and refunds;
- `needs-share` entries;
- card payments not seen leaving a covered same-payer asset account;
- amended amounts without a note (spend and refund only);
- possible double entries (manual vs bank, and unlinked history vs linked entries; same account, date, and amount).

Each issue carries `view` and an optional `filter: {tag}`.

### 4.10 Settle view logic (`SettleView.tsx`)
- **Who**: non-self entities, active ones plus archived ones with a non-zero balance (`:107`).
- It shows the net `balances().byEntity[e]` and `openItems` both ways. `allocationsFor` (`:95`) previews which items a payment would close, oldest first (not editable).
- `save` `:363` writes a `Settlement` (and `bankRowIds:[row.id]` plus `row.settlementId` when it came from Review) with the label "Record settlement" (undoable).
- Splitwise payments in the inbox (`isPayment`) → `recordSplitwisePayment` `:331` sets `splitwisePaymentId`, with `theyPaidYou` when `yourPaidCents === 0`.
- "Also record in Splitwise" → `buildPayment` + `postExpense` using post states (save before call). It is never offered when `splitwisePaymentId` is set.
- Balance check for a linked person: compares `get_friends[].balance` (AUD) with the local balance. It reports only and never changes anything.

### 4.11 Change log and undo
- `update(next, label?, actor="you")` `LocalApp.tsx:349`:
  1. validates with `ledgerProblem`;
  2. restamps `updatedAt` on changed records in entities/accounts/entries/baselines/settlements/rules (`updateRecords` `:169`);
  3. if there is a label, appends `buildChangeSet` (cap 200);
  4. labels matching `^(Delete|Archive|Skip|Bulk)` or "Record settlement" get a 10-second Undo toast (an in-memory snapshot).
- History view → `revertChangeSet` (latest only; skips records changed since) `history.ts:74`.

---

## 5. Adapters

### 5.1 CSV mapping (`src/adapters/csv-mapping.ts`)
- Limits: 5 MiB and 10,000 rows (`:5-6`). Papa Parse with delimiter `,`, no dynamic typing.
- **Presets** `BANK_PRESETS` `:52`:

| id | Name | Header | Date | Amount | Description | Balance |
|---|---|---|---|---|---|---|
| `ing` | ING | yes | `D/M/YYYY` (auto-picks `Transaction date`, else `Date`) | `Debit`/`Credit` columns (debit → negative; both filled is an error; negative credit is an error) | `Description` | `Balance` |
| `hsbc` | HSBC | yes | `D Mon YYYY` | signed `Amount` | `Description` | `Balance` |
| `anz-credit` | ANZ Credit Card | no | col 0, `D/M/YYYY` | signed col 1 | cols 2–49 joined `" \| "` | none |
| `anz-transaction` | ANZ Transaction | no | same as ANZ credit | | | |

- ANZ rows must have 8–50 fields (`:259`, keyed on the `anz-` id prefix).
- Amounts accept `+`, thousands commas, and accounting `(1.23)`.
- `suggestPresets(text)` `:324` sniffs the first row: credit+debit+date → ING; date+amount → HSBC; ≥ 8 fields with a D/M/YYYY first cell → both ANZ presets.
- Custom mappings: `MappingEditor.tsx` builds a `CsvMapping` from the file's first row (header names or "Column N"). It is saved into `ledger.mappings` and set as `account.mappingId`.
- `parseWithMapping(text, mapping)` `:182` → `{rows: ParsedBankRow[], errors: {line,message}[]}`. Commit is blocked while errors remain. Headers are matched by `headerKey` (lowercase letters only).

### 5.2 Splitwise
- **Session** (`vite/splitwise-session.ts:84`, plugin registered in `vite.config.ts`, `apply: "serve"`, so dev only):
  - `POST /__splitwise/session {text}` parses a pasted cURL (`parseCurl`, `src/adapters/curl-capture.ts:128`; the host must be `secure.splitwise.com`) into memory.
  - `GET` → `{connected, headerNames}`; `DELETE` clears the session.
  - `/splitwise-api/api/v3.0/*` is proxied to `https://secure.splitwise.com/api/v3.0/*` with the captured headers and cookies, and forced `Origin`/`Referer`. `Set-Cookie` is merged into memory and stripped from the response.
  - Requests must come from the dev server's own origin and carry `X-Finance-App: 1`. Nothing is logged.
- **Client** (`src/adapters/splitwise.ts`):
  - `request` `:138` treats 401/403/HTML as `SplitwiseSessionExpiredError`; a non-empty `errors` → rejected.
  - Calls: `getCurrentUser`, `getFriends`, `getGroups` (drops id 0), and `getExpenses(link, {datedAfter|updatedAfter})` `:359`, which pages 100 at a time and rejects non-AUD.
- **Pull** (`pullIntoInbox(ledger, entity, expenses, youId)` `:398`):
  - A friend pull skips group expenses; expenses where you paid and owe 0 are skipped.
  - Known ids (inbox, entry, or post) become `changed`/`deleted` when `updated_at` moved or `deleted_at` is set, keeping `previous`.
  - A post without `remoteUpdatedAt` only seeds it.
  - Updates `splitwiseSync`.
  - The first pull uses a "since" date (`dated_after`); later pulls use `updated_after = lastPulledAt` (`PeopleView.tsx:140-155`).
- **Inbox → entry** (`createSplitwiseSpend` `:482`):
  - The payer is the entity if `yourPaidCents === 0`, else self.
  - Portions: self = `yourOwedCents`, entity = cost − owed. `countsTowardDebt:true`, `accountId:null`, `splitwiseExpenseId` set.
  - Review offers to link to a local entry with the same payer and amount within 3 days. A partly paid expense means "Enter by hand".
- **Post expense**:
  - `buildExpense(entry, portion, entity, members, youId)` `:208` only works for spends paid by self. Person: cost = the portion, the friend owes all. Group: cost = self portion + group portion; you paid all and owe your self portion; other members split the group portion equally, with leftover cents to the first.
  - `postExpense(draft)` `:314` checks that paid and owed shares each sum to the cost, then form-posts `create_expense` with `group_id` 0 for friends.
  - Post states: write `posting` and save the file **before** the call → `posted` with the id, or `unknown` on no response (never auto-retried; "Mark posted" or "Clear").
- **Post payment**: `buildPayment(settlement, entity, memberId, youId)` `:272` sets `payment=true`; the payer has `paid_share = cost` and the receiver has `owed_share = cost`.

### 5.3 File store and autosave (`src/adapters/file-store.ts`, `LocalApp.tsx`)
- `getStorageMode()` `:32`: `"in-place"` when the File System Access pickers exist (Chrome/Edge), else `"download"` (download on save, upload on open).
- `FileStore` `:42` uses IndexedDB `financeApp` v1 with stores `handles` (remembered file handle, for the reopen prompt) and `recovery` (`{fileName, content, savedAt}`).
- Optional backup folder (`showDirectoryPicker`): writes `ledger-YYYYMMDD-HHMMSS.finance.json` on each save and keeps 20 (`:292-310`). Restore with preview is in DataView.
- Autosave (`LocalApp.tsx:325-336`): after a debounce of `autosaveDelayMs` (1 s), write the recovery copy, then save in place if a file is open. Failures back off with `nextAutosaveDelayMs(n) = min(30 s, 1 s·2^min(n,5))`. ⌘S saves; there is a beforeunload guard when unsaved.
- `parseLedger` / `stringifyLedger` / `ledgerProblem` (`file-ledger.ts:432/464/457`) all validate with the same Zod schema.

---

## 6. UI map

Hash routes: `#/<View>` and, for Activity, `?f=<JSON EntryFilter>` (`route.ts`). Unknown routes fall back to Home. `knownViews` and the sidebar groups are at `LocalApp.tsx:91-123`; the view table is at `:609`. ⌘K opens the command palette.

| Group | View | File | What it does |
|---|---|---|---|
| Daily | Home | `HomeView.tsx` | This month personal (incl. ½ House) and House totals, owed to you / you owe, a 6-month chart, entity balance cards, a to-do list (review count, health), recently handled, getting started |
| Daily | Review | `ReviewView.tsx` | Keyboard queue (j/k/arrows plus shortcuts). Tabs: needs you, already recorded, waiting. Transfer suggestions, rules and memory prefill, bulk actions, "From Splitwise" inbox (new/changed/deleted) |
| Daily | Activity | `ActivityView.tsx` | TanStack table of entries. Filters (`EntryFilter`: text, date, account, category, uncategorised, entity, payer, kind, tag, counted, source, settled) kept in the URL. Inline edits, details sheet (bank rows, note), bulk category/tag, add or edit with `SpendForm`, Post to Splitwise |
| Daily | Settle | `SettleView.tsx` | See §4.10 |
| Money | Accounts | `AccountsView.tsx` | Add or rename accounts (type, Paid by), coverage, checkpoints, card payments check |
| Money | People | `PeopleView.tsx` | People and groups (type, members and weights, default split), archive, Splitwise connect/disconnect, link, pull |
| Money | Balances | `BalancesView.tsx` → `EntityView.tsx` | One card per entity, baselines, "Between others" (`betweenEntities`), by category, starter categories. The entity page has a timeline with a running balance, Open/Settled, credit notes, "Written off and gifted" with "Start claiming", archive/restore, and Settle up |
| Money | Reports | `ReportsView.tsx` | Range and scope (personal/household); tabs Monthly, Categories, By nature, Merchants, Cash flow; charts; CSV export; amounts drill into Activity |
| Setup | Import | `ImportView.tsx` + `MappingEditor.tsx` | Four steps: account → file (hash, preset suggestion) → mapping → preview, errors, duplicate choice, "Older history" → commit |
| Setup | Rules | `RulesView.tsx` | Ordered rules: match, scope, protect manual edits, action, auto-confirm. Selectable before/after preview (`previewRuleChanges` `rules.ts:172`), apply with the label `Apply rule <name>`, actor `rule`. Suggested rule (`suggestRuleFromHistory`, ≥ 3 identical-shape spends) |
| Setup | Data | `DataView.tsx` | Save, backup folder and restore, export, categories editor; dev-only `HistoryImportView` |
| Setup | History | `HistoryView.tsx` | Change log; revert the latest change |
| Setup | Health | `HealthView.tsx` | `findIssues` grouped in cards, each linking to a view or filter |

Shared pieces: `SpendForm.tsx` (payer, split presets, portions with treatment, category, tags, note, display name), `ComboField.tsx` and `src/ui/combo.ts` (pick or create a category or entity in place). The UI kit is shadcn on Base UI in `src/components/ui/`, tokens are in `src/ui/theme.css`, and toasts use sonner.

---

## 7. Testing and conventions

| Command | What it runs |
|---|---|
| `npm test` | Vitest, `tests/**/*.test.ts`: `ledger` (29), `money-cases` (14-row `it.each`, the agreed money cases), `transfers` (4), `splitwise` (5), `csv-mapping` (2), `value`, `history`, `route`, `combo`, `file-store` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | typecheck + `vite build` |
| `npm run test:e2e` | Playwright, desktop (1280) and mobile (Pixel 7, 390), against `npm run dev -- --port 5174` |

- E2E ledgers are built in code (`tests/e2e/fixtures/ledger.ts`, synthetic, with dates relative to today). File picking goes through `fixtures/app.ts`. Splitwise is always mocked with `page.route`. An axe check (serious or critical issues fail) runs on rebuilt views. `visual.spec.ts` saves screenshots to `test-results/views/`.
- Specs select by role, label, or text, never by CSS class.
- Node version comes from `.nvmrc` (24.22.0).

**Workflow conventions:**
- One `NN-*.prompt.md` per session, in order. The prompt is the plan; read `PROGRESS.md` first, then only the files the prompt lists.
- Hand off (append a note to `PROGRESS.md`) when a third unnamed file is needed or a failure survives three fixes.
- Finish by appending the batch, files changed, and anything left.
- Tests are only the ones the prompt names.
- PHASE4 (batch 35+) replaces parts of `copilot-instructions.md`: new deps are allowed from a list, pinned with `-E`; Tailwind and tokens only; each page has an `h1` and at most one primary button; every change passes an `update` label; confirms use `AlertDialog`; inline edits save on blur or Enter; layouts must work at 390/768/1280.
- `split-prompts.sh` splits a bundled prompt file (lines starting `#### <path>`) into files.

`older-instrcutions-do-not-follow` is **superseded**. It described a Tauri/SQLite desktop V1 with an `IMPLEMENTATION_PLAN.md`, a `VERIFICATION.md`, a native bridge, optimistic concurrency via record versions, and lead/subagent model rules. None of that exists now. What survives in spirit: integer cents, immutable source evidence, provenance on automation, no remote telemetry, and synthetic fixtures only.

---

## 8. Known gaps and inconsistencies

### Roadmap (from the docs)
- **Later**: recurring payments, month close, settle-up helpers, local receipt photos, optional encryption. **Eventually**: a phone app, OCR, and a backend.
- `PROGRESS.md` ends with "Next: 42", but no 42 prompt exists. CONTEXT says to ask before writing the Later prompts.

### Docs vs repository
- `MANUAL.md` is referenced by README, CONTEXT, PHASE4, and prompt 36, but **does not exist** in the repo.
- `dummy1.finance.json` is **tracked in git** (commit `2237bf6`) even though `.gitignore` has `*.finance.json` and the rules say test ledgers are built in code. `test_sheet.xlsx` is also tracked; its contents are unknown (not read).
- PHASE3 says `ledger1.finance.json` is in the repo root. It is not present in this worktree.
- H1 says to delete `history-import.ts` and `HistoryImportView.tsx` after the one-time import, and treats `Payment` as "skip". Batch 29 instead kept and extended both files and turned payments into `card-payment` transfers. H1 is superseded.
- Prompt 08 references `src/domain/transfer-matching.ts` and `src/application/`; neither exists.
- PHASE2 says "Automation never edits a saved entry", but batch 33 rules can edit existing entries (with `protectManualEdits`).
- `copilot-instructions.md` says "No UI tests"; PHASE4 overrides this with Playwright as the main test.

### Code-level observations
- **Layering**: `domain/ledger.ts` imports the `CsvMapping` type from `adapters/csv-mapping`, and `domain/history-import.ts` imports `ledgerProblem` from `adapters/file-ledger`. The domain is not fully independent of adapters. Splitwise and history fields are typed only via module augmentation in `file-ledger.ts`.
- **Source derivation differs**: `query.ts:38` maps `rule`/`memory`/`history` to `"bank"` for filtering, and also checks `ruleId`. `health.ts:27` returns the stored source. As a result, "Possible double entries" (manual vs bank) only compares entries whose source is exactly `bank`.
- **Unlabelled updates** (no History entry, against the PHASE4 rule): the CSV import commit and mapping save (`ImportView.tsx` `commit`/`saveMappingChoice`), checkpoint add (`AccountsView.tsx:100`), Splitwise pull (`PeopleView.tsx:154`), and post-state writes. Also, `buildChangeSet` does not diff `imports`, `mappings`, `checkpoints`, `categoryMemory`, `merchantNames`, or the `splitwise*` collections, so these cannot be reverted. `updateRecords` restamps `updatedAt` only for six collections.
- `HistoryImportPlan.skipped` is never populated; `matched` overlaps `created`/`pending`/`payments`. The tag line `row.association === "pending"` (`history-import.ts:512`) is dead code, because blank rows get `needs-share` in `portionsFor`.
- `createSplitwiseSpend` does not set `source: "splitwise"` (ReviewView adds it at `:662`). Partly paid expenses are treated as paid by self if `yourPaidCents > 0`, although the Review UI routes those to "Enter by hand".
- `settlements` are always self ↔ entity, so `betweenEntities` debts (for example House owes a friend after a House-account spend) are shown but **cannot be settled**.
- Group `members` affect only default splits and Splitwise group posting (which splits equally across Splitwise members, ignoring local weights). Debts are always against the group entity as a whole.
- `report()`/`scopeAmount` treat any portion for the `house` id as House. A custom `household` group gets no "half" treatment; only the fixed `house` entity does.
- `monthly()` uses the local-time current month (`reports.ts:114`); the rest of the date maths is UTC or string-based.
- The ANZ preset detection relies on the `anz-` id prefix (`csv-mapping.ts:259`), so a custom mapping whose id starts with `anz-` inherits the 8–50 column check.

---

## 9. How to extend

### Add a new bank CSV format
- **No code change needed** if the CSV fits `CsvMapping`. Use Import → MappingEditor; the mapping is saved to `ledger.mappings` and `account.mappingId`.
- **To ship a preset**: append to `BANK_PRESETS` (`csv-mapping.ts:52`) with a stable `id`, and teach `presetCandidates` (`:307`) to sniff it. Add a synthetic-row test in `tests/csv-mapping.test.ts`.
- **For a new date or amount style**: extend the `dateFormat` enum in `csvMappingSchema` (`:21`) and `parseDate` (`:117`), or the amount union (`:13`) and `parseMappedAmount` (`:158`). These are optional schema additions, so `schemaVersion` stays 1.
- **For a structurally different source** (for example the history CSV): follow `history-import.ts`. Write a pure `plan*` → `preview*` → `apply*` that returns a full `Ledger`, validate with `ledgerProblem`, use `historyKey`-style dedupe, and call `update(next, "<label>", "import"|"system")` from a view.

### Represent a person-to-person settlement
- **Self ↔ person**: a `Settlement { entityId: personId, direction, amountCents, bankRowIds, note }`, created in SettleView or from a Review bank row (`row.settlementId`). `openItems` allocates it oldest first, and overpayment becomes a credit.
- **Between two non-self entities** (for example Trisha pays House): not supported. Options:
  - (a) Add optional `fromEntityId?` to `settlementSchema`, defaulting to self, and teach `balances()` (`ledger.ts:481`) to adjust `pairBig` and `openItems` when `fromEntityId ≠ self`.
  - (b) Model it as a zero-sum pair of self settlements.
  - Either way, add a money case in `tests/money-cases.test.ts`.

### Represent a House (joint) account
- Create an `Account { type: "asset" | "credit", payerEntityId: "house" }`. Spends imported on it are paid by House: a self portion means you owe House, a `house` portion is report-only, and a friend portion lands in `betweenEntities`.
- Moves between your account and the House account are paired by `suggestTransfers` and confirmed as `"contribution"` (no debt) or `"settlement"` with House.
- House's default split is `halfHouse` unless `house.defaultAllocation` is set.
- To model a partner's share of House explicitly (for example Trisha's half), the current model does not split House's debts onward. House is one entity, and the personal report hard-codes ½. Changing that touches `report`/`scopeAmount`/`filteredTotals` (all three duplicate the ½ rule) and the money cases.

### Splitwise-group entities
- Create `Entity { kind: "group", groupType, members?, defaultAllocation? }` and link it in People (`splitwise: { kind: "group", id }`). Pulls use `group_id`. `buildExpense` posts `self portion + group portion` split equally across the Splitwise group's other members. `buildPayment` for a group asks which member.
- Debts and settlements stay against the group entity, not individual members. Per-member tracking would need person entities and either multiple portions or a new member-level allocation.

### Add a new entity kind or field
- Add an optional field to `entitySchema` (`file-ledger.ts:112`) and the `Entity` interface (`ledger.ts:17`); it defaults on load.
- A new `kind` value needs `balances` (which assumes exactly one `self`), `defaultSplitPreset`, the pickers in People and Accounts, `SettleView`'s filter, and the history-import `resolveEntity` to be checked.

### Add a new report
- Add a pure function in `src/domain/reports.ts` built on `scopeAmount`/`entriesInRange`, returning `entryIds` for drill-down. Add a tab in `ReportsView.tsx` (charts only on Home and Reports, using shadcn `chart`). Drill down with `openActivity({ entryIds })`.
- Add a unit test only if the prompt names one, plus a `reports.spec.ts` e2e check.

### Add a new view
- Create `src/ui/views/XView.tsx`, add it to `ViewName`/`knownViews`/`navigationGroups`/the `views` map in `LocalApp.tsx`, and pass `ledger`, `update`, and `openActivity`. Use `update(next, "Label")` for every change. Add an e2e spec with `checkA11y()`.

## 10. Data onboarding (Nov 2026)

The hand-kept workbook (card history, Trisha's lists, Splitwise exports, bank sheets, Final settlements) was reconciled and loaded **once** by a script that writes a ledger file directly. It is not app import logic. Ongoing ingestion stays as bank CSVs (mappings → Review) plus Splitwise pull. Conventions that ledger uses, for anyone reading it later:

- Accounts: ANZ Visa (credit, self), ANZ Savings / Westpac / ING / Revolut (asset, self), HSBC House (asset, payer House: the joint account both partners fund ≈$2,000/month), Trisha ING and Trisha Revolut (asset, payer Trisha).
- Trisha-paid House spends: payer Trisha, House portion, so they show as **House owes Trisha** under Between others. When HSBC pays her, use Record payment.
- Settled sheet rows are entries with `countsTowardDebt: false` and `source: "history"`, so reports cover the history without creating debt. Open rows count.
- Splitwise balances as of the load are `baselines`. Dismiss already-counted items in the Splitwise inbox on the first pull.
- Group "Kitkat" = self, Trisha and a friend, split in thirds; trips with Trisha (`Trip` rows) are House portions tagged `trip:<name>`.
- The reconciliation report and loader script live in the git-ignored `reconciliation/` folder of the working copy that produced them.
