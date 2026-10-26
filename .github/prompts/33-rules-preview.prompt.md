
---mode: agentdescription: Batch 33. Rules can run over existing entries, and every run previews selectable changes before saving. About 40K tokens.---
Build batch 33 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/domain/rules.ts`, `src/adapters/file-ledger.ts`, `src/ui/views/RulesView.tsx`, `src/ui/views/ReviewView.tsx`.

## Build
1. `rules.ts`:
   - `match` gains optional `descriptionRegex` (case-insensitive; when set it replaces `text` and `mode`) and `weekday: number[]` (0 is Sunday, from the UTC day of `date`).
   - The rule gains `scope: "newRows" | "existingEntries" | "both"` (default `"newRows"`) and `protectManualEdits` (default `true`).
   - Extract `matchesCore(match, { description, amountCents, date, accountId })`. `matchesRule` wraps it for bank rows.
   - `matchesEntryForRule(rule, entry, account)` wraps it for entries, requires `enabled`, and with `protectManualEdits` skips entries whose `source` is `undefined` or `"manual"`.
   - `previewRuleChanges(rule, ledger)` returns `{ bankRows: { row, after }[], entries: { entry, before, after }[] }`, where each summary is `{ categoryId, displayName, tags, split }`. Pending rows count for `newRows` and `both`. Matching entries count for `existingEntries` and `both`.
2. `file-ledger.ts`: schema the four new fields with their defaults.
3. `RulesView.tsx`:
   - The edit form gains the regex field (checked with `new RegExp` before Preview or Save), seven weekday checkboxes, Scope, and Protect manual edits.
   - Preview replaces the "first 10" list with a table: one checked checkbox per item, and before → after for category, display name, tags, and split.
   - "Apply selected" turns checked rows into spends built like Review's auto-rule spends (`source: "rule"`, `ruleId`). Checked entries get the category, display name, and tags; when the rule has a split, they also get `splitPreset` portions recomputed on the entry's amount and payer. Everything goes in one `update(..., "Apply rule <name>", "rule")`.
   - "Apply all" checks everything first. "Discard" saves nothing.

## Tests
In `tests/ledger.test.ts`:
- An `existingEntries` rule with protection includes a `source: "bank"` entry and excludes one with no source.
- `descriptionRegex: "^WOOL"` matches `"WOOLWORTHS 123"`.

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 34.
