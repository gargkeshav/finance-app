---mode: agentdescription: Batch 08. Transfer suggestions, House contributions versus settlements, and card payment checks. About 45K tokens.---
Build batch 08 only.
Read: `src/domain/transfer-matching.ts`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/views/ReviewView.tsx`, `src/ui/views/SettleView.tsx`, `tests/ledger.test.ts`.Create: `src/domain/transfers.ts`.
`transfer-matching.ts` shows the old idea. Copy the logic you need. Do not import it or anything from `src/application/`.
## Build
1. `transfers.ts`.   - `suggestTransfers(ledger)` considers rows still in review.     - Suggest a pair when the rows are on different accounts, have opposite amounts, and are dated within 3 days.     - Neither row may have another candidate in that window.     - A pair dismissed on either row is never suggested again.   - `cardCycle(ledger, paymentRow)`, when the incoming account is a credit account: the sum of that card's rows after the previous payment date, up to this payment, excluding payments. Return the sum and the difference from the payment.2. Confirming a pair:   - Same payer on both accounts: a `transfer` entry with `bankRowIds: [out, in]`, the amount, and no portions. Set `entryId` on both rows.   - Different payers, which means self and House: the user chooses.     - Contribution: same as a transfer, for example topping up the House account. No debt.     - Settlement: a settlement with the House entity. Money from your account to House's is `youPaidThem`. The other way is `theyPaidYou`. Use `bankRowIds: [out, in]`, and set `settlementId` on both rows.   - Any other payer pair: say it is unsupported and leave the rows in review.3. `ReviewView`.   - "Possible transfer" beside a suggested row, naming the other account, with Confirm and Dismiss. Dismiss adds the other row id to `dismissedTransferIds`.   - A Transfer action on an unsuggested row: pick the other row from opposite-sign rows on other accounts.   - For a card payment, show the cycle sum and the difference. Say a difference is interest, a fee, or a missing row.4. `SettleView`: show `bankRowIds` on past settlements as the bank date and description.
## Tests
Two tests in `tests/ledger.test.ts`:
- Two $50 out and in pairs between the same two accounts on the same day give no suggestion.- House owes you $80. A $50 move from the House account into your account, confirmed as a settlement, leaves House owing $30.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 09.


