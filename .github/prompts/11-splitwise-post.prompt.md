---mode: agentdescription: Batch 11. Post your linked person and group portions to Splitwise, once each. About 40K tokens.---
Build batch 11 only.
Read: `src/adapters/splitwise.ts`, `src/adapters/file-ledger.ts`, `src/domain/ledger.ts`, `src/ui/views/ActivityView.tsx`.
## API
All in this prompt. Do not fetch the docs.
- `POST /create_expense`, form encoded: `cost`, `description`, `date`, `currency_code=AUD`, `group_id` (0 for a friend), then `users__N__user_id`, `users__N__paid_share`, and `users__N__owed_share` for each person, N from 0.- Shares are strings with two decimals and sum to `cost`. The response is `{ expenses: [{ id }], errors }`. A non-empty `errors` is a failure.
## Build
1. `buildExpense(entry, portion, entity, members, youId)` in `splitwise.ts` is a pure function. At post time, `youId` comes from `getCurrentUser` and a group's `members` from `getGroups`. Posting needs `hasKey()`; otherwise say "Connect Splitwise in People first".   - Only for a spend whose payer is self and that has a portion for a linked entity.   - Person: the cost is that portion. You paid it all and owe 0. The friend owes it all.   - Group: the cost is your self portion plus the group portion. You paid it all and owe your self portion. The other members split the group portion equally, with leftover cents to the first member.   - Self and House portions are never posted.2. Posting.   - Write a `posting` post before the call, and save the file if one is open.   - On success, write `posted` with the id. On a failure with no response, write `unknown`.   - An `unknown` post is never retried automatically. Show "Check Splitwise before retrying", with "Mark posted" (enter the id) and "Clear".   - Never post an entry and entity pair again while it is `posting` or `posted`.3. `ActivityView`: a spend with a linked portion shows "Post to Splitwise", or its state. Group posts show the member shares first, and they can be edited.
## Tests
Create `tests/splitwise.test.ts` with one test, no network: a $90 group post with $30 your share and three other members gives a cost of $90 and owed shares of $30, $20, $20, and $20.
## Done when
`npm test` and `npm run typecheck` pass. With your key, post one small expense to one friend, then delete it in Splitwise. Update `PROGRESS.md`. The planned batches are complete.


