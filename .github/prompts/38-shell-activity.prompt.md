---
mode: agent
description: Batch 38. shadcn Sidebar, honest save status, toasts, and a command palette, then Activity on TanStack Table. About 80K tokens.
---
Build batch 38 only.
Read: `.github/prompts/PHASE4.md`, `src/ui/LocalApp.tsx`, `src/ui/route.ts`, `src/components/ui/sidebar.tsx`, `src/components/ui/sonner.tsx`, `src/components/ui/command.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/SpendForm.tsx`, `src/ui/views/ComboField.tsx`, `src/ui/combo.ts`, `src/domain/query.ts`, `tests/e2e/navigation.spec.ts`, `tests/e2e/files.spec.ts`, `tests/e2e/activity.spec.ts`.

Do the shell first, then Activity. Call `checkA11y()` in each spec you update.

## Shell
1. Replace the hand-made nav with shadcn `Sidebar`. It collapses to icons on desktop and becomes a sheet below 768 px. Every view is visible, with no "More" group:
   - Daily: Home, Review, Activity, Settle.
   - Money: Accounts, People, Balances, Reports.
   - Setup: Import, Rules, Data, History, Health.
   - Review and Health show count badges.
2. The sidebar footer shows the file name and the save status. Open, Save, and Save as go in a dropdown. The status is honest:
   - "Saving…" only while a save runs, or when there are unsaved changes, a file is open in save-in-place mode, and no autosave has failed.
   - "Not saved · retrying" after a failed autosave.
   - "Not saved" for any other unsaved state.
   - "Saved" otherwise.
3. Views sit in `SidebarInset`, with a header holding `SidebarTrigger`, the view title, and a search button showing a ⌘K `Kbd` hint.
4. Replace the message, warning, error, and Undo banners with sonner toasts.
   - Undo is a toast action that lasts 10 seconds, only for the labels `PHASE4.md` lists.
   - Today every labelled `update` shows Undo, so change `update` to match.
   - The reopen and recovery prompts become an `Alert` above the view.
5. ⌘K or Ctrl+K opens a `CommandDialog`. It can go to every view, and run Add spend, Open file, Save, and Import CSV through their existing handlers.
6. Routing stays hash-based, through `route.ts`.
7. Replace the `window.confirm` in `LocalApp.tsx` with `AlertDialog`.

## Activity
1. Rebuild `ComboField.tsx` on shadcn `Combobox`. Keep its props and the "Create …" option, so every caller keeps working.
2. Build the Activity table with `@tanstack/react-table` and shadcn `Table`:
   - Columns: date, description (display name), category, who, account, and amount.
   - Sort by date or amount, with 50 rows per page.
   - Selecting rows shows the bulk actions in a toolbar that sticks while rows are selected.
3. The toolbar has search, filter chips in a `Popover`, and "More filters". Filters stay in the URL.
4. Inline description and date edits save on blur or Enter, and Escape reverts. Today they save on every keystroke.
5. Clicking a row opens a `Sheet`, from the right on desktop and from the bottom below 640 px. It holds the details, the note, and `SpendForm`.
   - Delete goes through `AlertDialog`.
   - `SpendForm` uses shadcn fields and shows the amended-amount line once, using `formatMoney`. Today it shows twice.
6. Below 640 px, rows become stacked cards.
7. Use the labels "Edit entry", "Edit note", "Save spend", "Delete entry", and "Bulk …". With no matches, show `Empty` with Clear filters.
8. Replace every `window.confirm` and `window.prompt` in `ActivityView.tsx` with `AlertDialog` or `Dialog`. That includes the "Splitwise expense ID" prompt.

## Tests
- Update `navigation.spec.ts` for the new sidebar, including the mobile sheet, and add a ⌘K check.
- In `files.spec.ts`, remove the `fixme` on the save status. An edit shows no Undo toast, and a delete does.
- Update `activity.spec.ts`: typing in a description adds no History entry until blur. The sheet opens and saves. Delete asks first. An amended spend shows the amount line once.

## Done when
All four commands pass. Update `PROGRESS.md`. Next is 39.
