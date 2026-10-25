
---mode: agentdescription: Batch 12. Check every agreed money case against the built rules, and fix rule bugs only. About 40K tokens.---
Build batch 12 only. No UI changes.
Read: `.github/prompts/PHASE2.md`, `src/domain/ledger.ts`, `src/domain/transfers.ts`, `src/adapters/file-ledger.ts`, `tests/ledger.test.ts`.Create: `tests/money-cases.test.ts`.
## Build
One table-driven test. Each case builds a small ledger and checks the results. Use the existing functions only.
| # | Case | Expect ||---|---|---|| 1 | $150 on your card: $100 House, $50 you | House owes you $100. Personal $100 || 2 | $60 on the House account, all House | No debt. Personal $30 || 3 | $40 on the House account, all you | You owe House $40. Personal $40 || 4 | $50 on your card, all for a friend | Friend owes you $50. Personal $0 || 5 | Friend paid $90 dinner, your share $30 | You owe the friend $30. Personal $30 || 6 | $150 on your card: $100 House, $50 friend. Friend pays you $20 | Friend owes you $30. House owes you $100. Personal $50 || 7 | $15.18 House spend, bank row $5.18, not reimbursable | House owes you $5.18. Personal $7.59 || 8 | $586.32 spend: $419.40 House, rest you | Personal $376.62 || 9 | $0.01 House spend | Personal $0.01 || 10 | House owes $100, then $20. House pays $110 | One open item of $10. Balance $10 || 11 | $100 House portion settled, then a $30 refund to your card | You owe House $30 || 12 | $200 from your account to the House account, confirmed as a contribution | No debt || 13 | House account pays a friend's $30 ticket | Between others: friend owes House $30. Your balances unchanged. Personal $0 || 14 | $80 spend from an import kept out of balances | No debt. Personal includes it |
## Fixes
- If a case fails, fix it in `ledger.ts` or `transfers.ts` only.- If a fix needs any other file, do not change it. List the case in `PROGRESS.md` and tell the user.- Never change an expected value to make a case pass.
## Done when
`npm test` passes. Then reply with a three-column table: case, pass or fixed, file changed. Update `PROGRESS.md`. Next is 13, or `H1` when the user has shared the history CSV header.

