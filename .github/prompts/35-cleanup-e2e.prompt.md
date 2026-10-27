---
mode: agent
description: Batch 35. Remove the retired desktop app, rewrite the README, then add Playwright specs for today's app. About 70K tokens.
---
Build batch 35 only.
Read: `.github/prompts/PHASE4.md`, `package.json`, `.gitignore`, `.vscode/tasks.json`, `playwright.config.ts`, `tests/value.test.ts`, `.github/copilot-instructions.md`, `.github/prompts/CONTEXT.md`, `src/ui/LocalApp.tsx`, `src/adapters/file-store.ts`, `src/adapters/file-ledger.ts`.
Do not read `README.md`, `IMPLEMENTATION_PLAN.md`, `VERIFICATION.md`, or `docs/`. They describe the retired app, and the README holds old private file paths. Replace or delete them without copying anything from them.
Do not run git commands. Do not open `ledger1.finance.json`. One-time git steps are in `MANUAL.md`.

Do the cleanup first, then the specs. The specs test behaviour and wording, not layout. They are the safety net for the UI rebuild.

## Cleanup
1. Delete the retired desktop app. `src/main.tsx` renders `LocalApp` only, and nothing under `src/ui/views` imports these:
   - App and data layer: `src-tauri/`, `src/application/`, `src/ui/App.tsx`, `src/ui/ImportDialog.tsx`.
   - Domain and adapters used only by that app: `src/domain/accounting.ts`, `src/domain/import-matching.ts`, `src/domain/transfer-matching.ts`, `src/adapters/banks/`, `src/adapters/synthetic-ledger.ts`, `src/adapters/native-ledger.ts`.
   - Tests: `tests/accounting.test.ts`, `tests/bank-parsers.test.ts`, `tests/import-matching.test.ts`, `tests/transfer-matching.test.ts`, `tests/synthetic-ledger.test.ts`, `tests/native/`, and everything in `tests/e2e/`. This batch writes the new specs below.
   - Docs and old bundles: `docs/`, `IMPLEMENTATION_PLAN.md`, `VERIFICATION.md`, `copilot-prompts.txt`, `copilot-prompts12.txt`, and `copilot-prompts20.txt`. Keep `copilot-prompts35.md` and `split-prompts.sh`.
   - Leave `older-instrcutions-do-not-follow` in place.
