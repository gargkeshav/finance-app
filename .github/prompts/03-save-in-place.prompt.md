---mode: agentdescription: Batch 03. Open and save one JSON file in place, with a download fallback. About 25K tokens.---
Build batch 03 only.
Read: `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/DataView.tsx`, `src/env.d.ts`.Create: `src/adapters/file-store.ts`.
## Build
1. `file-store.ts`.   - Chrome and Edge: `showOpenFilePicker` and `showSaveFilePicker` for one `.finance.json` file. Keep the handle in memory. Save writes the whole file.   - Other browsers: the batch 02 download and upload.   - Never write without a handle the user picked. No IndexedDB, no auto-backup.   - If TypeScript lacks the picker types, declare the two functions in `src/env.d.ts`.2. `LocalApp.tsx`: Open, Save, and Save as in the `topbar`. Show the file name, and "Unsaved changes" when the ledger differs from the last save. Warn before closing the tab with unsaved changes.3. `DataView.tsx`: say which mode is active, and that the file is unencrypted.
## Tests
None.
## Done when
`npm run typecheck` passes. In Chrome: open a file, add a spend, save, reload, reopen, and the spend is there. Update `PROGRESS.md`. Next is 04.


