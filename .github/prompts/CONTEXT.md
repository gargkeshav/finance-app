# Finance app: combined context
A single place to get oriented. The rules themselves live in `.github/copilot-instructions.md`, `PHASE2.md`, `PHASE3.md`, and each `NN-*.prompt.md`. If this file and one of those disagree, those files win.

## What it is
A local, single-user AUD finance ledger that runs in the browser. It tracks personal and House spending, who owes whom, settlements, and imports from bank CSVs and Splitwise. One JSON file (`*.finance.json`) is the database. The goal is that reconciliation happens on its own, and only the things that need a decision, like a missing category or split, reach the user.

- Stack: React 19, TypeScript, Vite, Zod, Papa Parse, Vitest.
- Entry point: `src/main.tsx` renders `LocalApp`.
- Setup and usage: see `README.md`.

## Money model
- Money is integer cents. Dates are `YYYY-MM-DD`, with no floats and no timezone shifts.
- Entities are self, House, people, and groups. Every account has a payer entity.
- A spend has one payer and portions that sum to its amount. A portion for another entity is a debt to the payer. In phase 3, only `"claim"` portions are debts.
- Personal report = self portions + half of House portions, with the odd cent to self. Phase 3 makes House's half a group default.
- Transfers, settlements, income, and skipped rows are never spending. Bank rows never change; interpretation lives on entries.
- Every record has an `id` and `updatedAt`. Keep `schemaVersion: 1`; new keys are optional and default on load.

## How things are described
Each fact has one home.

| Question | Field | Examples |
|---|---|---|
| What was bought? | Category, two levels, with a nature | Home › Groceries, Eating out › Coffee, Travel › Accommodation |
| Where? | Display name | the clean merchant name |
| Who was it for? | Portions and entities | you, House, a friend, a trip group |
| What kind of group? | Group type | household, trip, friends, project, other |
| Is it claimed? | Portion treatment | claim, write-off, gift, report only |
| Why, or which occasion? | Tags | `work`, `one-off`, `birthday`, a place |
| Anything else? | Note | free text, optional, on every entry |
| How was it paid? | Account | card, savings; a card payment is a transfer |

The starter categories (batch 27) are Home, Eating out, Transport, Health and fitness, Shopping, Travel, Entertainment, Gifts and giving, Fees and interest, and Work, each with children. System tags are `history`, `card-payment`, `needs-share`, and `gift-card`.

The `Share` association values in the history CSV map to the model like this:

| `Share` value | Becomes |
|---|---|
| `personal` | Self |
| `house` | House, or `Our share` to House and the rest to you |
| `friend` | A person |
| `group` | A friends group |
| `trip` | A trip group |
| `refund` | A refund |
| `payment` | A card-payment transfer |
| blank | A self spend tagged `needs-share` |

## Code map
- `src/domain/`: `ledger.ts` (types, `splitPreset`, `debtsOf`, `report`, `balances`, `openItems`, coverage), `query.ts` (`filterEntries`), `rules.ts`, `transfers.ts` (pairing, `cardCycle`), `reports.ts`, `health.ts`, `history-import.ts`, `value.ts`.
- `src/adapters/`: `file-ledger.ts` (Zod schema, `parseLedger`, `stringifyLedger`, `ledgerProblem`), `file-store.ts` (File System Access, backups), `csv-mapping.ts`, `splitwise.ts`.
- `src/ui/LocalApp.tsx` is the shell: it holds the view switch and `update()` with its 10-second undo. Views live in `src/ui/views/`, and `SpendForm.tsx` is shared.
- UI uplift (commit `97f3a4a`): the file controls moved into the sidebar `ledger-controls`. Activity now has a toolbar, "More filters", inline row edits, a details row, and 50-row pages. Accounts, People, and Balances link into Activity. `more-menu` has no CSS.

## Workflow
- Run one prompt per session. Read `PROGRESS.md` first, then only the files the prompt lists.
- Stop and ask when a prompt conflicts with the code. Hand off when a third unnamed file is needed or the same failure survives three fixes.
- Only the tests a prompt names. Run `npm test` and `npm run typecheck`, never Cargo or Tauri. From batch 35, Playwright (`npm run test:e2e`) is the main test; see `PHASE4.md`.
- Finish by appending batch, files changed, and anything left to `PROGRESS.md`.

