# Current Implementation Contracts

Stage: Gate 1, initial Gate 2, import-history reconciliation, and the first Gate 3 House-claim read model, schema 4. This is not the final V1 schema or a stable external API.

## Dependency Direction

- Domain: pure TypeScript, Decimal for validated decimal input, BigInt for exact totals, no React/native/storage/network.
- Application: strict Zod contracts and a Ledger interface.
- Native adapter: validated read/execute/resolve IPC; no arbitrary SQL, paths, or credential operations.
- Synthetic adapter: development-only, in-memory, no native imports or browser storage.
- Rust: boundary/invariant validation and atomic SQLite persistence. Financial attribution/claim policy is not duplicated in Rust.

## Current Spending Attribution

Overview calculates personal attribution from active manual allocations: personal portions plus one half of aggregate House allocations. Gross consumption and House allocations are aggregated in BigInt cents; if aggregate House cents are odd, the residual cent is assigned to the user's attribution. Reversed expenses are excluded.

Sharing derives a provisional House reimbursement claim from each active manual expense's House allocation when its single funding account has personal ownership. The full House portion is claimed; common-account funding produces no personal claim. Corrections and reversals update the read model from active source expenses. These claims are not yet persisted independently and no settlement applications are represented, so displayed amounts are before reimbursement.

## Value Contract

AUD amounts are integer cents within the JavaScript safe-integer range. Input rejects sub-cent precision, exponents, separators, whitespace, and unsafe values. Ledger-wide display aggregates use exact BigInt totals and may exceed the individual-record range without crashing rendering. Dates are strict Gregorian `YYYY-MM-DD`, from 1900 through 9999, with no timezone conversion. All internal identifiers are canonical lowercase RFC 4122 version-4 UUIDs.

## Commands

The strict envelope contains `commandId`, `expectedEpoch`, `expectedRevision`, and an allowlisted operation. Currently supported: `createAccount`, `createExpense`, `reverseExpense`, `correctExpense`, `commitImport`, and `reconcileImport`. Creation versions are exactly 1. A single ledger revision is an intentionally conservative optimistic-concurrency boundary. Restore regenerates the epoch so a pre-restore view cannot save against an accidentally matching revision.

Accounts explicitly identify asset/credit kind and personal/common role. Opening balance/date are both supplied or both unknown. Even a supplied opening balance is not presented as a verified current balance without posted bank coverage.

Expenses in this stage are positive, AUD, manually entered, fully funded from one existing account, with positive personal/House allocations summing exactly to the expense. The UI requires confirmation that the non-House remainder is personal. Person allocations, drafts, multiple funding sources, claims, and reversals are not supported yet, rather than silently inferred.

SQLite `BEGIN IMMEDIATE` encloses the expense, allocations, funding, audit, and revision. Foreign keys and identity constraints are enabled. Stale revisions fail. An exact command retry returns current persisted state without another effect; a reused command ID with a different payload fails. `resolve_ledger` checks the canonical submitted command against audit evidence. On uncertain responses the UI retains the original command, locks its fields, and permits only that exact retry until the outcome is reconciled.

Audit stores the submitted command and native timestamp. Newer schema versions are rejected. Raw bank evidence and financial decision provenance are required at later gates; no bank sources have been imported.

Reversal requires the active expense ID and a nonempty reason. It is a correction of a manual entry, not a refund or a new bank event. The journal retains the original expense, funding, and allocations; derived totals exclude reversed entries. Correction requires the original expense ID, reason, and a fully validated replacement with new IDs. Reversal and replacement commit together in the same transaction. Existing IDs and original amounts are never overwritten. Exact retry applies the correction once, and duplicate reversal/correction of an inactive original fails. No later-stage claims exist to unwind yet.

## Manual Recovery

Export format 1/schema 4 is unencrypted JSON, limited to 32 MiB. Schema-2 and schema-3 exports remain restorable. It includes manual records, bank imports/events, raw observations, rejected-candidate evidence, import reconciliation history, optionally retained original CSV bytes, original audit requests/timestamps, and recovery history. A reconciliation preserves the prior event record physically and in audit history while snapshots expose only events still referenced by current import rows. Single-account funding is reconstructed deterministically from each audited creation/correction. No attachments, external IDs, rules, or credentials exist yet. Every native write checks the complete export size before commit, and staged restores check it before replacement. This intentionally conservative capacity check currently serializes the full ledger on each write; larger-history performance remains unverified. Each later schema expansion must expand and retest recovery before acceptance.

