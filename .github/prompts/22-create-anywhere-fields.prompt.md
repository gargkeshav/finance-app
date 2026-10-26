
---mode: agentdescription: Batch 22. A combobox that can create a category or person on the spot, used where only closed pickers exist. About 35K tokens.---
Build batch 22 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/ui/views/SpendForm.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/ReviewView.tsx`.
Create: `src/ui/combo.ts`, `src/ui/views/ComboField.tsx`, `tests/combo.test.ts`.
Tags are already free text. Leave them alone.

## Build
1. `combo.ts`, pure: `resolveComboText(text, options: { id; name }[])` returns `{ kind: "none" }` for blank text, `{ kind: "existing", id }` for an exact case-insensitive name match, and otherwise `{ kind: "new", name }` with the text trimmed.
2. `ComboField.tsx`, props `{ label, value, options, nonePlaceholder, onChange(id), onCreate?(name): string }`. A labelled text input with a `<datalist>`. On blur or Enter it resolves the text: existing calls `onChange`; new calls `onCreate`, then `onChange` (without `onCreate` it reverts the text); none calls `onChange("")`. No new CSS.
3. `SpendForm.tsx`:
   - The category select and the separate "Add category" input become one `ComboField`, created through the existing `onAddCategory`.
   - New optional prop `onAddEntity(entity)`. The payer, the preset "Entity", and each portion's "For" select become `ComboField`s over non-archived entities. Creating one makes `{ kind: "person", archived: false }`.
   - "Equal split entities" stays a multi-select.
4. `ActivityView.tsx`:
   - Add `addEntity` and pass `onAddEntity` to both `SpendForm`s (the new-spend form and the edit form in the details row).
   - Use `ComboField` for the per-row inline category select (save through `updateEntryInline`), the bulk "Set category", and the Category filter in "More filters".
   - Entity and Paid-by filters stay selects.
5. `ReviewView.tsx`: the bulk Category becomes a `ComboField`, and its `SpendForm`s get `onAddEntity`.

## Tests
Cover the three results of `resolveComboText`: an exact match ignoring case, trimmed new text, and blank text.

## Done when
`npm test` and `npm run typecheck` pass. In the browser, create a person from a spend's "For" field and a category from an Activity row, without leaving the page. Update `PROGRESS.md`. Next is 23.
