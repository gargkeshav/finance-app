
---mode: agentdescription: Batch 34. Suggest a rule when the same category and split were set by hand three or more times. About 20K tokens.---
Build batch 34 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/domain/rules.ts`, `src/domain/merchants.ts`, `src/ui/views/RulesView.tsx`.

## Build
1. `rules.ts`: `suggestRuleFromHistory(entries, rules, minOccurrences = 3)` returns `{ key, sampleText, categoryId, split, count } | null`.
   - Group spends that have a category by `cleanMerchantKey(description)`.
   - A group qualifies when it has at least `minOccurrences` entries and all of them share one `categoryId` and one split shape. The shape is `payer` (the payer keeps all of it), `entity` (one other entity takes all of it), or `equal` (the same entity set in equal shares). This is exact, not a majority vote.
   - Skip a group when an enabled rule already matches its newest description via `matchesCore`.
   - Return the largest `count`, with ties broken by `key`.
2. `RulesView.tsx`: after load and after any rule change, show a banner: "You've set '`<sampleText>`' to `<category>` `<count>` times. Create a rule?"
   - "Create rule" prefills the new-rule form with `text`, `mode: "contains"`, the category, and the split. Saving still goes through Preview.
   - "Dismiss" hides that key for the session.

## Tests
In `tests/ledger.test.ts`: four matching entries give `count: 4`. A fifth with another category disqualifies the key, giving `null`.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Phase 3 is done. Ask the user before writing the "Later" prompts in `PHASE3.md`.