Native file dialogs choose paths; the renderer cannot provide arbitrary paths. Export cannot target the live data directory. Restore requires both an in-app checkbox and native confirmation, stages replay in an isolated temporary SQLite database, validates original epochs (with compatibility for schema-1 journals), reconciles resulting records to the snapshot, and retains an unencrypted safety export. A `BEGIN IMMEDIATE` transaction rechecks epoch/revision and atomically replaces only allowlisted ledger tables. Failed staging or replacement leaves prior financial state unchanged. Recovery audit and a fresh epoch survive subsequent exports/restores. Invalid/newer/unknown-field documents are rejected; no archive path extraction occurs. Native file-dialog interaction is not yet verified.

## Initial Bank Import

Papa Parse reads CSV without dynamic numeric coercion. Strict Australian posting dates and validated AUD cents are normalized in TypeScript; raw field arrays and source ordinals remain unchanged. ING separates nonempty credit/debit and preserves already-negative debits. HSBC supports quoted grouping commas, leading date spaces, NBSP descriptions, and an empty trailing header; nonempty unexpected columns block commit. ANZ is headerless, preserves the first row and every trailing string field, and requires explicit subtype confirmation when ambiguous.

The file input provides only an explicitly selected file, not arbitrary filesystem access. UTF-8 decoding is strict. SHA-256 is computed over original bytes via WebCrypto. Optional original retention stores those bytes as base64, validated against the hash natively; raw observations are always retained. All data stays local. Native commands validate schema/amount/date/identity bounds, account ownership of chosen matches, occurrence uniqueness, and atomically persist the import, newly created events, audit, and revision.

The fixed profile interpretation is version 1. Exact-file identity is scoped to account/profile/content hash; retries add an audited command but no new import/event records. File names never define account identity. For other exports, same-account posting date, amount, and normalized description identify possible matches, not duplicates. Candidate ordering now considers exact equality of preserved raw source fields and matching adjacent normalized occurrences from prior imports of the same profile, plus equal known balances. This evidence is review-only: every candidate still requires an explicit link or keep-new decision, and no reference field is treated as a unique key. When keep-new is chosen, compatible candidate event IDs are recorded in that row's `rejectedEventIds`; later previews label these candidates but keep them selectable. `reconcileImport` can explicitly relink a kept-new occurrence to one of those rejected candidates, but not to an unreviewed event or an event already mapped to another occurrence in that import. It requires a reason and records the prior/selected event IDs and command ID. Native validation rechecks account, date, amount, description, current mapping, and candidate activity in one transaction. The old event remains stored; snapshots omit it only if no import occurrence refers to it. Older schema-3 imports default new provenance/history arrays to empty. Two source occurrences in one file cannot map to the same event. Matching never crosses accounts. No date watermark exists. Each chosen link, rejection, and later reconciliation remains in import/audit history.

Bank events and economic expenses remain separate; unclassified credits are not income and debits are not automatically consumption. Multiple files can be selected into a sequential review queue, but each file requires its own explicit profile/account/match confirmation and commits as an independent atomic command. A later file failure does not roll back completed files; remaining files stay queued for review. All-or-nothing multi-file commits are not supported. Bank movement rows receive a review-only possible-transfer suggestion only when exactly one outgoing and one incoming event have the same posting date and exact magnitude across different accounts. Zero amounts and groups with multiple same-magnitude occurrences are not suggested. Suggestions do not persist a link or change classification, consumption, or balances. Explicit typed transfer links, pending/posted reconciliation, structured reference extraction, sequence/multiplicity proofs, and bank-to-expense classification remain unimplemented. Gate 2 acceptance remains pending those requirements and broader verification. Gate 1 native dialog verification was explicitly deferred by the user to continue implementation.

## Test Isolation

Browser preview requires development mode and `VITE_SYNTHETIC_PREVIEW=1`. Production browser loads cannot reach native storage and fail visibly. Production frontend output excludes the synthetic adapter and native smoke harness.

Native smoke uses `FINANCEAPP_SMOKE_DIR`, honored only by debug builds. Its completion command is absent from release builds and rejects use without an explicit smoke profile. `native-smoke` frontend mode exists only for the packaged debug test. The runner creates a fresh OS temporary directory and removes it afterward. Normal release builds must use the default production mode.
