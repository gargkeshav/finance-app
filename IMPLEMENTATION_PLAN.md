# Implementation Plan

## 1. Product Contract

Build a local-first desktop finance app that answers: Where did my money go? Who owes me, what do I owe, and what is due from House?

Confirmed scope:

- AUD only initially; carry currency explicitly and reject unsupported currency rather than convert silently.
- ING transaction, HSBC joint, ANZ transaction, and ANZ credit CSV imports. More accounts can use supported profiles; more formats come later.
- Multiple personal/joint accounts, credit cards, cash, and stored-value/payment wallets. Support manual entries for expenses paid by others or outside bank feeds.
- Recent history first; older and overlapping exports can be added later without changing existing IDs or manual decisions.
- Editable categories, people, groups/events, tags, merchant aliases, notes, allocation defaults, and explainable categorization rules.
- Typed many-to-many links for transfers, card repayments, refunds, funding, reimbursements, and settlements, with amounts attached where applicable.
- Personal, House, and external-person allocations; partial household portions; partial and consolidated repayments; advances and explicit adjustments.
- Local sharing independent of Splitwise. Splitwise read/reconcile and explicitly confirmed publishing are part of planned scope, subject to API feasibility.
- Personal/household reporting toggle; gross spending, cashback/refunds, and net spending; outstanding claims and drill-down.
- Complete manual export and safe restore, with versioned schema and provenance.

Deferred: encryption/passphrase/vault, automatic backups, server, multi-device sync, phone capture/balances, mobile reconciliation, budgets, forecasting, investments, savings-interest integration, AI categorization. Preserve sensible boundaries, not speculative implementations.

### Core-First Implementation Priority

Preserve already implemented imports, overlap review, transfer suggestions, House claims/payments, correction/reversal, and recovery. Prioritize the pending core expense workflow: imported bank observations remain immutable; users can create or amend a separate interpreted expense whose total may differ from a single bank movement; one expense supports multiple explicitly labelled funding sources; allocation totals and funding totals each balance exactly to the interpreted total. Account-funded portions retain account identity. Non-account sources require a label and do not create reimbursement claims unless explicitly identified as personally owned account-equivalent funding. Defer points units, stored-value balance tracking, dedicated reward/refund subsystems, advanced rules/reports, and Splitwise until this workflow is verified.

### Core-First Implementation Priority

Preserve already implemented imports, transfer suggestions, House claims/payments, correction/reversal, and recovery. Reprioritize pending work around the core expense workflow: imported bank observations remain immutable; a user may create or amend a distinct interpreted expense with a total independent of any one bank movement; one expense supports multiple explicitly labelled funding sources; allocation totals and funding totals each balance independently to the expense total. Account-funded portions retain account identity. Non-account sources require an explicit label and do not create reimbursement claims unless the source is explicitly classified as personally owned account-equivalent funding. Defer points units, gift-card balance tracking, dedicated reward/refund subsystems, advanced rules/reports, and Splitwise until this vertical slice is verified.

## 2. Architecture

Use React + TypeScript, Tauri 2, and SQLite. Verify current compatible maintained dependency versions at Gate 0 and lock them. No public server is required.

Suggested layout (adjust naming only, preserve dependency direction):

- src/domain: money/date types, allocation/claim/report logic, matching policy, rule evaluation; pure TypeScript.
- src/application: command/query contracts, workflow validation, domain orchestration; no React or native APIs.
- src/adapters: bank parsing profiles, Splitwise normalization, repository/native client implementations.
- src/ui: React views, reusable accessible controls, forms and view models.
- src-tauri: validated native commands, SQLite repositories/migrations, file dialogs, consistent snapshots, credential storage, external API transport as needed.
- tests: unit, synthetic fixtures, integration, browser journeys, and native verification support.
- docs: decisions, setup, contracts, and actual verification evidence.

