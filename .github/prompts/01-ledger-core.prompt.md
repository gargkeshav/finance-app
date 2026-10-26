
---mode: agentdescription: Batch 01. Ledger rules and the JSON file format. No UI. About 30K tokens.---
Build batch 01 only. No UI.
Read: `src/domain/value.ts`.Create: `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `tests/ledger.test.ts`.
## Records
- Entity: `id`, `kind` (`self | house | person | group`), `name`, `archived`, `updatedAt`. A new ledger has one self entity named "You" and one House entity named "House".- Account: `id`, `name`, `type` (`asset | credit`), `payerEntityId`, `updatedAt`.- Entry: `id`, `kind` (`spend | transfer | income | refund`), `date`, `description`, `amountCents` (positive), `payerEntityId`, `accountId` (or null), `portions: { entityId, amountCents }[]`, `countsTowardDebt`, `updatedAt`. Only `spend` is used in this batch.- Baseline: `id`, `entityId`, `amountCents` (signed: positive means they owe you), `updatedAt`. Optional, no date.
## Rules in `ledger.ts`
Pure functions only.
- `validateSpend(entry)`: portions sum to `amountCents`, every amount positive, no duplicate entity.- `debtsOf(entry)`: for each portion whose entity differs from the payer, `{ debtorId: portion.entityId, creditorId: payerEntityId, amountCents }`. Empty when `countsTowardDebt` is false.- `report(entries, from, to)`: spends dated in range. `personalCents` = self portions + half of House portions, odd cent to self. `houseCents` = House portions.- `balances(ledger)`:  - For each entity other than self, one signed number: baseline + what they owe you − what you owe them. Positive means they owe you.  - Separately, net debts between two entities that are not self, such as House and a friend. Return them as pairs.
## File format in `file-ledger.ts`
- `{ schemaVersion: 1, entities, accounts, entries, baselines }`.- `emptyLedger()`, `parseLedger(text)`, and `stringifyLedger(ledger)`.- `parseLedger` validates with Zod. Missing optional arrays default to empty. On failure, throw an error message a user can read.
## Tests
`tests/ledger.test.ts`, two tests only:
- Your card, $150 spend, $100 House and $50 you: House owes you $100. Personal is $100.- House account, $40 spend, all yours: you owe House $40. Personal is $40.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 02.


