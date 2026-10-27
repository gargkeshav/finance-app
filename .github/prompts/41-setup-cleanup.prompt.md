---
mode: agent
description: Batch 41. Import, Rules, Data, and History on shadcn, then delete the old stylesheet and check every view. About 70K tokens.
---
Build batch 41 only.
Read: `.github/prompts/PHASE4.md`, `src/ui/views/ImportView.tsx`, `src/ui/views/MappingEditor.tsx`, `src/ui/views/RulesView.tsx`, `src/ui/views/DataView.tsx`, `src/ui/views/HistoryView.tsx`, `src/ui/views/HistoryImportView.tsx`, `src/main.tsx`, `package.json`, `src/ui/LocalApp.tsx`, `.github/copilot-instructions.md`, `.github/prompts/CONTEXT.md`, `tests/e2e/import.spec.ts`, `tests/e2e/history.spec.ts`.

Rebuild the views first. Delete `styles.css` only after they no longer use it. Call `checkA11y()` in each spec you update.

## Setup views
1. Import: a `Card` to drop the file into, then the column mapping as a `Table` with a `Select` per column, then a preview `Table`.
2. Rules: rules are listed in a `Table`. The rule form and its preview open in a `Sheet`. Suggestions are `Card`s with Create and Dismiss. Use the labels "Add rule", "Edit rule", "Delete rule", and "Apply rules".
3. Data: categories, export, and backup each get a `Card`. The history import, which shows only under `npm run dev`, gets a "Dev only" `Badge`.
4. History is a `Table`. Reverting the latest change goes through `AlertDialog`.
5. Replace the `window.confirm` and `window.prompt` calls in `RulesView.tsx`, `HistoryView.tsx`, and `DataView.tsx` with `AlertDialog` or `Dialog`. Batches 38 to 40 cleared the other views.

## Stylesheet and docs
1. Search `src/ui` and `src/components` for class names that neither Tailwind nor shadcn defines, and replace each one with utilities.
2. Delete `src/ui/styles.css` and its import. Remove `@fontsource/dm-sans` and `@fontsource/ibm-plex-mono`.
3. Add `tests/e2e/visual.spec.ts`. It opens every view with `scenario.full()`, on the desktop and mobile projects, in light and dark mode. For each, it checks there's no sideways scrolling and the axe check passes, and saves screenshots to `test-results/views/`. Open the screenshots and fix anything clipped, overlapping, or with focus you can't see.
4. In `.github/copilot-instructions.md`, replace the `## UI` section with one line: "UI rules live in `.github/prompts/PHASE4.md`." Remove the old class list and the `formatAud` rule.
5. Docs, checked against the code as it is now:
   - `README.md`: run every command in Setup, Run, and Test exactly as written, and fix any that are wrong. Add a "Screens" line pointing to the visual spec's screenshots. Mark phase 4 as done in Plan.
   - `CONTEXT.md`: update the layout section, including `src/components/ui`, `src/lib`, `vite/`, and `tests/e2e`.

## Tests
- Update `import.spec.ts` and `history.spec.ts`.
- Add `rules.spec.ts`: create a rule from a suggestion, preview it, and apply it.
- `visual.spec.ts`.

## Done when
All four commands pass, nothing depends on `styles.css`, and searching `src/ui` finds no `window.confirm` or `window.prompt`. Update `PROGRESS.md`. Phase 4 is done. Do not write the Later prompts.

