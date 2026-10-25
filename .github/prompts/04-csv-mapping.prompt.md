---mode: agentdescription: Batch 04. CSV mappings, three bank presets, and bank row storage. No UI. About 40K tokens.---
Build batch 04 only. No UI.
Read: `src/adapters/banks/parse-bank.ts`, `src/domain/value.ts`, `src/adapters/file-ledger.ts`.Create: `src/adapters/csv-mapping.ts`, `tests/csv-mapping.test.ts`.
`parse-bank.ts` already parses ING, HSBC, and ANZ with hard-coded branches. Copy its date, amount, Papa Parse, size, and description rules. Do not import from it or from `src/application/`. Leave it and its test unchanged.
## Build
1. `csv-mapping.ts`.   - A column is `{ header: string }` or `{ index: number }` (zero-based). Header match ignores case and non-letters, as `parse-bank.ts` does.   - Mapping: `id`, `name`, `dateFormat` (`D/M/YYYY` or `D Mon YYYY`), `hasHeader`, `amount`, `descriptionColumns: column[]` joined with `" | "`, `balanceColumn` (or null), `updatedAt`.   - `amount` is `{ signed: column, negate: boolean }` or `{ debit: column, credit: column }`. A debit is always stored negative, whatever its sign in the file. Empty is not zero.   - Presets with the same results as `parse-bank.ts`: ING, HSBC, and ANZ. ANZ covers both the credit card and the transaction account.   - `parseWithMapping(text, mapping)` returns rows (`line`, `date`, `description`, `amountCents`, `balanceCents` or null, `raw: string[]`) and row errors. Never skip a row silently.   - `suggestPresets(text)` returns preset names that fit the first row.   - `findNewRows(existing, parsed)` returns the parsed rows not already on the account. Rows match on date, amount, and description, counting repeats. If the account has two identical rows and the file has three, one is new.2. `file-ledger.ts`, all optional.   - `mappings`.   - `imports`: `id`, `accountId`, `mappingId`, `fileName`, `contentHash`, `dateFrom`, `dateTo`, `countsTowardDebt`, `importedAt`, `updatedAt`.   - `bankRows`: `id`, `accountId`, `importId`, `line`, `date`, `description`, `amountCents`, `balanceCents`, `raw`, `entryId` (null), `settlementId` (null), `skipped` (false), `dismissedTransferIds` ([]), `updatedAt`.   - An account gets optional `mappingId`. An entry gets optional `bankRowIds` (default []). No file bytes are stored.
## Tests
`tests/csv-mapping.test.ts`, two tests, synthetic data only:
- The HSBC preset reads a quoted `"1,234.56"` and a date with a leading space.- `findNewRows` with two existing identical rows and three in the file returns one.
## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 05.


