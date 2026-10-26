# Phase 3 rules
Read this file and `PROGRESS.md` before any batch numbered 20 or higher.

- Start only after batch 19 is recorded as done in `PROGRESS.md`.
- Run order: 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34.
- The UI uplift (commit `97f3a4a`) is the base. File Open/Save/Save as and the unsaved notice live in the sidebar's `ledger-controls` section; there is no `topbar`. Activity has a toolbar (`activity-toolbar`), a "More filters" panel (`advanced-filters`), inline row edits (`updateEntryInline`), a details row (`activity-detail-row`, `entry-details`), and 50-row pages. Accounts, People, and Balances already take `openActivity`. Reuse its classes: `eyebrow`, `transaction-link`, `drilldown-button`, `text-button`, `danger-link`, `row-actions`, `detail-label`, `detail-line`, `filter-toggle`, `bulk-toolbar`. `more-menu` has no CSS rule. If markup a prompt names differs, stop and report it. Do not overwrite the uplift.
- The retired desktop app in `copilot-instructions.md` stays untouched.
- No new npm dependencies. Use plain DOM, `<datalist>`, `window.location.hash`, and existing domain functions.
- `update(next, undoLabel?, actor?)` gains an optional third parameter in batch 21. Existing calls keep working.
- Extend phase 1 and 2 files. Do not rewrite a view or rename an export. New fields on `Entity`, `Portion`, `Category`, and `EntryRule` are optional and inert on older ledgers.
- `ledger1.finance.json` in the repo root is the user's real ledger. Agents never open it; the user may load it in `npm run dev`. Never read it into code, tests, fixtures, logs, prompts, or chat. Use synthetic names and rows.
- Tests stay few: only the ones the prompt names.
- `.github/copilot-instructions.md` still applies.

## Batches
- 20: reopen the last file, recover unsaved work, autosave.
- 21: change log with a History view and revert of the latest change.
- 22: create a category or entity from the field you pick it in.
- 23: a balance opens the entries and settlements behind it; Activity gets a settled filter.
- 24: Home view, a smaller sidebar, Activity filters in the URL.
- 25: group types and a default split per group.
- 26: portion treatments: claim, write-off, gift, report only.
- 27: nested categories with a nature, and a starter category set.
- 28: an optional note on every entry.
- 29: history import v2, with mapping, payments as card transfers, notes, and a clean replace of the first import.
- 30: Review separates "needs you", "waiting on another account", and "already recorded" (including history spends and card payments).
- 31: card payments check, comparing charges with payments and finding where each payment came from.
- 32: remembered merchant names.
- 33: rule preview before apply, rules over existing entries.
- 34: rule suggestions from repeated manual edits.

## Model rules
Each fact has one home. Do not store the same fact in two of these.
- Category is what was bought. It is two levels deep and carries a nature. Never put a merchant, place, person, or trip in a category.
- Display name is the merchant (batch 32).
- Entities and portions are who it was for. A group's type says whether it is a household, trip, friends, project, or other.
- Treatment says whether a portion is claimed (batch 26).
- Tags say why, or which occasion: `work`, `one-off`, `birthday`, a place. System tags are `history`, `card-payment`, `needs-share`, and `gift-card`.
- Note is extra detail in your own words (batch 28). It is not a category, tag, merchant, or person.
- Account is how it was paid. A card payment is a transfer, never spending.

## Later, not yet prompts
Recurring payments, month close, quick add and a command palette, settle-up helpers, receipt photos stored locally, optional encryption. Ask before writing these.
