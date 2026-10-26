
---mode: agentdescription: Batch 31. Card payments check. Compare card charges with card payments over time, and confirm each payment left an account. About 25K tokens.---
Build batch 31 only. Run after 30.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/domain/transfers.ts`, `src/domain/health.ts`, `src/ui/views/AccountsView.tsx`.

## Why
Card payments are evidence, not spending. Charges minus payments gives an estimate of what is owed on the card. A sudden jump or a steady drift in that estimate points to missing or doubled history rows near that date. Once savings CSVs are imported, each payment should also show up as money leaving an account.

## Build
1. `transfers.ts`, pure: `cardPaymentCheck(ledger, accountId)` returns `{ rows: { payment: Entry; chargesSinceCents; owedAfterCents; fundedFrom: string | null }[]; owedNowCents }`.
   - Payments are transfer entries with `accountId === accountId`, or entries with a positive bank row on that account, oldest first.
   - Charges are spends minus refunds on that account. Each counts its linked bank amount when it has one, else `chargedCents ?? amountCents`.
   - `chargesSinceCents` covers dates after the previous payment, up to and including this payment's date. `owedAfterCents` is all charges minus all payments to that date. `owedNowCents` is that figure at the latest entry.
   - `fundedFrom` is the name of the asset account behind a linked negative bank row, or `null`.
2. `AccountsView.tsx`: each credit account row gets a `<details>` "Payments check". It shows the estimated amount owed now, then a table of date, payment, charges since the previous payment, estimated owed after, and paid from ("Not seen yet" when `null`). Charges open Activity for that account and date range. Payments open Activity with `{ accountId, kind: "transfer" }`. Add a one-line hint: "A sudden jump means a row may be missing or doubled near that date."
3. `health.ts`: add "Card payments not seen leaving an account". It flags a card-payment transfer with `fundedFrom` `null` whose date falls inside the coverage of an asset account with the same payer. It opens Activity for those payments.

## Tests
In `tests/transfers.test.ts`: charges of $100 and $50, a $150 payment, a $20 charge, then a $10 payment give `owedAfterCents` of 0 and then 10, and `owedNowCents` of 10.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 32.
