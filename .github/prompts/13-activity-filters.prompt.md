
---mode: agentdescription: Batch 13. Search, filters, sorting, filtered totals, and bulk edit in Activity. About 45K tokens.---
Build batch 13 only.
Read: `.github/prompts/PHASE2.md`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/ActivityView.tsx`, `tests/ledger.test.ts`.Create: `src/domain/query.ts`.
## Build
1. `query.ts`.   - `EntryFilter`, all fields optional: `text`, `from`, `to`, `accountId`, `categoryId`, `entityId` (payer or any portion), `payerEntityId`, `kind`, `tag`, `counted` (true or false), `source` (`bank | manual | splitwise`, using the origin rule in `PHASE2.md`).   - `accountId` matches the entry's `accountId`, or the account of any of its bank rows.   - `text` matches the description, note, and tags, ignoring case.   - `filterEntries(ledger, filter)` returns entries newest first.   - `filteredTotals(entries)` returns the count, total cents, and personal and House cents using the report rule. Refunds count negative.2. `LocalApp.tsx`: keep `activityFilter` in state. Export `openActivity(filter)` through props so later views can jump to a filtered Activity.3. `ActivityView.tsx`.   - Replace the existing "Not counted toward balances" filter with the new `filters` bar: all fields, a Clear button, and a count of active filters.   - Sort by date or amount, either direction.   - A `summary-strip` for the filtered rows: count, total, Personal, House.   - Reuse the existing row checkboxes and Include/Exclude selected actions. Add a select-all for the filtered rows.   - Add bulk set category, add tag, and remove tag beside them. Show the count, and confirm before applying.   - Bulk edits change only those fields and set `updatedAt`.
## Tests
One test in `tests/ledger.test.ts`: filtering by an entity and a date range returns only entries with that entity as payer or in a portion, inside the range.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 14.