2. In `tests/value.test.ts`, remove the import from `src/application/contracts` and the cases that use it. Keep the `value.ts` cases.
3. In `package.json`, remove the `tauri`, `test:integration`, `test:native:smoke`, and `test:native:packaged` scripts, and the `@tauri-apps/api` and `@tauri-apps/cli` packages. Keep `test:e2e`. Run `npm i` so the lockfile matches.
4. In `.vscode/tasks.json`, replace both tasks with one: "Finance: dev server", which runs `nvm use && npm run dev`. In `.gitignore`, add `*.finance.json` and drop the `src-tauri` lines.
5. Write a new `README.md`, in plain language, with these sections:
   - **What it is:** a local, single-user AUD ledger in the browser, with one JSON file as the database. Name its main features.
   - **Status:** phases 1 to 3 are done, and phase 4 is in progress. Point to `.github/prompts/PROGRESS.md`.
   - **Setup:** Node from `.nvmrc` (`nvm install && nvm use`), `npm ci`, and once, `npx playwright install chromium`.
   - **Run:** `npm run dev`, then open `http://127.0.0.1:5173` in Chrome or Edge. Saving in place needs one of those; other browsers download and upload instead. How to start a new ledger, open an existing one, save, and use autosave and recovery.
   - **Real and test ledgers:** keep the real ledger outside the repo, for example in `~/Finance/`. `*.finance.json` is ignored by git. Keep test ledgers in a separate folder and switch with Open. Never share the real file with an agent or in chat. Point to `.github/prompts/MANUAL.md` for taking the existing file out of git.
   - **Splitwise:** one line saying it connects under `npm run dev`. Batch 36 fills in the steps. Point to `MANUAL.md` for trying it against the real site.
   - **Test:** `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. Say where the report and traces go (`playwright-report/`, `test-results/`).
   - **Project layout:** `src/domain`, `src/adapters`, `src/ui`, `tests/`, and `.github/prompts/`.
   - **How work is done:** one prompt per session, in the order in `CONTEXT.md`, with handoffs recorded in `PROGRESS.md`.
   - **Plan:** phase 4 in one line per batch; later, recurring payments, month close, settle-up helpers, and local receipt photos; eventually, a phone app with OCR and a backend.
   - **Privacy:** the real ledger and Splitwise credentials never go into git, tests, logs, prompts, or chat.
6. In `.github/copilot-instructions.md`, remove the retired-files line. Add: "Run `npm test`, `npm run typecheck`, and `npm run test:e2e`. Never run Cargo or Tauri." Add: "Never read a `*.finance.json` file, or create one in the repo, except test ledgers built in code."
7. In `CONTEXT.md`, remove the retired list and the "No new dependencies" note, and point to `README.md` for setup.

## End-to-end tests
1. Rewrite `playwright.config.ts`:
   - `webServer` runs `npm run dev -- --port 5174`. Set `baseURL` to match and `reuseExistingServer: !process.env.CI`. Do not use 5173, the user's own dev server.
   - Use Chromium only, with two projects: `desktop` at 1280×800 and `mobile` at 390×844.
   - Set `trace: "retain-on-failure"` and `screenshot: "only-on-failure"`.
2. `tests/e2e/fixtures/ledger.ts`:
   - `buildLedger(options)` returns a valid ledger object, checked with `ledgerProblem`, with dates relative to today so "this month" always has data.
   - Synthetic names only: Alex, Jo, a trip group, "Everyday", "Joint", "Card".
   - Options can add accounts, people, entries, bank rows waiting in Review, settlements, and a checkpoint difference.
   - `scenario.basic()` gives one account and three entries. `scenario.full()` gives every option, for a populated app.
3. `tests/e2e/fixtures/app.ts`, a Playwright fixture:
   - Before the page loads, replace `window.showOpenFilePicker` and `window.showSaveFilePicker` with a fake file handle kept in memory. The test can read back what was written.
   - `openLedger(ledger)` opens a ledger through the app's Open button. `savedLedger()` returns the last saved JSON, parsed.
   - `checkA11y()` runs `@axe-core/playwright` and fails on serious or critical issues. No spec calls it yet; rebuilt views do, from batch 38.
4. Specs, one per area. Each uses `scenario.full()` unless it says otherwise:
   - `files.spec.ts`: a new ledger saves. An edit autosaves through the fake handle. The status reads "Saved", "Saving…", or "Not saved" at the right times. Reload offers the reopen or recovery prompt.
   - `home.spec.ts`: Owed to you, You owe, and this month's totals match amounts worked out by hand from the fixture.
   - `review.spec.ts`: the "Needs you" and "Waiting" counts are right. Spending a row removes it and adds an Activity entry. Skipping a row works.
   - `activity.spec.ts`: search finds an entry. An inline description edit is saved. Pages switch. A filter survives reload, because it's in the URL.
   - `settle.spec.ts`: recording a settlement changes the balance and shows up in History.
   - `import.spec.ts`: a synthetic CSV built in the test imports into an account, and its rows appear in Review.
   - `history.spec.ts`: reverting the latest change undoes it.
   - `navigation.spec.ts`: every view opens from the sidebar, on desktop and mobile. Nothing scrolls sideways at 390 px.
5. If something is broken today, mark that one check with `test.fixme`, naming the batch that fixes it:
   - the save status that says "Saving…" with no file open: batch 38;
   - the Reports range starting on a year of empty months: batch 39;
   - Health flagging balanced transfers: batch 40.
6. In `package.json`, add `test:e2e:ui`, which runs `playwright test --ui`. In `README.md`, under Test, explain how to run one spec, open the report, and view a trace.

## Done when
`npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` pass, apart from the `test.fixme` checks. No import points at a deleted file. Update `PROGRESS.md`. Next is 36.
