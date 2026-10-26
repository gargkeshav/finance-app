
---mode: agentdescription: Batch 11b. Fix data-loss and crash bugs found in the phase 1 check. Run after 06. About 35K tokens.---
Build batch 11b only. Fix only what is listed. No new features.
First, if `PROGRESS.md` has no batch 06 entry, check `src/adapters/file-ledger.ts` for `categoryMemory`. If it is missing, stop and say: "Run 06 first, in a new session."
Read: `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/SpendForm.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/MappingEditor.tsx`, `src/ui/views/SettleView.tsx`, `src/ui/views/ImportView.tsx`. In `src/adapters/csv-mapping.ts`, search for `BANK_PRESETS` and `suggestPresets` only.
## Fix
1. New spends overwrite each other. `SpendForm.tsx` gives every new spend the id `"draft"` and `updatedAt: "draft"`. On save, a new spend gets `crypto.randomUUID()` and the current ISO time. Keep `"draft"` only for the in-form preview, never in `onSave`.2. The page blanks when the ledger fails validation, because `LocalApp.tsx` calls `stringifyLedger` on every render.   - `file-ledger.ts`: export `ledgerProblem(ledger): string | null`, which returns the readable message or null. `stringifyLedger` stays as it is.   - `LocalApp.tsx` `update`: if `ledgerProblem(next)` is not null, keep the previous ledger and show the message in `banner error`.   - The render-time `stringifyLedger` call goes inside a try/catch. On failure, treat it as unsaved and show the banner. The page never unmounts.3. Mapping editor writes `{ index: -1 }`. In `MappingEditor.tsx`, find headers trimmed and ignoring case, the way the parser does. A column that is not found becomes blank, or null for the balance column. Never an index below 0.4. Deleting a spend that has refunds breaks the file. In `ActivityView.tsx`, block the delete with "Delete its N refunds first." No cascade.5. Settle double-records. In `SettleView.tsx`, clear the form after a save and show `banner success`. Past settlements get Delete, with a confirm. Delete removes the settlement and clears `settlementId` on its bank rows.6. `ImportView.tsx`:   - List all presets, with suggested ones first and marked "Suggested".   - The import's `dateFrom` and `dateTo` cover every parsed row, including skipped duplicates.7. `ActivityView.tsx`: a refund shows the word "Refund" beside its description.
## Tests
None. Check fixes 1 to 5 by hand in `npm run dev` with made-up data.
## Done when
`npm test` and `npm run typecheck` pass. Then append to `PROGRESS.md`, newest last:
- One line each for batches 01 to 11, saying "built; checked in review", except 06, which says "built" only if you saw `categoryMemory`.- The 11b entry.
Next is 11c.

