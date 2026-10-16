# Independent Verification Contract

These are required checks, not executed results. The implementation agent supplies repeatable commands and synthetic fixtures. An independent verifier reruns them and reports findings with file/line references, severity, reproduction, and expected behavior.

## Required Evidence

- A requirement-to-test matrix mapping plan sections and case IDs below to test names and commands.
- Dependency/tool versions, platform, schema version, actual command output summaries, and unrun checks.
- Unit tests for pure domain logic; real SQLite/native integration tests for persistence and transactions; browser journeys for interaction; native packaged-app smoke tests.
- Screenshots of desktop and narrow-width UI plus keyboard/accessibility/zoom checks. No private financial data in artifacts.
- A fresh-profile manual export/restore walkthrough with before/after financial totals and integrity checks.
- Final result: pass, fail, or explicitly blocked for each release gate. Tests skipped due missing API/tooling are not passes.

## Accounting Cases

| ID | Scenario | Required result |
| --- | --- | --- |
| F01 | User personally pays $120 entirely House | House spending $120; user attribution $60; House claim $120; no partner debt |
| F02 | Common account reimburses F01 | Claim zero; spending unchanged; transfer/settlement not additional consumption |
| F03 | Common account directly pays $120 House | Same attributed consumption; no user reimbursement claim |
| F04 | Each partner contributes $500 to common account | Funding only; no spending; no invented partner obligation |
| F05 | User pays $150: $100 House, $50 friend | User attribution $50; House claim $100; friend claim $50; no duplicated partner claim |
| F06 | Friend pays $20 toward F05 | Friend owes $30; no new income or reduced original consumption |
| F07 | Expense $586.32; House portion $419.40 | House allocation $419.40; remainder $166.92 unresolved/explicitly allocated; House half $209.70 |
| F08 | Buy $100 gift card; redeem $40 plus $80 bank for $120 purchase | Acquisition zero consumption; expense $120; stored balance $60; no duplicate spending |
| F09 | House $15.18 funded $5.18 card plus $10 stored value | Bank event unchanged; total House $15.18; user attribution $7.59; claim follows explicit funding ownership |
| F10 | $100 purchase funded $80 cash + $20 points; later $5 cashback | Gross $100; points funding/benefit $20; cashback $5; after-cashback consumption $95; benefit-adjusted cost $75; cash outflow $80 with $5 cash credit separately; no double subtraction |
| F11 | $95.91 historical purchase already annotated net $35.91 plus $60 refunds | Do not automatically subtract $60 again; preserve source components and flag legacy netting interpretation |
| F12 | $490.36 card payment and matching credit-card receipt | Linked repayment; no spending or income; liability/cash movement correctly represented |
| F13 | $100 claim; $99.99 payment | Residual $0.01 remains until explicit rounding adjustment; exact bank amount preserved |
| F14 | $10 split equally three ways | $3.34/$3.33/$3.33 under documented deterministic residual policy; total $10 |
| F15 | Advance $100; later eligible obligation $60 | Credit application clears $60; remaining credit $40; no duplicate money movement |
| F16 | One $80 receipt settles claims $30 + $50 | Both cleared once; reject overapplication; reversal restores obligations atomically |
| F17 | Historical settled summaries and signed partner entries | No live debt or fabricated bank event; source preserved; blanks remain unknown |
| F18 | Source refund, goodwill credit, or positive card event | Not automatically income; classification/link explicit; bank balance stays correct |
| F19 | Incomplete bank history with no opening balance | Balance marked incomplete/unknown; not presented as true current balance |
| F20 | Personally paid $120 House purchase receives $30 refund before reimbursement | House net consumption $90; unpaid House claim $90; personal refund does not become income |
| F21 | Same $30 personal refund after House reimbursed $120 | House net consumption $90; historical reimbursement preserved; $30 owed back to House; no reopened $120 claim |

For F10 use explicit labels for gross consumption, after-cashback net, benefit-adjusted cost, and cash flow. The UI must not present these different measures under one ambiguous spending label. Finalize report conventions before implementing comparisons.

## Import Cases

