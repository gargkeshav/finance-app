
---mode: agentdescription: Batch 32. A clean merchant name typed once is remembered and reused for the same description. About 25K tokens.---
Build batch 32 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/domain/reports.ts`, `src/ui/views/SpendForm.tsx`, `src/ui/views/ReviewView.tsx`, `src/ui/views/ActivityView.tsx`.
Create: `src/domain/merchants.ts`.

## Build
1. `merchants.ts`: `cleanMerchantKey(description)` lowercases, strips digits, collapses whitespace, and trims. `categoryMemoryKey` and `reports.ts`'s `merchantName` use it, with nothing else about them changing.
2. `ledger.ts`: `MerchantName { id; key; displayName; updatedAt }` and `Ledger.merchantNames?`. `merchantNameAfterSpend(ledger, entry, updatedAt)` works like `categoryMemoryAfterSpend`: for a spend with a non-blank `displayName`, it upserts by key.
3. `file-ledger.ts`: `merchantNames` schema, default `[]`.
4. `SpendForm.tsx`: a "Display name" input. It starts from `initialValues.displayName`, falling back to the matching `merchantNames` entry when that is undefined, and is saved trimmed, or as `undefined` when blank.
5. `ActivityView.saveEntry` and `ReviewView.saveSpend`: call `merchantNameAfterSpend` wherever `categoryMemoryAfterSpend` is already called.

## Tests
In `tests/ledger.test.ts`: `"SQ *BLUE BOTTLE 1234 SYDNEY NS"` with display name `"Blue Bottle"` creates one entry. A same-key description in different case updates it instead of adding a second.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 33.
