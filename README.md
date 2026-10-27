# Finance app

## What it is

A local, single-user AUD ledger that runs in your browser. One JSON file is the database. The app tracks personal and House spending, shared debts and settlements, imports bank CSVs, and connects to Splitwise.

## Status

Phases 1 to 4 are done. See [the progress log](.github/prompts/PROGRESS.md).

## Setup

Use the Node version in `.nvmrc`:

```sh
nvm install && nvm use
npm ci
npx playwright install chromium
```

Install Chromium once for Playwright.

## Run

Start the app:

```sh
npm run dev
```

Open `http://127.0.0.1:5173` in Chrome or Edge. Saving in place needs one of those browsers; other browsers download a ledger when saving and upload it when opening.

Choose **Save as** to create a new ledger, or **Open** to select an existing one. **Save** writes to the open file. Changes autosave when a file is open. The app also keeps local recovery data and can offer to reopen the last file or recover unsaved work after a restart.

## Real and test ledgers

Keep your real ledger outside the repository, for example in `~/Finance/`. Git ignores `*.finance.json`. Keep test ledgers in a separate folder and use **Open** to switch between them. Never share the real ledger file with an agent or in chat. See [MANUAL.md](.github/prompts/MANUAL.md) for removing the existing file from git.

## Splitwise

Splitwise connects while the app runs with `npm run dev`:

1. Sign in to Splitwise in your browser and open Developer Tools.
2. In **Network**, find a request to `secure.splitwise.com` and choose **Copy as cURL**.
3. In Finance, open **People**, paste the request into the Splitwise field, and choose **Connect**.

The pasted request contains your session credentials. It stays only in the dev server's memory, is not saved in the ledger or browser storage, and is cleared when the dev server restarts. If the session expires, copy a fresh cURL request and choose **Reconnect**. See [MANUAL.md](.github/prompts/MANUAL.md) for trying it against the real site.

## Test

Run the unit tests, typecheck, production build, and Playwright suite:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Run one Playwright spec with `npm run test:e2e -- tests/e2e/home.spec.ts`. Use `npm run test:e2e:ui` for the Playwright UI. The HTML report is in `playwright-report/`; traces and other failure results are in `test-results/`. Open a trace with `npx playwright show-trace test-results/<test-folder>/trace.zip`.

Screens: [tests/e2e/visual.spec.ts](tests/e2e/visual.spec.ts) saves desktop and mobile, light and dark screenshots under `test-results/views/`.

## Project layout

- `src/domain/` contains ledger rules and calculations.
- `src/adapters/` contains file and import integrations.
- `src/ui/` contains the browser app and views.
- `tests/` contains unit and end-to-end tests.
- `.github/prompts/` contains the batch prompts and workflow notes.

## How work is done

Work follows one prompt per session, in the order in `CONTEXT.md`. Handoffs and completed batches are recorded in `PROGRESS.md`.

## Plan

Phase 4 is done: cleanup and Playwright; Splitwise session; UI foundation; shell and Activity; Review, Home, and Reports; Settle through Health; setup views and stylesheet. Later: recurring payments, month close, settle-up helpers, and local receipt photos. Eventually: a phone app with OCR and a backend.

## Privacy

The real ledger and Splitwise credentials never go into git, tests, logs, prompts, or chat.
