
---mode: agentdescription: Batch 20. Reopen the last file, offer recovered unsaved work, and autosave. About 30K tokens.---
Build batch 20 only.
Read: `.github/prompts/PHASE3.md`, `src/adapters/file-store.ts`, `src/ui/LocalApp.tsx`.
Create: `tests/file-store.test.ts`.

## Build
1. `file-store.ts`: pure `nextAutosaveDelayMs(failedAttempts)` returns `Math.min(30000, 1000 * 2 ** Math.min(failedAttempts, 5))`.
2. `FileStore`, IndexedDB database `"financeApp"`, stores `"handles"` and `"recovery"`. Every IndexedDB call is in try/catch; a failure only disables reopen or recovery for the session.
   - `rememberHandle(handle)`, `forgetHandle()`, `loadRememberedHandle()`, under key `"last"`.
   - `reopenHandle(handle)`: `queryPermission({ mode: "readwrite" })`; if not `"granted"`, `requestPermission` (call it only from a click handler). Read and parse like `openPickedFile`, set the handle and file name, and return `{ ledger, fileName }`. Throw a readable error when permission is refused.
   - `writeRecovery(fileName, content)`, `readRecovery()`, `clearRecovery()`, under key `"current"`, storing `{ fileName, content, savedAt }`.
   - `openPickedFile` and `saveAs` call `rememberHandle` in `"in-place"` mode.
3. `LocalApp.tsx`:
   - On mount in `"in-place"` mode, load the remembered handle. If present, show a banner "Reopen `<name>`?" with a Reopen button that calls `reopenHandle` and then `acceptOpenedLedger`.
   - After that resolves (or immediately when there is no handle), read recovery. When its content differs from the loaded ledger, show "Recovered unsaved work from `<time>`" with "Use recovered copy" (`parseLedger`, then `acceptOpenedLedger`) and "Discard" (`clearRecovery`). Show one banner at a time.
   - 1000ms after `currentContent` stops changing and there is no `serializationError`, call `writeRecovery`.
   - Autosave only in `"in-place"` mode with a file open: 1000ms after the last change, call `saveLedger(false)`. Success resets the failure count and clears recovery. Failure increments it, keeps the error banner, and retries after `nextAutosaveDelayMs`. A manual save also resets it.
   - In the sidebar's `ledger-controls`, the `ledger-unsaved` text becomes "Saved", "Saving…", or "Not saved · retrying". Keep the Open, Save as, and Save buttons.

## Tests
`nextAutosaveDelayMs(0)` is 1000, `(3)` is 8000, `(6)` is 30000.

## Done when
`npm test` and `npm run typecheck` pass. In Chrome: open a file, edit, see "Saved", reload, click Reopen, and the edit is there. Close an unsaved tab, reopen, and the recovery banner appears. Update `PROGRESS.md`. Next is 21.