Gate 0 must prove how the TypeScript financial results are atomically persisted by native commands. Do not duplicate independent accounting implementations in Rust and TypeScript. Validate persistence invariants and expected versions natively; commit related entities and audit records in one SQLite transaction. Read/compute/write races must fail safely rather than overwrite newer edits.

Use maintained CSV, schema-validation, decimal-input, accessibility, icon, testing, and archive libraries as appropriate. Money storage/calculations remain exact cents; parse display decimals through a structured validated conversion. Avoid speculative plugin frameworks, generic entity systems, event sourcing, or an always-running local server.

## 3. Financial Invariants

### 3.1 Evidence, Events, And Expenses

Separate immutable imported observations, normalized bank events, economic expenses, funding sources, allocations, claims, and settlement applications. One expense may have several funding sources; several bank observations may refer to one event. One payment may settle several claims. Links do not alone determine accounting effects: their type and applied amount do.

Use stable internal IDs, source provenance, timestamps, record versions, and schema versions. Imported description/date/amount stay available even when a user corrects the interpretation. Account sign convention: positive increases an asset balance or reduces credit-card liability; negative decreases assets or increases card liability. Display credit-card amount owed with a clearly named presentation convention.

### 3.2 House

House is a shared allocation bucket, not a person. Do not generate individual partner debts for every House purchase. Current reporting default: my spending = my personal allocations + half of House allocations. Household reporting includes House once; other people's personal allocations stay separate unless explicitly selected.

- Personally funded House portion creates a claim for the reimbursable funding against House/common account, not half that amount against the partner.
- House paid from the common account creates no personal reimbursement claim.
- Equal contributions to the common account are funding transfers, not consumption.
- Reimbursement from the common account clears a House claim, not another expense.
- A common-account credit/entitlement application requires explicit amount and evidence; it cannot create money or clear unrelated debt automatically.
- Confirm whether HSBC joint is the settlement common account. Support a distinct account if necessary.

Example: I pay $150, allocated $100 House and $50 to a friend. My attributed spending is $50; House claim is $100; friend claim is $50. There is no additional partner claim. Receiving $20 from the friend leaves $30 owed and does not change consumption.

### 3.3 Portions, Funding, Gift Cards, And Benefits

Allocation totals equal the economic expense; funding totals equal its payment value, or explicitly show an unresolved funding gap. Do not manufacture a counterparty for an unallocated remainder. Distinguish an incomplete draft from a finalized balanced expense.

A $586.32 expense with $419.40 House portion has $166.92 remaining to allocate. Equal reporting attribution of the House portion is $209.70 each; do not change historical decisions to this default.

A $15.18 House purchase funded by $5.18 bank charge and $10 gift-card/points redemption preserves both funding components. The extra $10 in the user's historical Coles rows is confirmed nonbank redemption, not a bank-data error.

Purchased gift-card acquisition is stored-value funding, not consumption. Redemption is consumption; do not count acquisition again. Track opening value/ownership or mark unknown; do not invent a purchase for reward points. Record AUD redemption value for points without building points-unit tracking. Points benefit funding is distinguishable from later cash cashback. Show gross consumption, benefits/adjustments, net cost, and cash funding with unambiguous labels so free-value benefits do not appear as cash outflow.

For House, personally owned stored value can be explicitly reimbursable; House-owned value is not a personal claim. Points reimbursement is not inferred from redemption amount; require a chosen treatment. Never calculate claims solely from expense gross amount.

### 3.4 Refunds, Cashbacks, And Settlements

Preserve refunds and cashback as separate source events with typed allocations/links. Allocate adjustments to affected expense portions when known; otherwise show unapplied credit awaiting classification. Do not subtract a credit twice from an already-net historical amount. Distinguish gross date and adjustment posting date; V1 default reports use posting dates, with separately captured purchase dates displayed where available.

