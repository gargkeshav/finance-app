
---mode: agentdescription: Batch 25. Group types and a default split per group; House's fixed half becomes the fallback. About 40K tokens.---
Build batch 25 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/views/PeopleView.tsx`, `src/ui/views/SpendForm.tsx`.

## Build
1. `ledger.ts`:
   - `Entity` gains optional `groupType` (exported `GroupType = household | trip | friends | project | other`), `members: { entityId; weight }[]`, and `defaultAllocation` (`{ mode: "shares" } | { mode: "percent"; yourPercent }`).
   - `SplitPreset` gains `{ kind: "shares"; shares: { entityId; weight }[] }` and `{ kind: "percentEntity"; entityId; yourPercent }`. Keep `halfHouse` unchanged.
   - `splitPreset`, `percentEntity`: self gets `Math.ceil(amount * yourPercent / 100)` and the entity gets the rest.
   - `splitPreset`, `shares`: throw a `RangeError` on empty shares, non-positive-integer weights, or duplicate ids. Otherwise give each share `floor(amount * weight / total)` using BigInt, hand leftover cents one at a time by weight (largest first, ties by `entityId`), and drop zero portions.
   - `defaultSplitPreset(entity, amountCents)`:
     - House with no `defaultAllocation` returns `{ kind: "halfHouse" }`.
     - Any other non-group returns `null`.
     - `percent` returns `percentEntity`.
     - `shares` returns `members` plus self at weight 1 when self is missing, or `null` when there are no members.
2. `file-ledger.ts`: schemas for the new entity fields (`weight` a positive integer, `yourPercent` an integer 0–100) and the two presets.
3. `PeopleView.tsx`: editing a group also edits Type, Members (people with a weight input, default 1), and Default split ("No default", "Equal shares", or "Percent to you" with a 0–100 input).
4. `SpendForm.tsx`: on a new entry (not an edit) with a valid amount and no portions yet, choosing a group or House applies `defaultSplitPreset` once per selection, like the preset buttons do (including `activePreset`). It is not reapplied on amount keystrokes.

## Tests
In `tests/ledger.test.ts`: weights 2:1:1 on $100 split $50/$25/$25. On $1.01, the extra cent goes to the weight-2 share. House with no default gives `halfHouse`.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 26.
