
---mode: agentdescription: Batch 27. Nested categories with a nature, a starter category set, and a by-nature report. About 30K tokens.---
Build batch 27 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/domain/reports.ts`, `src/ui/views/ReportsView.tsx`, `src/ui/views/BalancesView.tsx`.
Create: `src/domain/taxonomy.ts`.

## Build
1. `ledger.ts`: `Category` gains optional `parentId` and `nature` (exported `CategoryNature = essential | discretionary | oneOff | reimbursable | business | savings`). `categoryNature(categories, categoryId)` returns the category's own nature, else the nearest parent's, walking at most `categories.length` steps.
2. `file-ledger.ts`: schema both fields. In `superRefine`, a `parentId` must name another category and must not form a cycle; report the cycle on `["categories"]`.
3. `taxonomy.ts`: `STARTER_CATEGORIES`, a constant list of `{ name, nature, children: string[] }`. Children inherit their parent's nature.

   | Parent | Nature | Children |
   |---|---|---|
   | Home | essential | Groceries, Rent and mortgage, Utilities, Internet and phone, Insurance, Household items, Repairs |
   | Eating out | discretionary | Coffee, Lunch, Restaurants and takeaway, Drinks |
   | Transport | essential | Fuel, Public transport, Rideshare and taxi, Parking and tolls, Car |
   | Health and fitness | essential | Medical and pharmacy, Fitness |
   | Shopping | discretionary | Clothing, Electronics, Outdoor and sport, General |
   | Travel | oneOff | Flights, Accommodation, Activities |
   | Entertainment | discretionary | Subscriptions, Events and outings |
   | Gifts and giving | discretionary | Gifts, Gift cards, Donations |
   | Fees and interest | essential | Card fees, Interest |
   | Work | reimbursable | Work expenses |

   `addStarterCategories(ledger, updatedAt)` adds any missing names (case-insensitive), with parents first. It never renames, moves, or re-natures existing categories.
4. `reports.ts`: export `scopeAmount` unchanged. `byNature(ledger, scope, from, to)` sums `scopeAmount` by `categoryNature(...) ?? "unspecified"`.
5. `ReportsView.tsx`: a "By nature" table (nature and total, largest first). A row opens Activity for its categories when that filter exists, otherwise it is plain text.
6. `BalancesView.tsx`:
   - Each real category row in "By category" gets a `<details>` Edit control with a Parent select (other categories, or None) and a Nature select (the six values, or Unspecified). It saves through `update()`.
   - Above the table, "Add suggested categories" calls `addStarterCategories` in one `update(..., "Add suggested categories")`. Hide it when nothing is missing.

## Tests
In `tests/ledger.test.ts`:
- A child with no nature inherits its parent's `"essential"`.
- An A↔B parent cycle fails `ledgerProblem`.
- `addStarterCategories` on a ledger that already has `"groceries"` adds no second Groceries.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 28.
