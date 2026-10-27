---
mode: agent
description: Batch 40. Overpayments become a credit, then Settle, Balances, People, entity pages, Accounts, and Health on shadcn. About 70K tokens.
---
Build batch 40 only.
Read: `.github/prompts/PHASE4.md`, `src/domain/ledger.ts`, `src/domain/health.ts`, `src/ui/views/SettleView.tsx`, `src/ui/views/BalancesView.tsx`, `src/ui/views/PeopleView.tsx`, `src/ui/views/EntityView.tsx`, `src/ui/views/AccountsView.tsx`, `src/ui/views/HealthView.tsx`, `tests/e2e/settle.spec.ts`.

Today, when someone pays more than they owe, Settle shows nothing open, while Balances says you owe them. Health flags balanced transfers as amended amounts without a note.

Do the settlement credit and those four views first, then Accounts and Health. Call `checkA11y()` in each spec you update.

## Settle, Balances, People
1. `openItems` in `ledger.ts`:
   - Leftover settlement money becomes a `source: "credit"` item on the opposite list. Give it the settlement's id and date and the description "Credit from <date> payment".
   - Credits are settled oldest first, like other items. `balances()` does not change.
2. Settle:
   - "Who" is a `Combobox` of active entities, plus archived ones with a balance that isn't zero.
   - Credit items show a "Credit" `Badge`.
   - Use the labels "Record settlement" and "Delete settlement".
   - Replace the `window.confirm` and the "Splitwise payment ID" `window.prompt` in `SettleView.tsx` with `AlertDialog` or `Dialog`.
3. Balances: one `Card` per entity, coloured by direction and linked to its page.
4. Entity page:
   - The timeline is a `Table`. A settlement with leftover money reads "includes <amount> credit".
   - Archive and Restore go through `AlertDialog`, with the labels "Archive" and "Restore".
5. People:
   - People and groups are listed in a `Table`, with add and edit in a `Dialog`. Use the labels "Add person" and "Edit person".
   - Keep batch 36's Splitwise connect card, rebuilt with shadcn fields.

## Accounts and Health
1. In `health.ts`, "Amended amounts without a note" checks only `spend` and `refund` entries.
2. Accounts:
   - Accounts are listed in a `Table`, with add and rename in a `Dialog`. Use the labels "Add account", "Rename account", and "Add checkpoint".
   - "Paid by" offers You, House, and people, but not groups.
3. The card payments check is one `Card` per card:
   - A negative amount owed reads "In credit <amount>", and a positive one reads "Owed <amount>".
   - When the first payment is bigger than the charges before it, hint "Add a balance checkpoint at the start of this card's history."
   - Two payments on the same date with the same amount get a "Possible duplicate" `Badge`.
4. Health: issues are grouped into collapsible `Card`s, each with a count `Badge` and a link to the rows behind it. With no issues, show `Empty` with "All clear".

## Tests
- Update `settle.spec.ts`: an overpayment shows a Credit item, and settling it clears the balance. An archived person with no balance isn't in "Who". Archive asks first.
- Add `tests/e2e/accounts-health.spec.ts`: a transfer linked to two bank rows raises no amended-amount issue, and remove the `fixme` from batch 35. A card paid ahead shows "In credit". A same-day duplicate payment is marked. "Paid by" lists no groups.

## Done when
All four commands pass. Update `PROGRESS.md`. Next is 41.
