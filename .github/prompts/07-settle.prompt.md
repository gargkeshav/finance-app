---mode: agentdescription: Batch 07. Settle with House, a person, or a group, oldest first, from a bank row or by hand. About 40K tokens.---
Build batch 07 only.
Read: `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/BalancesView.tsx`, `src/ui/views/ReviewView.tsx`, `tests/ledger.test.ts`.Create: `src/ui/views/SettleView.tsx`.
## Build
1. `file-ledger.ts`, optional `settlements`: `id`, `date`, `entityId` (not self), `direction` (`theyPaidYou | youPaidThem`), `amountCents`, `bankRowIds` ([]), `note`, `splitwisePaymentId` (null), `updatedAt`.2. `ledger.ts`.   - Balance with an entity: the batch 01 number − what they paid you + what you paid them. A payment beyond the debt simply makes the sign flip. That is credit.   - `openItems(ledger, entityId)` is derived and never stored.     - It lists what that entity owes you: the baseline when it is positive, dated before everything, then each debt from an entry that counts toward debt, oldest first.     - What they paid you is used against those items, oldest first. It lists what you owe them the same way.     - Return the items with their open amount.3. `SettleView`:   - Pick an entity. Show the net balance, then the open items both ways.   - Record a payment: date, amount, direction, and note. Before save, show which items it will close, oldest first. The split is not editable.   - List past settlements for that entity. Add Settle to the nav.4. `ReviewView`: a Settlement action on any row opens the Settle form with the date and amount filled. The direction comes from the sign: positive means they paid you. On save, the settlement gets `bankRowIds: [row.id]` and the row gets `settlementId`.5. `BalancesView` uses the new balance.
## Tests
One test in `tests/ledger.test.ts`: House owes $100, then $20 on a later spend. A $110 payment from House leaves one open item, $10 on the later spend, and a balance of $10.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 08.


