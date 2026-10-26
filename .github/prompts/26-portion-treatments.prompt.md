
---mode: agentdescription: Batch 26. A portion can be a claim, write-off, gift, or report-only; only claims are debts. About 25K tokens.---
Build batch 26 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/views/SpendForm.tsx`, `src/ui/views/EntityView.tsx`.

## Build
1. `ledger.ts`: `Portion.treatment?: "claim" | "writeOff" | "gift" | "reportOnly"`, where `undefined` means claim. `debtsOf` keeps only portions whose `treatment ?? "claim"` is `"claim"`. Reports and totals do not change.
2. `file-ledger.ts`: the optional enum on `portionSchema`.
3. `SpendForm.tsx`: a Treatment select on each portion row (Claim, Write off, Gift, Report only). Claim stores `undefined`.
4. `EntityView.tsx`: a "Written off and gifted" section listing this entity's write-off and gift portions, with the debt each would have been (from `debtsOf` on a copy treated as a claim). Write-offs get "Start claiming", which sets the portion to a claim via `update(..., "Start claiming write-off")`.

## Tests
In `tests/ledger.test.ts`: on a $30 spend, a friend's $10 write-off creates no debt, while a $10 claim creates one. `report` totals are equal in both cases.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 27.
