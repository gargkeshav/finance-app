
---mode: agentdescription: Batch 30. Review splits rows into already recorded, waiting on another account, and needs you. About 40K tokens.---
Build batch 30 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/domain/transfers.ts`, `src/domain/health.ts`, `src/ui/views/ReviewView.tsx`, `src/ui/LocalApp.tsx`.
Create: `tests/transfers.test.ts`.

## Build
1. `transfers.ts`, pure:
   - `existingEntryFor(ledger, row)` finds the entry a bank row already describes. This is how history entries meet a later bank import. Candidates are:
     - spends (for a negative row) or refunds (for a positive row) on `row.accountId` with no bank rows, where `(chargedCents ?? amountCents) === Math.abs(row.amountCents)`;
     - `card-payment` transfers from batch 29 within 3 days with the same absolute amount, where the row is either a positive row on the transfer's card or a negative row on an asset account with the same payer as the card, and the transfer has no row from that account yet.

     Prefer a candidate on the same date, then a unique one within 2 days (3 for transfers). Return `null` when the choice is ambiguous.
   - `isWaitingOnOtherAccount(ledger, row)`: `false` when `suggestTransfers` already pairs the row, or when another account's `accountCoverage` reaches at least 3 days past `row.date`. Otherwise `true`. It is a heuristic. It only delays a row, never hides it.
2. `ReviewView.tsx`: split the pending rows into three groups.
   - Already recorded: rows with an `existingEntryFor`. Each gets "Link", which appends `row.id` to the entry's `bankRowIds` and sets the row's `entryId`, without changing the entry otherwise. A card payment shows "Card payment from history". "Link all `<n>`" makes one `update(..., "Link bank rows to existing entries", "matcher")`.
   - Waiting: rows where `isWaitingOnOtherAccount` is true and no rule or memory applies. They sit in a collapsed "Waiting on another account" section. "Show anyway" moves a row into the main table for this session.
   - Needs you: everything else.

   The heading reads "`<n>` need you", followed by muted "+`<n>` recorded" and "+`<n>` waiting" when those are nonzero.
3. `health.ts`: "Possible double entries" also compares unlinked `history` entries with bank-linked entries on the same account, date, and amount.
4. `LocalApp.tsx`: the Review nav badge counts only "needs you" rows.

## Tests
In `tests/transfers.test.ts`:
- A history entry of $12.50 on account A, dated 2024-01-03, and a pending A row of -$12.50 dated 2024-01-04: `existingEntryFor` returns the entry. With two such entries, it returns `null`. A `card-payment` transfer of $500 on card C, dated 2024-02-01, matches a savings row of -$500 dated 2024-02-02.
- Account A has coverage to 2024-01-05, and a B row dated 2024-01-04 has no match: the row is waiting. With A's coverage extended to 2024-01-10, it is not.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 31.
