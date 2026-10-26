
---mode: agentdescription: Batch 28. Every entry can carry an optional note for extra detail. About 15K tokens.---
Build batch 28 only.
Read: `.github/prompts/PHASE3.md`, `src/ui/views/ActivityView.tsx`, `src/ui/views/SpendForm.tsx`.

The `note` field already exists, and Activity search already matches it. This batch only makes it easy to write.

## Build
1. `ActivityView.tsx`: in the details panel (the branch that is not `SpendForm`), replace the read-only Note line with a labelled textarea inside the existing `detail-note` wrapper. Placeholder "Optional details". On blur, if the trimmed text differs from `entry.note ?? ""`, save it with `updateEntryInline(entry, { note: trimmed })`. A blank note saves as `""`. This works for every entry kind. No new CSS.
2. `SpendForm.tsx`: the Note input becomes a `<textarea rows={3}>` with the same placeholder. It stays required only when the amount was amended against its bank rows.

## Tests
No new test.

## Done when
`npm test` and `npm run typecheck` pass. In the browser, open Activity, open Details on a spend and on a refund, type a note, click away, and find it again with search. Update `PROGRESS.md`. Next is 29.
