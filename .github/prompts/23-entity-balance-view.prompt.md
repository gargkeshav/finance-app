
---mode: agentdescription: Batch 23. A balance opens the entries and settlements behind it, and Activity gets a settled/open filter. About 30K tokens.---
Build batch 23 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/domain/query.ts`, `src/ui/views/BalancesView.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/LocalApp.tsx`.
Create: `src/ui/views/EntityView.tsx`.

## Build
1. `ledger.ts`: `openEntryIds(ledger): Set<string>` holds the ids of `source: "entry"` items with `openAmountCents > 0` from `openItems`, across every entity other than self.
2. `query.ts`: `EntryFilter.settled?: boolean`. Only entries with a nonzero `debtsOf` amount take part; others are excluded whenever the filter is set. `false` keeps ids in `openEntryIds`, and `true` keeps the rest.
3. `EntityView.tsx`, props `{ ledger, entityId, openActivity, onSettle, onBack }`:
   - The entity's name and its balance, in `BalancesView`'s wording.
   - One table, oldest first: the opening balance, each entry in this entity's `debtsOf` (with "Open" or "Settled" from `openEntryIds`), and each settlement, with a running balance column.
   - An entry row's description is a `transaction-link` calling `openActivity({ entryIds: [id] })`.
   - "Settle up" calls `onSettle`. "Back" calls `onBack`.
4. `BalancesView.tsx`: optional prop `onOpenEntity(entityId)`. When it is set, the balance cell becomes a `drilldown-button` with the same text.
5. `ActivityView.tsx`: in "More filters", add a Settled select (Any / Open / Settled) beside Counts, wired like the other filters and counted in `activeFilterCount`.
6. `LocalApp.tsx`: `openEntityId` state. While it is set, the Balances view renders `EntityView`. `onSettle` clears `settlementRow` and navigates to Settle (no new `SettleView` props). `onBack` clears it. `navigate()` clears it when leaving Balances.

## Tests
In `tests/ledger.test.ts`: entity A has a $40 debt fully settled, and entity B has a $20 open debt. `settled: true` returns A's entry only, and `settled: false` returns B's only.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 24.
