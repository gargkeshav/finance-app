# Progress
Append entries newest last. A handoff note lists steps done, files changed, and the next step.
- Batch 0: Instructions and eleven batch prompts written. No app code changed. `node_modules` is not installed. Next: 01.
- Batch 01: Ledger rules and JSON file format implemented.
- Files changed: `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `tests/ledger.test.ts`, `.github/prompts/PROGRESS.md`.
- Left: none. Next: 02.
- Batch 02: Local shell and manual views implemented; both spend directions verified through the form.
- Files changed: `src/ui/LocalApp.tsx`, `src/ui/views/AccountsView.tsx`, `src/ui/views/PeopleView.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/SpendForm.tsx`, `src/ui/views/BalancesView.tsx`, `src/ui/views/DataView.tsx`, `src/main.tsx`, `.github/prompts/PROGRESS.md`.
- Left: none. Next: 03.
- Batch 03: In-place JSON open/save with download/upload fallback, unsaved-change tracking, and close warning implemented. Typecheck and existing tests pass.
- Files changed: `src/adapters/file-store.ts`, `src/env.d.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/DataView.tsx`, `.github/prompts/PROGRESS.md`.
- Left: Chrome picker round-trip was not manually exercised in this session. Next: 04.
- Batch 04: CSV mappings, ING/HSBC/ANZ presets, row parsing, duplicate-aware matching, and optional ledger import storage implemented.
- Files changed: `src/adapters/csv-mapping.ts`, `src/adapters/file-ledger.ts`, `tests/csv-mapping.test.ts`, `.github/prompts/PROGRESS.md`.
- Left: none. Next: 05.
- Batch 05: CSV import, mapping editor, spend/income/skip review, and linked activity details implemented; browser smoke check passed.
- Files changed: `src/adapters/csv-mapping.ts`, `src/domain/ledger.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/ImportView.tsx`, `src/ui/views/MappingEditor.tsx`, `src/ui/views/ReviewView.tsx`, `.github/prompts/PROGRESS.md`.
- Left: none. Next: 06.
- Batch 06 handoff: Read the requested ledger, adapter, form, review, balances, and ledger-test files. `SpendForm` is also used by `src/ui/views/ActivityView.tsx`, outside the batch's allowed files; add-new categories must persist through both save paths. No implementation files changed.
- Files changed: `.github/prompts/PROGRESS.md`.
- Next: Read `src/ui/views/ActivityView.tsx` and wire category creation through both `SpendForm` callers, then complete batch 06.
- Batch 07: Settlement persistence, oldest-first open-item allocation, bank-row settlement flow, and settlement view implemented. Tests and typecheck pass.
- Files changed: `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/ReviewView.tsx`, `src/ui/views/SettleView.tsx`, `tests/ledger.test.ts`, `.github/prompts/PROGRESS.md`.
- Left: none. Next: 08.
- Batch 08: Unambiguous transfer suggestions, dismissals, transfer/contribution/settlement confirmation, card-cycle checks, and settlement bank activity implemented. Tests and typecheck pass.
- Files changed: `src/domain/transfers.ts`, `src/ui/views/ReviewView.tsx`, `src/ui/views/SettleView.tsx`, `tests/ledger.test.ts`, `.github/prompts/PROGRESS.md`.
- Left: none. Next: 09.