A refund returned to the personal payer for a reimbursable House purchase reduces the associated unpaid House claim. If House already reimbursed it, record the corresponding amount owed back to House, preserving the completed settlement. Partial refunds and partially settled claims require explicit allocation between unpaid claim reduction and return obligation; no double recovery. Refunds paid directly to House instead must be reconciled to that recipient and existing claim state, not processed as if paid personally. Cashback/points claim treatment is a separately chosen policy, not automatically the refund rule; preview and confirm it when no policy exists.

Receipts that settle claims are not income. Payments settling liabilities are not new expenses. Store partial applications, unapplied advances/credits, reversals, and explicit writeoffs. Reject applying more than the available payment or outstanding claim unless the excess is recorded separately as credit. AUD rounding tolerance only suggests a match; exact residual needs a visible approved rounding adjustment. Deterministic odd-cent splitting preserves totals and shows who receives the residual when individual splits are used.

Account balances, consumed spending, external obligations, and House claims are different measures. Bank balances require reliable opening balances and posted coverage. Mark incomplete coverage and balance-as-of dates; credit-card exports without balances cannot establish current amount owed by themselves.

## 4. Data And Persistence

Minimum explicit records: accounts/ownership and roles; imports and raw row occurrences; normalized events; expenses and funding components; categorized allocation lines; people; House/group/event definitions; tags; merchant aliases; rules; typed relationships; claims; payment/credit settlement applications; adjustments; per-field decision provenance/locks; review issues; audit entries; external IDs and sync state.

An entity may be a table or a clear equivalent, not necessarily a generic framework. Publish schema and command contracts before parallel implementation. Use foreign keys, uniqueness scoped to the true source identity, check constraints, and transactional migrations. Fingerprints are indexed evidence, not globally unique transaction keys.

Support safe archive/deactivation of referenced categories/people instead of deleting history. Rules need priority, scope, preview, explanation, and explicit rerun. Manual decisions outrank automation; confirmation locks relevant fields only. Source updates conflicting with locks raise a review issue, not overwrite. Rejected matches also persist.

## 5. Imports And Review

Workflow: choose files -> detect candidate profile -> confirm account/profile -> preview parsed rows and matching decisions -> resolve blockers -> atomic commit -> actionable summary. Allow multi-file batches with explicit account mappings. State atomicity per file/batch before confirmation. Parser errors must be visible; no silent skips.

| Profile         | Required behavior                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ING             | D/M/YYYY; separate credit/debit; negative debits already signed; optional balance; empty is not zero                                                           |
| HSBC            | D Mon YYYY with leading spaces; quoted comma amounts; NBSP in description; empty trailing header field; preserve unexpected nonempty columns or reject visibly |
| ANZ credit      | Headerless 8-column family; first row is data; signed amount in column 2; preserve trailing empty fields                                                       |
| ANZ transaction | Same family; additional columns can contain references, names, messages, identifier-like negative strings; do not parse those as money                         |

Account identity is explicit, independent of filenames. The ANZ families are ambiguous from some contents: request confirmation, remember profile settings, never promise perfect subtype detection. Parse Australian dates strictly and preserve date-only semantics. Normalize whitespace for comparison separately from raw text. Receipt/reference extraction adds evidence without assuming stability or uniqueness.

Duplicate policy:

- Exact-file reimport is idempotent for its assigned account and profile interpretation; importing the same bytes into a different account is a separate explicit action.
- Within an account, reconcile occurrence multiplicity across comparable overlapping exports. Preserve identical-looking legitimate transactions. Row ordinal is provenance, not stable event identity.
- Date, amount/currency, reference, raw/normalized description, available balance and surrounding sequence are evidence; no date watermark or single hash can replace reconciliation.
- Incomplete coverage or conflicting multiplicity yields review, not silent loss. Cross-account equal values are not duplicates.
- Pending-to-posted matching is separate; preserve source versions, require review when ambiguous, and exclude pending from finalized totals. Show pending exposure separately.
- Adding older history must preserve IDs, links, locks, and settlement history; suggest newly discovered counterparts and recompute only appropriate derived reports.

