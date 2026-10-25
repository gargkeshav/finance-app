---mode: agentdescription: Batch 09. Coverage, balance checkpoints, including older history, and refunds. About 45K tokens.---
Build batch 09 only.
Read: `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/views/AccountsView.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/ReviewView.tsx`, `src/ui/views/SpendForm.tsx`, `tests/ledger.test.ts`.
## Build
1. `file-ledger.ts`, optional `checkpoints`: `id`, `accountId`, `date`, `balanceCents`, `note`, `updatedAt`. An entry gets optional `refundOf` (null).2. `ledger.ts`.   - Coverage per account: merge the `dateFrom`–`dateTo` ranges of its imports. A gap is a space between merged ranges.   - Checkpoint check, between two checkpoints on one account: the later balance minus the earlier, against the sum of bank rows dated after the earlier one up to the later one. Return the difference. Never fix it.   - Refund:     - An entry with `kind: refund` and `refundOf` set to one spend. The payer is the payer of the account it landed in.     - Default portions are the original's portions, scaled to the refund amount with the batch 06 rounding, and they can be edited.     - In the report and in debts, a refund's portions count negative. There is no separate settled case.     - In `openItems`, a negative debt is listed as an item the other way, on the refund's date. It does not consume the original item.3. `AccountsView`: per account, coverage ranges and gaps, checkpoints, an Add checkpoint control, and each difference.4. `ReviewView`: a positive row can be a Refund. List spends on the same account with a similar description first, then all spends. Use `SpendForm` with the refund defaults.5. `ActivityView`: a filter "Not counted toward balances", and buttons to include or exclude the selected entries. This is how older history joins live balances.
## Tests
One test in `tests/ledger.test.ts`: a $100 House portion on your card, fully settled by House, then a $30 refund to your card. You owe House $30.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 10.


