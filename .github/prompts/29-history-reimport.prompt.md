
---mode: agentdescription: Batch 29. History import v2. Map groups and subtypes before importing, import payments as card transfers, and replace the earlier import cleanly. About 50K tokens.---
Build batch 29 only. Run after 28.
Read: `.github/prompts/PHASE3.md`, `src/domain/history-import.ts`, `src/domain/ledger.ts`, `src/domain/taxonomy.ts`, `src/adapters/file-ledger.ts`, `src/domain/reports.ts`, `src/domain/health.ts`, `src/ui/views/HistoryImportView.tsx`, `src/ui/views/ComboField.tsx`, `tests/ledger.test.ts`.
Never read `ledger1.finance.json` or any real CSV in code or tests, and never print row contents. Tests use synthetic rows.

## Why
The first import made every `Group` value an entity and every `SubType` value a category. That turned trips, households, places, and expense types into plain groups, and merchants and places into categories. It also skipped payments and dropped rows with a blank `Share`. The ledger holds nothing else, so re-importing with a mapping is cleaner than repairing it.

## Fill in
Answered by the user.
1. A blank `Our share` on a friend, group, or trip row means the other party owed the full amount. Default `blankShare` to `theyOweAll`.
2. The CSV may gain `Tags` and `Notes` columns. Support `My share` as well, but expect it to be absent. `Notes` is free text and becomes the entry note.
3. `Card` means a gift card, and the subtype may name the gift card brand. The alias `card` maps to Gifts and giving › Gift cards. In the UI, suggest Merchant name with category Gift cards for any subtype whose rows the user marks as a gift card.
4. All card payments came from the user's own savings. Payments are same-payer transfers.

## Build
1. `ledger.ts` and `file-ledger.ts`, all optional:
   - `Entry.chargedCents?`: the amount the account actually charged, when it differs from `amountCents` (for example a gift card or points covered part).
   - `Ledger.historyMapping?: HistoryMapping`, so a re-import starts from the last choices.
2. `history-import.ts`:
   ```ts
   type GroupMap = { to: "person" | "group"; name: string; groupType?: GroupType } | { to: "self"; tag?: string };
   type SubtypeMap = { to: "category"; name: string | null } | { to: "merchant"; displayName: string; category: string | null }
     | { to: "tag"; tag: string; category: string | null };
   interface HistoryMapping { groups: Record<string, GroupMap>; subtypes: Record<string, SubtypeMap>; // keys trimmed, lowercased
     blankShare: "theyOweAll" | "splitEqual" | "groupDefault" }
   ```
   - `suggestHistoryMapping(plan, ledger)` starts from `ledger.historyMapping`, then fills the gaps:
     - Groups: `friend` gives a person, `group` gives a `friends` group, `trip` gives a `trip` group, named after the CSV value. A value used as both a friend and a group defaults to the group.
     - Subtypes: a case-insensitive match to an existing or starter category, then a generic alias table (`food` → Restaurants and takeaway, `swimming` → Fitness, `internet` and `mobile` → Internet and phone, `utility` → Utilities, `stay` → Accommodation, `ent` → Events and outings, `gift` → Gifts, `giftcard` and `card` → Gift cards, `donation` → Donations, `misc` and `shopping` → General). Anything else maps to a category of the same name, marked "new" in the UI. Keep real merchant and place names out of the alias table.
   - `planHistoryImport` keeps its checks, but payment rows go to a new `plan.payments` and blank-`Share` rows stay in `pending`. It also reads the optional `My share`, `Tags`, and `Notes` columns. Tags are split on `;` or `,`, trimmed, and lowercased. `Notes` is kept as typed, trimmed, and may be several lines.
   - `applyHistoryImport(plan, ledger, mapping, { replace })`:
     - `replace`: first remove every `source: "history"` entry. When any of them has `bankRowIds`, throw "Unlink bank rows from history entries first."
     - Entities and categories come from the mapping by name: an existing one is reused, a missing one is created. A starter category name creates its parent too. Two keys mapped to the same name merge.
     - `personal` and `house` rows: unchanged from today. `refund` rows give the portion to the mapped entity when `Group` is set, otherwise to self.
     - Friend, group, and trip rows: House gets `Our share`. Self gets `My share` when it is present. The rest follows `blankShare`:
       - `theyOweAll`: everything goes to the entity.
       - `splitEqual`: an equal split of the remainder between self and the entity.
       - `groupDefault`: `splitPreset(remainder, "self", defaultSplitPreset(entity, remainder))`, falling back to `splitEqual` when that returns `null`.
       - A `GroupMap` of `{ to: "self" }` gives self all of it and adds the tag.
     - Subtypes: a `category` map sets the category, `merchant` also sets `displayName`, and `tag` adds the tag.
     - Payments: a `transfer` entry with `accountId` set to the card, no portions, `countsTowardDebt: false`, `source: "history"`, the `historyKey`, and tags `history` and `card-payment`.
     - Pending rows: a self spend tagged `needs-share`.
     - The entry note is `Notes` when that column has text. When `Our share` exceeds the debit and `Notes` is blank, the note is "Gift card or points". Either way that row gets `chargedCents` equal to the debit, `amountCents` equal to the larger amount, and the tag `gift-card`.
     - Save `historyMapping`. Every result must pass `ledgerProblem`.
   - `previewHistoryImport(plan, ledger, mapping, options)`: counts by kind, payments, `needs-share`, entities and categories created or merged, unreferenced entities and categories that would be left behind, and `balances(...).byEntity` before and after.
3. `reports.ts`: `cashFlow` skips transfers that have no bank rows. They are evidence, not money moving.
4. `health.ts`: "History rows with no share" counts `needs-share` entries. It opens Activity with `{ tag: "needs-share" }`.
5. `HistoryImportView.tsx`: after reading the file, show a mapping step and then Commit.
   - Groups table: value, rows, open rows, a To select (Person, Group, or Fold into you), a Name `ComboField` over existing entities, and a Type select (from batch 25).
   - Subtypes table: value, rows, a To select (Category, Merchant name, or Tag), a Category `ComboField` over existing and starter names, and a display-name or tag input where it applies.
   - A "When your share is blank" radio group with the three choices.
   - A "Replace the earlier history import" checkbox, on by default when history entries exist. A checklist of unreferenced entities and categories to remove, all checked.
   - The preview, then Commit as one `update(next, "Import history", "system")`.

## Tests
In `tests/ledger.test.ts`, with synthetic rows:
- A `Payment` row becomes a transfer with no portions, and `report` totals do not change.
- A $30 friend row with blank `Our share` under `splitEqual` gives self $15 and the friend $15.
- Re-importing the same CSV with `replace` leaves the history entry count unchanged.
- `Notes` of "birthday dinner" is the entry note. A blank `Notes` where `Our share` exceeds the debit notes "Gift card or points".

## Done when
`npm test` and `npm run typecheck` pass. In `npm run dev`, the user opens their ledger and re-imports with Replace on. They check Balances and the Health issues, then use "Save as" to write a new file. Update `PROGRESS.md`. Next is 30.