| ID | Scenario | Required result |
| --- | --- | --- |
| I01 | Rename every sample | Identical parsing; account assignment explicit; filenames never financial identity |
| I02 | Headerless ANZ first row and ambiguous subtype | First row retained; subtype confirmation required where ambiguous; extra fields preserved as strings |
| I03 | ING negative debits, blank credit, one-cent values | Correct cents; no double negation; absent is not zero; conflicting cells flagged |
| I04 | HSBC quoted thousands, NBSP, extra empty header | Valid parse, raw evidence retained; unexpected data columns not discarded silently |
| I05 | 3/10/2026 and embedded purchase date | Australian date interpreted correctly; source posting and purchase dates separate; invalid dates rejected |
| I06 | Exact-file retry | No new financial records or duplicate effects; import attempt traceable |
| I07 | Three identical +$9.99 card rows | Preserve three occurrences; do not assume erroneous duplicates; retry adds none |
| I08 | Two identical purchases in overlapping exports, then possible third | Multiplicity preserved; proven overlap adds none; indistinguishable new occurrence reviewed, not lost |
| I09 | Repeated same-day one-cent purchases with different receipts/balances | Distinct source events retained |
| I10 | Newest, older, then overlapping import | Stable IDs/locks/links; totals equal equivalent reconciled complete history; no date watermark omissions |
| I11 | ING debit 3 October, ANZ credit 5 October | Cross-account transfer candidate supports lag; never deduplicated across accounts |
| I12 | Two pending $40 observations, one posted $40 | No arbitrary match; posted and pending separated; confirmation avoids double count |
| I13 | Changed source description conflicts with confirmed category/link | Source observation retained; manual decision unchanged; conflict review visible |
| I14 | Malformed row, failed commit, or stale version | Clear error; no silent skip or partial transaction; safe retry |
| I15 | Known complete source balance sequence vs missing coverage | Correct reconciliation without inventing balances, ignoring same-day order, or treating gaps as proven errors |

## Rules And UI

- U01: Manual per-field confirmation beats rules; category lock does not suppress unrelated transfer suggestions. Rejected matches stay rejected across reruns.
- U02: Auto-applied decisions remain searchable/reviewable even when not flagged; explanation and undo/reversal available.
- U03: Rule preview shows affected records, precedence, and exclusions before apply. Bulk operations respect locks and stale versions.
- U04: Personal/House toggle, category/merchant reports, adjustment dates, filters, and drill-down reconcile to the same fixture records.
- U05: Complete import -> review -> allocation -> House/friend settlement -> report journey using real persisted state.
- U06: Categories/people/groups/tags can be managed and archived without breaking referenced history; notes do not overwrite source descriptions.
- U07: Keyboard-only primary journeys, labels, focus restoration, contrast, non-color status, 200% zoom, no clipped amounts or overlapping panels.
- U08: Empty, loading, invalid input, offline Splitwise, failed import, partial coverage, unallocated funds, and restore confirmation are actionable and honest.
- U09: Browser synthetic adapter cannot access a real database or credentials; native integration behavior tested separately.

## Splitwise

- S01: Current API/access/terms feasibility recorded; blocked external integration clearly separated from working local sharing.
- S02: Reading existing remote records links to local expenses once; pagination, updated/deleted records, currencies, and categories handled explicitly.
- S03: Publishing requires preview/confirmation, includes only chosen shared data, stores external ID, and does not duplicate local claims.
- S04: Timeout after remote creation enters uncertain state; no blind retry. Test remote reconciliation and manual resolution.
- S05: Remote settled status without bank evidence and bank receipt before remote settlement remain distinguishable. Cash settlement is possible.
- S06: Consolidated/simplified debts and partial receipts do not force false links to individual original creditors or expenses.
- S07: Rate limits, response error bodies, offline recovery, local locks, and conflicting external changes tested with mocks; no live writes without permission.
- S08: Credentials never appear in logs, exports, browser storage, fixtures, repository, or chat; verify native secure storage.

## Recovery And Native Release

- N01: Native dev and packaged app launch; file dialogs/imports work; database survives restart; no unexpected network dependency.
- N02: Migrations from supported versions retain financial invariants; failed migration or stale write leaves valid state. Foreign-key enforcement verified.
- N03: Manual backup uses a consistent snapshot; complete provenance/rules/locks/relationships/settlements/external IDs restore into a fresh profile with identical reports and balances.
- N04: Corrupt, incomplete, unsupported-newer, or malicious archive paths rejected. Existing database unchanged on restore failure; safety copy and atomic replacement verified.
- N05: Restored external links do not automatically replay old outbound writes. Secrets excluded; reconnect explicitly as needed.
- N08: Outbound journal and uncertain outcomes survive backup. Restoring a backup predating remote creation forces reconciliation before affected writes; unmatched identity blocks retry even after user confirmation. Local accounting still works.
- N06: Data folder/export clearly unencrypted. Originals retention choice honored; no telemetry or private data in test artifacts.
- N07: Supported-platform claims match actual builds. macOS verification does not establish Windows/Linux/mobile support.

## Verifier Handoff Prompt

> Independently verify the implementation against IMPLEMENTATION_PLAN.md, AGENTS.md, and every case in VERIFICATION.md. Inspect the code and execute tests; do not rely solely on implementer summaries. Prioritize financial correctness, duplicate data loss, settlement double-counting, manual-lock preservation, native persistence, and recovery. Use independent subagents for separate review areas where useful; reserve capable reasoning for accounting/integration conclusions. Do not use live credentials or mutate real user finances. Report severity-ranked findings with reproduction and code references, coverage gaps, actual checks, and a clear release recommendation. Fixes require rerunning focused and regression checks; do not silently weaken requirements.