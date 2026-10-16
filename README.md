# Finance App Implementation Handoff

Status: Gate 0 implemented; Gate 1 manual ledger/recovery, initial Gate 2 bank imports with explicit import-history reconciliation, and the first Gate 3 spending-attribution calculation implemented. Native file-dialog acceptance is deferred with user approval. Claims/settlements and the remaining Gate 2/3+ workflows are not complete. Not ready for live financial use or V1 release.
Prepared: 2026-10-16.

## Current Implementation

React/TypeScript and Tauri 2 provide a manual ledger with accounts, balanced personal/House allocations, transaction details, confirmed atomic correction/reversal, native SQLite transactions, audit, optimistic concurrency, and exact-command recovery. Overview calculates personal attribution from active manual allocations using exact cents; this does not create claims or settlements. Unencrypted JSON export/restore uses native dialogs, staged validation, safety copies, and atomic replacement. ING, HSBC, ANZ credit, and ANZ transaction CSVs support sequential multi-file review with an independent atomic commit per file, explicit account/profile confirmation, preserved raw observations, exact-file retry protection, and manual occurrence decisions for overlapping exports. Claims/settlements, classification/rules, full reports, and Splitwise are not implemented yet.

Imported bank movements remain unclassified and do not automatically become expenses or income. Transactions separates manual entries from bank movements. Import accepts multiple UTF-8 CSVs in a sequential review queue; each file requires its own profile, account, occurrence decisions, and confirmation, then commits independently and atomically. Possible overlaps are ranked using preserved raw-field equality and adjacent transaction sequence from prior imports of the same profile, plus known balance agreement; these are suggestions only, and each match or keep-new decision remains explicit. Keep-new choices persist rejected candidate IDs. Import history can explicitly relink a kept-new occurrence to a previously rejected active event, with a required reason and retained old mapping. The prior event stays in database and audit history while no longer appearing in active movements if unreferenced. Each file is limited to 5 MiB/10,000 rows, with optional retention of exact original bytes. Preview and bank tables use 50-row pages without omitting other rows from the command. All-or-nothing multi-file commits, structured reference extraction, pending/posted reconciliation, transfer matching, and broader import acceptance remain outstanding. Schema-4 complete-export size is limited to 32 MiB; native writes reject changes that would exceed that recovery limit.

See [docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) for executed checks and gate status and [docs/CONTRACTS.md](docs/CONTRACTS.md) for the current boundary.

```sh
source "$HOME/.nvm/nvm.sh"
nvm use
export PATH="$HOME/.cargo/bin:$PATH"
npm ci
npm run tauri dev
```

For an explicitly synthetic, non-persisted browser preview:

```sh
VITE_SYNTHETIC_PREVIEW=1 npm run dev -- --port 1421
```

Tests: `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run test:native:smoke`, and `npm run test:native:packaged`. Native smoke tests use and remove a temporary synthetic profile; the packaged smoke uses a debug app, not a production release acceptance test. Build the normal macOS bundle with `npm run tauri -- build --bundles app`.

Local databases and exports are unencrypted. Do not enter live finances until recovery and the remaining acceptance gates pass. Native data lives under the OS application-data directory for `local.financeapp.desktop`; browser preview deliberately loses all data on reload. In Transactions, open a description to inspect or correct an entry. Corrections atomically reverse the original and record a replacement; neither corrections nor reversals delete original evidence. Data management contains export/restore. Native export/restore dialogs still need an interactive walkthrough on this Mac, where UI automation is disabled.

## Start Here

1. Read AGENTS.md for execution and delegation rules.
2. Read IMPLEMENTATION_PLAN.md for approved scope, financial semantics, work packages, and acceptance gates.
3. Read VERIFICATION.md for the independent release checklist.
4. Complete Gate 0 before committing to dependencies or parallel implementation.

The original handoff requested a separate implementation agent followed by independent verification. Implementation has now begun under that handoff; the original scope and release requirements below remain authoritative.

## User Setup

- Open this folder as the VS Code workspace for implementation, or move these documents together to the chosen repository root.
- Confirm macOS is the initial release target. Other desktop platforms are future build targets, not currently tested support.
- The implementation agent must check Node.js LTS, the package manager, Rust stable/Cargo, and Tauri 2 prerequisites. macOS native builds require Xcode Command Line Tools. Installation requiring credentials or elevated privileges must be performed by the user directly.
- Provide approval for dependency downloads during setup. No hosted backend, cloud account, paid AI service, or live bank credentials are needed.
- Identify the four bank accounts and the House common account in onboarding. Confirm whether HSBC joint is the account used to settle House claims or whether that is a separate account.
- Choose when live balance tracking starts. Confirm partner/friend/House amounts outstanding and any unused advances at that date. Use zero only when explicitly confirmed; never infer it from incomplete statements.
- Supply fuller bank history later as available. Credit-card and bank opening balances must be entered or reconciled before claiming accurate account balances.
- Splitwise credentials are needed only for that integration stage. Enter them directly into the app, never chat, source files, fixtures, or logs. Access/terms must first pass the feasibility gate.
- Decide whether original imported CSVs should be retained inside the data folder. Raw row provenance is required regardless. Initially all financial files and manual exports are unencrypted.

## Reference Data

Private user files are outside this folder. Do not commit or duplicate them into the repository without permission. Verify their presence before use; no filenames establish account identity.

| Source                 | Local reference path                     | Purpose                                          |
| ---------------------- | ---------------------------------------- | ------------------------------------------------ |
| ING transaction        | /Users/kesh/Downloads/ING_trans.csv      | Recurring bank format                            |
| HSBC joint             | /Users/kesh/Downloads/HSBC_joint.csv     | Recurring bank format                            |
| ANZ credit             | /Users/kesh/Downloads/ANZ_credit.csv     | Recurring bank format                            |
| ANZ transaction        | /Users/kesh/Downloads/ANZ_trans.csv      | Recurring bank format                            |
| Annotated ANZ history  | /Users/kesh/Documents/ANZ_history.csv    | Learning/reference or approved one-time data use |
| Common account history | /Users/kesh/Documents/Common_account.csv | Settled historical summaries, not bank events    |
| Partner history        | /Users/kesh/Documents/Trisha_Keshav.csv  | Settled signed bilateral records                 |

Build anonymized synthetic fixtures preserving edge cases, not copies containing real names, references, addresses, or account identifiers.

## Implementation Handoff Prompt

> Read README.md, AGENTS.md, IMPLEMENTATION_PLAN.md, and VERIFICATION.md. Implement the finance app in stage order, beginning with Gate 0. Use a high-capability lead for architecture, financial logic, persistence, integration, and final decisions. Delegate independent, bounded work to cost-efficient subagents when suitable and available, with explicit contracts and independent quality checks. Do not weaken tests or financial invariants to satisfy a gate. Preserve user files and changes. Do not implement deferred features. Record actual commands, results, blockers, and residual risks in a verification report. Pause only for a genuine blocker, credentials, required permissions, or a material product decision.
