---
mode: agent
description: Batch 39. Review as a keyboard queue that says why rows are waiting, then Home cards and a chart, and Reports with one money format. About 70K tokens.
---
Build batch 39 only.
Read: `.github/prompts/PHASE4.md`, `src/ui/views/ReviewView.tsx`, `src/domain/transfers.ts`, `src/ui/views/HomeView.tsx`, `src/ui/views/ReportsView.tsx`, `src/domain/reports.ts`, `src/components/ui/chart.tsx`, `tests/e2e/review.spec.ts`, `tests/e2e/home.spec.ts`.

Do Review first, then Home and Reports. Call `checkA11y()` in each spec you update.

## Review
1. In `transfers.ts`, add pure `waitingReason(ledger, row)`. It returns "Waiting for another account's import to reach <date>", using the row date plus 3 days, or `null` when the row isn't waiting.
2. `Tabs` with counts: "Needs you", "Waiting", and "Already recorded".
3. Each row is a compact card: the date, description, and amount; the suggestion or match as a `Badge`; buttons for Spend, Income, Transfer, and Skip. Waiting rows also show `waitingReason`.
4. Keep the batch 14 shortcuts (j/k, s, i, t, x, e, r). Add: Enter opens the spend form, focus moves to the next row after an action, and the keys show as `Kbd` hints.
5. Use the labels "Spend row", "Income row", "Transfer row", "Skip row", and "Bulk …".
6. Keep the "From Splitwise" section, rebuilt with the same cards.
7. Replace every `window.confirm` and `window.prompt` in `ReviewView.tsx` with `AlertDialog` or `Dialog`.

## Home and Reports
1. Home:
   - Four `Card`s: Owed to you, You owe, this month's personal spending, and this month's House spending.
   - "To do" is a list with one row per item: its kind, count, detail, and a link to the view.
   - A bar chart of the last 6 months, personal against House.
   - Each entity's balance, linked to its page.
   - The personal label reads "Personal (incl. ½ House)".
2. Reports:
   - Money uses `formatMoney`. CSV stays as plain decimals.
   - The range starts at the first month with a spend, refund, or income entry, and never more than 11 months back. With no entries, it starts this month.
   - Months with zero spending, refunds, and net are hidden. A "Show empty months" `Switch` brings them back.
   - Tables sit in `Tabs`, with a bar chart above Monthly and a horizontal bar chart above Categories.
   - "Partial data" becomes a `Badge` with a `Tooltip`.

## Tests
- Update `review.spec.ts`: a waiting row shows its reason and date. s, then j, then x does the right thing, by keyboard only. Skip offers Undo.
- Update `home.spec.ts`, keeping its hand-worked totals.
- Add `reports.spec.ts`: it starts at the fixture's first month, and remove the `fixme` from batch 35. Amounts show `$`. The switch shows empty months. The CSV download has plain decimals.

## Done when
All four commands pass. Update `PROGRESS.md`. Next is 40.