## State and run order
Phase 1 (01–11e) and phase 2 (12–19, plus H1) are done. Phase 3 runs in this order: 20 through 34. Phase 4 runs 35 through 41 under `PHASE4.md`: cleanup and Playwright, the Splitwise session, then the UI rebuild on shadcn/ui. The app runs under `npm run dev` in the browser. There is no desktop app.

| Batch | Adds |
|---|---|
| 20 | Reopen the last file, recovery copy, autosave |
| 21 | Change log, History view, revert of the latest change |
| 22 | Combobox that creates a category or person in place |
| 23 | Entity balance view; settled/open filter |
| 24 | Home view, smaller sidebar, URL-hash routes |
| 25 | Group types, members, default split; House half as the fallback |
| 26 | Portion treatments: claim, write-off, gift, report only |
| 27 | Nested categories, nature, starter categories |
| 28 | Optional note on every entry |
| 29 | History import v2: mapping step, payments, notes, blank-share rows, replace |
| 30 | Review groups: already recorded, waiting, needs you; links history spends and card payments to bank rows |
| 31 | Card payments check: charges against payments, where each payment came from |
| 32 | Remembered merchant display names |
| 33 | Rules over existing entries, with a selectable preview |
| 34 | Rule suggestions from repeated manual edits |
| 35 | Remove the retired desktop app, rewrite README, Playwright specs |
| 36 | Splitwise via a pasted cURL replayed by the dev server |
| 37 | UI foundation: Tailwind v4, shadcn/ui on Base UI, tokens, fonts |
| 38 | Shell and Activity: Sidebar, toasts, ⌘K, TanStack Table |
| 39 | Review queue; Home cards and chart; Reports range and charts |
| 40 | Overpayment credit; Settle through Health |
| 41 | Import, Rules, Data, History; delete the old stylesheet |

Later, not yet written as prompts: recurring payments, month close, settle-up helpers, receipt photos stored locally. The command palette is batch 38. The ledger stays out of git; see `MANUAL.md`. Do not write these until asked.

## The historic import (`ledger1.finance.json`)
It holds 807 history entries on one credit account, 19 entities besides self and House, 26 categories, and no bank rows, settlements, or rules. Its date range is 2023 to 2026.
- Trips, households, and friend circles are all plain groups. Places and merchants became categories, and some names are both a group and a category.
- 117 friend, group, or trip spends give the whole amount to the other party. That is correct, because the other party owed it all. 22 of them are still open.
- 353 entries are uncategorised. About a third match generic keywords (transport, food, shopping, fees), so rules (33, 34) will clear most of them.
- Payment rows and blank-`Share` rows were never imported.
- The first import is replaced, not repaired: batch 29 re-imports the CSV with a mapping step and "Replace" on.

The user's re-import steps are in `MANUAL.md`.

## Answers for batch 29
1. A blank `Our share` on a shared row means they owed the full amount.
2. `Tags` and `Notes` columns may be added. `My share` is not planned.
3. `Card` means a gift card, and the subtype may name the brand. It maps to Gifts and giving › Gift cards, with the brand as the merchant name.
4. All card payments came from your own savings.

## Recommended tags
Keep tags few, lowercase, and about why something was bought. Category, merchant, and people already cover what, where, and who.

| Tag | Use it for |
|---|---|
| `work` | Something your employer should reimburse |
| `tax` | Possibly tax-deductible |
| `one-off` | A large or unusual purchase to leave out of a normal month |
| `subscription` | Recurring charges (this feeds the later recurring-payments work) |
| `birthday`, `christmas` | Gift and celebration spending |
| `trip:<name>` | Solo travel; shared trips use a trip group instead |
| `project:<name>` | A home or personal project, for example `project:garden` |

## Privacy
`ledger1.finance.json` holds real names and transactions. It was committed in `05c7516` on `origin/main`; the user takes it out of git and makes the repo private (`MANUAL.md`), and batch 35 ignores `*.finance.json`. Never open it or copy its contents into code, tests, prompts, logs, or chat.

