
---mode: agentdescription: Batch 16. Reports with Personal and Household scope, trends, categories, merchants, drill-down, and CSV export. About 50K tokens.---
Build batch 16 only.
Read: `.github/prompts/PHASE2.md`, `src/domain/ledger.ts`, `src/domain/query.ts`, `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`, `tests/ledger.test.ts`.Create: `src/domain/reports.ts`, `src/ui/views/ReportsView.tsx`.
## Build
1. `reports.ts`.   - Scope `personal`: self portions plus half of House portions, as now.   - Scope `household`: self portions plus all House portions.   - Refunds count negative in both scopes. Other people's and groups' portions are never included.   - `monthly(ledger, scope, months)`: per month, spending, refunds, and net.   - `byCategory(ledger, scope, from, to)`: category by month, with row and column totals.   - `topMerchants(ledger, scope, from, to, limit)`: grouped by the entry's `displayName`, or else the description in lowercase with digits removed and spaces collapsed.   - `cashFlow(ledger, from, to)`: income, transfers, and settlements in and out, kept separate from spending.2. `ReportsView.tsx`.   - A scope toggle and a date range, defaulting to the last 12 months.   - Four tables: Monthly, Categories, Merchants, Cash flow.   - Each amount is a button that calls `openActivity` with the matching filter.   - A month that overlaps `accountCoverage(ledger, accountId).gaps` for any account shows "Partial data".   - "Download CSV" exports the table on screen.   - Inline bars: you may add one `.report-bar` rule of at most 10 lines to `styles.css`. No chart library.   - Add Reports to the nav.
## Tests
One test: a month with a $100 House spend and a $20 self spend gives $70 personal and $120 household.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 17.

