# Finance app
Local AUD page. React 19, TypeScript, Vite, Zod, Papa Parse, Vitest. If `node_modules` is missing, run `npm ci` once.
Batches 35 and above follow `.github/prompts/PHASE4.md`. It replaces the retired-files line, "No new dependencies", the `## UI` section, the test rules, and the no-markdown rule below.
New code: views in `src/ui/views/`, one file each. Rules in `src/domain/ledger.ts` or a sibling named by the prompt. Data in `src/adapters/file-ledger.ts`.
## Money rules
- Money is integer cents. Dates are `YYYY-MM-DD`. No floats, no timezone shifts.- Every account has a payer entity. An entity is self, House, a person, or a group. A group is one entity, not a list of members.- A spend has one payer and portions that sum to its amount. A portion for a different entity is a debt: that entity owes the payer. The same entity is report only.- A House account is always paid by House. A self portion on it means you owe House.- Personal report = self portions + half of House portions, odd cent to self. That half is never a debt.- Transfers, settlements, income, and skipped rows are never spending.- Bank rows never change. Interpretation lives on entries.- One JSON file is the database. Every record has `id` and `updatedAt`. No global revision counter. Keep `schemaVersion: 1`; new keys are optional and default on load.
## Batches
- Work comes from `.github/prompts/NN-*.prompt.md`, one prompt per session. The prompt is the plan. Do not write a plan, redesign, or revisit earlier batches.- First read `.github/prompts/PROGRESS.md`. Then read only the files the prompt lists, files you create, and files a handoff note in `PROGRESS.md` lists.- If the prompt conflicts with the code, or needs a decision it does not give, stop and ask.- Stop and hand off when you need to touch a third file the prompt does not name, or the same failure survives three fixes. Append a handoff note to `PROGRESS.md`: batch, steps done, files changed, next step. Tell the user: "Context is getting long. Start a new session and run NN again."- When the batch is done, append three lines to `PROGRESS.md`: batch, files changed, anything left. Tell the user which prompt to run next, in a new session.
## Work style
- Smallest change that meets the prompt. Stop at its done list.
- Tests: only the ones the prompt names. No UI tests, fixtures, or coverage work. Leave existing test files alone.
- Run `npm test`, `npm run typecheck`, and `npm run test:e2e`. Never run Cargo or Tauri.
- Never read a `*.finance.json` file, or create one in the repo, except test ledgers built in code.
- A pasted Splitwise cURL is a credential. It lives only in dev-server memory. Never write it to the ledger, files, tests, logs, prompts, or chat. Dev-server code lives in `vite/`.