Auto-apply high-confidence, unambiguous decisions under explicit policy. Every auto decision remains filterable and reversible. Confidence must reflect defined evidence/rules, not an unexplained percentage. Review issues: duplicate ambiguity, source conflict, unmatched transfer, unallocated expense, missing funding, settlement discrepancy, or balance inconsistency. A probable transfer with missing counterpart is not silently income/expense; disclose its provisional treatment.

## 6. Splitwise

Feasibility first: verify current official API terms/access, supported read/write operations, auth, rounding/currency limits, and deletion/update behavior. Existing documentation is https://dev.splitwise.com/ ; recheck during implementation. Do not circumvent limits or assume personal integration is automatically permitted under competing-functionality restrictions. Document any access/terms blocker and ship local sharing with an explicit unavailable integration, not a false completion claim.

Bank source owns money-movement facts. Splitwise owns the published shared split and recorded external settlements. Local drafts/IOUs work independently. Local notes/categories remain local unless deliberately included in a publish preview.

Read people/groups/expenses/settlement records, preserve external IDs and update/deletion state, paginate, and reconcile changes. Link existing local expenses instead of double-counting them. External edits conflicting with confirmed local decisions raise conflicts; no automatic last-write-wins. Acknowledged settlement and observed bank payment are separate dimensions. Debt simplification means receipts may not map to original expense creditors.

Start read-only. Add explicit publish/update preview and confirmation later in the same integration stage. Keep an outbound operation journal; unknown write result must trigger remote reconciliation/manual resolution before retry. Never claim exactly-once creation if the provider lacks an idempotency mechanism. Respect rate limits, backoff, structured error bodies, and offline status. Network failure never blocks local accounting. Credentials in OS secure storage, not exports. Do not request secrets in agent chat.

## 7. UI Contract

Minimalist, task-first desktop interface, no landing page. Primary navigation: Overview, Transactions, Sharing, Reports; Import is a prominent action; settings holds accounts, categories/people/groups/tags/rules and data management. Sharing separates House, People, and Splitwise status. Personal/Household toggle has a stable, explicit scope.

- Overview: attributed spending, House spending, amounts owed/to pay, House reimbursement due, review count, coverage/as-of indicators. Cards only for useful summaries; no decorative dashboard filler.
- Transactions: dense readable table, search, date/account/category/person/group/tag/review filters, stable sorting, bulk categorization with lock/conflict safeguards, selectable rows, detail panel.
- Detail: original bank evidence, editable interpretation, expense/funding breakdown, allocation lines, links, notes, settlement applications, audit history. Progressive disclosure, not one giant form.
- Sharing: outstanding and historical balances, partial settlement flow, advances, House reimbursement selection, explicit distinction between bank-confirmed and externally recorded settlement.
- Reports: gross/adjustment/net, category and merchant breakdown, trends, personal/House scope, drill-through to included records. Separate account cash flow from consumption.
- Import: useful preview, parsing warnings, side-by-side match candidates and evidence; summary links to new/unchanged/updated/review records.
- Clear empty/loading/offline/error/partial-data states; no precision claims when records are incomplete.

Use a restrained neutral palette with distinct functional accents, clear typography, Lucide icons with accessible names/tooltips, conventional inputs, and no oversized heroes or nested decorative cards. Amounts right aligned and tabular. Do not rely on color alone. Preserve keyboard navigation, visible focus, labels, sufficient contrast, sensible focus restoration, and 200% zoom. Readable at narrow widths, but full mobile workflows are deferred. Confirm destructive financial changes; prefer reversals/undo and selection previews. Do not save silent changes on ambiguous input.

## 8. Work Packages And Gates

Every package delivers implementation, synthetic fixtures, tests, and concise evidence. Lead owns dependency contracts. Do not parallelize dependent packages until the prerequisite gate passes.

