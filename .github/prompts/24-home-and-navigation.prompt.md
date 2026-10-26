
---mode: agentdescription: Batch 24. A Home view for finances at a glance, a smaller sidebar, and Activity filters in the URL. About 40K tokens.---
Build batch 24 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/domain/query.ts`, `src/domain/health.ts`, `src/ui/LocalApp.tsx`, `src/ui/views/ActivityView.tsx`.
Create: `src/ui/views/HomeView.tsx`, `src/ui/route.ts`, `tests/route.test.ts`.

## Build
1. `query.ts`: `EntryFilter.uncategorized?: boolean`. When true, keep entries with no `categoryId`; it is ignored when `categoryId` is set.
2. `health.ts`: a new issue, "Uncategorised spending", counting spends and refunds with no category, with `view: "Activity"`.
3. `ActivityView.tsx`: the Category filter gains an "Uncategorised" option that sets `uncategorized: true` and clears `categoryId`. Any other option clears `uncategorized`.
4. `route.ts`, pure:
   - `encodeRoute({ view, filter? })` gives `#/<view>`, plus `?f=<encodeURIComponent(JSON.stringify(filter))>` when the filter has keys.
   - `decodeRoute(hash, knownViews)` falls back to `{ view: "Home" }` on any failure or an unknown view.
5. `HomeView.tsx`, props `{ ledger, healthIssues, reviewCount, openActivity, onOpenEntity, onNavigate }`. All sections use existing functions:
   - Net position: owed to you and you owe (from `balances`), and each nonzero entity as a `drilldown-button` calling `onOpenEntity`.
   - This month: personal and House spend from `report` for the current and previous month.
   - To do: each health issue and "Waiting in review", each a button calling `onNavigate(view)`.
   - Recently handled: history from the last 7 days with `actor !== "you"`, linking to History. Hide it when there is none.
   - Accounts: the last covered date and any gap count from `accountCoverage`, linking to Import.
   - With no accounts, show Activity's first-run steps instead.
6. `LocalApp.tsx`:
   - Add `"Home"`, and make it the initial view. `acceptOpenedLedger` goes to Home when no rows are waiting.
   - `onOpenEntity` navigates to Balances and sets `openEntityId` (batch 23).
   - Nav groups: Daily is `Home, Review, Activity, Settle, Reports`. More is `Balances, Import, Health`, inside a `<details>` whose `<summary>` uses `nav-group`, and stays open while the active view is in it. Setup is `Accounts, People, Rules, Data, History`. Keep `ledger-controls` below the nav.
   - On mount and on `hashchange`, apply `decodeRoute` to the view and, for Activity, its filter. `navigate` and `openActivity` write `encodeRoute`, skipping the write when the hash would not change.

## Tests
`{ view: "Activity", filter: { entityId: "e1" } }` round-trips through `encodeRoute` and `decodeRoute`. `""` and `"#/Nope"` decode to Home.

## Done when
`npm test` and `npm run typecheck` pass. Home shows on load, and reloading a filtered Activity keeps the filter. Update `PROGRESS.md`. Next is 25.
