# Phase 4 rules: cleanup, end-to-end tests, Splitwise session, UI rebuild
Read this file and `PROGRESS.md` before any batch numbered 35 or higher. For these batches, this file replaces these parts of `copilot-instructions.md`: the retired-files line (batch 35 deletes those files), "No new dependencies", `## UI`, the test rules, and "No markdown files" (batches update `README.md`). Everything else there still applies.

- Start after batch 34 is recorded as done.
- Run order: 35 cleanup and Playwright, 36 Splitwise session, 37 UI foundation, 38 shell and Activity, 39 Review plus Home and Reports, 40 Settle through Health, 41 setup views and the stylesheet.
- Steps only the user can do (git cleanup, repo privacy, live Splitwise trials, the history re-import) live in `MANUAL.md`. Batches never do them, wait on them, or ask for them.
- How the app runs: always under `npm run dev`, in a browser, at `http://127.0.0.1:5173`. There is no desktop app. Splitwise calls go through the dev server (batch 36), so they only work under `npm run dev`.
- Two ledgers: the user's real one, outside git (`*.finance.json` is ignored), and synthetic test ledgers. Agents never open, read, copy, or log the real one, or use it in tests.
- The finance logic in `src/domain` does not change, except where a prompt names a change.

## Testing
- Playwright is the main test. Specs live in `tests/e2e/` and run with `npm run test:e2e` against a dev server the config starts.
- Specs find elements by role, label, and visible text, never by CSS class, so they survive the UI rebuild.
- Test ledgers are built in code by `tests/e2e/fixtures/ledger.ts`, using synthetic names and amounts, with dates relative to today.
- The axe check (serious or critical issues fail) runs in the spec of every view rebuilt from batch 38 on. Views not rebuilt yet are not checked.
- Splitwise in specs is always mocked with `page.route`. Never call real Splitwise.
- Unit tests (`npm test`) are only for pure functions a prompt names. Do not add others, and leave existing ones alone unless a prompt says otherwise.
- Every batch from 35 on must pass `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. A batch that changes a view updates that view's spec in the same batch.

## Docs
- `README.md` is the user's guide to setup, running, testing, the two ledgers, Splitwise, and the plan. Any batch that changes how to install, run, test, or use the app updates `README.md` in the same batch.
- `CONTEXT.md` keeps the run order and the batch table current.

## Stack (from batch 37)
- Allowed new packages:
  - styling: `tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`, `class-variance-authority`, `clsx`, `tailwind-merge`;
  - components: `@base-ui/react`, `sonner`, `cmdk`, `@tanstack/react-table`, `recharts`;
  - fonts: `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`;
  - plus whatever `npx shadcn@latest add` installs for a named component.
  Pin exact versions with `npm i -E`. Anything else, stop and ask.
- shadcn/ui runs on Base UI with the `nova` preset.
  - Components live in `src/components/ui/`, added by the CLI. You own them and may edit them.
  - Never hand-write a component the CLI provides, never mix in Radix, and never use `asChild`. Base UI uses `render`.
- Import with `@/`, which maps to `src/`. `cn` lives in `src/lib/utils.ts`, and tokens live in `src/ui/theme.css`. Icons come from `lucide-react`.

## Styling (from batch 37)
- Use Tailwind utilities and tokens only.
  - Do not read `src/ui/styles.css` or add rules to it.
  - When a batch rebuilds a view, that view stops using the old class names. Batch 41 deletes `styles.css`.
- Colours carry meaning, never raw values:
  - `positive`: owed to you, or income;
  - `negative`: you owe;
  - `warning`: needs attention;
  - `muted`: secondary text.
- Money:
  - On screen, use `formatMoney`, right-aligned, with `tabular-nums`.
  - In CSV exports, use plain decimals.
- Follow the system's light or dark mode.

## Interaction (from batch 37)
- Each page has a header with an `h1` and at most one primary button. Secondary actions go in a dropdown.
- Messages, errors, and Undo are sonner toasts, never banners that push the page down. The only inline notices are the file recovery and reopen prompts, shown as `Alert`.
- Confirm destructive actions with `AlertDialog`, never `window.confirm`.
- Inline edits save on blur or Enter, and Escape restores the saved value. Never save on every keystroke.
- Every user change passes an `update` label, so it reaches History.
  - The Undo toast appears only for labels starting "Delete", "Archive", "Skip", or "Bulk", and for "Record settlement".
- Every input has a visible label, focus is always visible, and everything works by keyboard.
- Motion lasts 200 ms or less, and is off under `prefers-reduced-motion`.
- Layouts work at 390, 768, and 1280 px without sideways scrolling. Below 640 px, tables become stacked rows.
- Charts appear only on Home and Reports, using shadcn `chart`. No landing page.
