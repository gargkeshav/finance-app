
---mode: agentdescription: Batch 21. A change log for every labelled update, a History view, and revert of the latest change. About 35K tokens.---
Build batch 21 only.
Read: `.github/prompts/PHASE3.md`, `src/domain/ledger.ts`, `src/adapters/file-ledger.ts`, `src/ui/LocalApp.tsx`.
Create: `src/domain/history.ts`, `src/ui/views/HistoryView.tsx`, `tests/history.test.ts`.

## Build
1. `history.ts`, pure:
   ```ts
   export type ChangeActor = "you" | "rule" | "import" | "splitwise" | "matcher" | "system";
   export interface ChangeRecord { collection: string; id: string; before: unknown | null; after: unknown | null }
   export interface ChangeSet { id: string; at: string; actor: ChangeActor; reason: string; records: ChangeRecord[] }
   ```
   - `diffCollection(collection, before, after)`: one record per id added (`before: null`), removed (`after: null`), or changed (different `JSON.stringify`).
   - `buildChangeSet(before, after, reason, actor)`: diffs `entities`, `accounts`, `entries`, `baselines`, `settlements`, `bankRows`, `categories`, `rules` (missing arrays are `[]`). Returns `null` when nothing differs.
   - `revertChangeSet(ledger, changeSet)` returns `{ ledger, skipped }`. A record is reverted only when the current value equals its `after`; otherwise it counts as skipped. Reverting removes an addition, restores a removal, or puts `before` back.
2. `file-ledger.ts`: optional `history: ChangeSet[]`, default `[]`, with `before` and `after` as `z.any().nullable()`.
3. `LocalApp.tsx`:
   - `update(next, undoLabel?, actor: ChangeActor = "you")`. When `undoLabel` is given, build a change set from `previous` to the stamped result inside the `setLedger` updater, append it, and keep the newest 200. Without a label, `history` is unchanged.
   - `revertLatestChange()` reverts the last change set, removes it from `history`, and sets the ledger directly, so the revert is not logged. When `skipped > 0`, warn: "`<n>` record(s) changed again since and were left as they are."
   - Add `"History"` to `ViewName`, the Setup nav group, and the `views` map.
4. `HistoryView.tsx`: newest first, showing time, actor, reason, and per-collection counts ("entries: 2 changed, 1 added"). Only the newest row has Revert, behind a `window.confirm` naming the reason.

## Tests
One entry is added and another entry's category changes. `buildChangeSet` gives two `entries` records, and `revertChangeSet` undoes both. If that entry's category is changed again first, reverting skips it (`skipped: 1`).

## Done when
`npm test` and `npm run typecheck` pass. Update `PROGRESS.md`. Next is 22.