| Gate | Work package and owner                                                                                                                   | Completion evidence                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Lead/native specialist: verify prerequisites, scaffold minimal Tauri/React/SQLite, pin dependencies, define money/date/command contracts | Native launch; typed command; transactional write/read; restart persistence; core TS test; packaged smoke; actual tool versions                                  |
| 1    | Lead: schema/migrations and manual ledger vertical slice                                                                                 | Manual account/expense, funding and allocation, audit, stale-write rejection, rollback, clean restart; minimal full export/restore roundtrip early               |
| 2    | Lead import coordinator; bounded adapter subagents after contracts                                                                       | Four parsers + fixtures in parallel; shared multiplicity matcher owned separately; preview/commit journey and overlap/older-history tests                        |
| 3    | Lead accounting; bounded UI/test agents                                                                                                  | House/local person claims, refunds, gift cards/points funding, advances and settlement applications; all accounting examples in VERIFICATION.md                  |
| 4    | Rules and reporting specialists under fixed domain contracts                                                                             | Rule previews/locks/explanations, review inbox, personal/House toggle, reports reconciled to fixture ledger and drill-down                                       |
| 5    | Integration specialist supervised by lead                                                                                                | Splitwise feasibility result, mock contracts, read/reconcile, confirmed publish, secure credentials, unknown-outcome tests; live tests only with user permission |
| 6    | Independent QA + lead fixes                                                                                                              | Complete export/restore, packaged native journeys, browser/accessibility/responsive checks, requirement matrix, defects resolved or accepted                     |

Within each gate complete a thin usable journey before broadening. UI follows real contracts, not static mock data that hides missing workflows. Export/restore begins at Gate 1 and is retested at every schema expansion.

After Gate 0 record actual commands, ideally npm run dev, npm run tauri dev, npm run typecheck, npm run lint, npm test, npm run test:integration, npm run test:e2e, npm run build, npm run tauri build (or documented package-manager equivalents). Native test commands must be explicit too. Never substitute invented pass results for unavailable tooling. Browser preview uses a strictly separated synthetic/mock adapter and is not native release evidence.

## 9. Historical Reference Policy

No recurring spreadsheet/legacy CSV ingestion feature. Historical ANZ date range is 2023-03-01 to 2026-05-25, full dates restored. Debit($AUD) is expense-positive, opposite raw ANZ signed bank movement. Our share is household portion, not an individual share. Extra $10 Coles portions are confirmed gift-card/points funding. Preserve historical settled outcomes and unknowns rather than recalculate them.

Common_account combines settled aggregates and adjustments; never create duplicate bank expenses from summaries. Trisha_Keshav positive means partner owed user; negative means user owed partner. Settled rows create no live debt. Blank status is unknown, not automatically outstanding or settled. Historical category cleanup may change reporting but not agreed settlement amounts. Selected migration requires preview, provenance, explicit decisions, and verification against agreed cutover balances; it is not a prerequisite for V1.

## 10. Release And Deferred Compatibility

Manual backup includes schema version, stable IDs, source rows/import metadata, allocations/funding, links, rules, locks, audit, settlements, and external IDs. Include retained originals/attachments when present or explicitly declare exclusions; exports must not silently lose required financial evidence. Exclude secrets and machine-specific settings. Create consistent snapshots; validate integrity/version before restore, stage it separately, keep a safety copy of existing data, then replace atomically. Reject incompatible newer formats without altering existing data. Clearly label unencrypted exports.

Include the outbound operation journal and uncertain outcomes in exports. Every restore invalidates prior external-sync freshness, even when the backup contains no pending writes: it may predate a successful remote creation. Require remote reconciliation before enabling affected Splitwise writes. If remote identity cannot be established, keep the operation blocked for manual resolution rather than letting confirmation authorize an unsafe retry. Local accounting remains available.

Stable IDs, migration versions, explicit deletions/archives and provenance help later sync, but do not implement sync now. Do not share a live SQLite file via cloud-folder synchronization. Mobile later primarily captures expenses and shows balances; bank imports stay desktop. Future passphrase encryption will require a deliberate data/key/attachment migration; no decorative lock screen now.
