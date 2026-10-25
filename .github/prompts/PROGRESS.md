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

