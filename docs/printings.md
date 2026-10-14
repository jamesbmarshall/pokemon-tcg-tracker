# Printing catalogue

The [PokeTracker printing standard v1](printing-standard.md) is implemented using TCGdex API payloads only. There are no production card-name or set-ID classification exceptions, external checklists, or manual approval gates.

## Classification

`packages/shared/src/printings.ts` preserves physical identity and raw attributes. `printingRules.ts` assigns Core, Parallel, Additional or Unresolved, separately from release origin. Master includes Core and Parallel. All printings includes every API-listed physical printing. Additional copies remain owned and valued, but do not fill Base, Full or Master slots.

Assignments retain policy version, rule, reason, profile fingerprint, peer counts and product relationships where applicable. Inferred membership never establishes a product origin. Flags-only, generated, malformed or contradictory records remain unresolved. No finish is invented from rarity or prices. Existing legacy snapshots become provisional until the complete set import replaces them.

The UI labels roles and inferred membership. Master shows assigned-slot counts with Pending when imports or eligibility are incomplete, including zero-slot catalogues. Additional and unresolved printings remain available under All printings. Missing printing data cannot silently create a Normal choice in add forms.

## Automatic lifecycle

The server discovers sets in every supported language every six hours and catches up after restarts. Discovery persists a queue independent of collection ownership. Every 15 minutes it processes up to eight due sets, with at most two concurrent full-set imports and six card fetches per import. Newly discovered sets are ordered by release date. Opening an uncached set or card also triggers its import.

Each import validates pagination and card count, fetches every full REST card record, builds the profile from source observations, then publishes the classified catalogue, card snapshots and completion totals in one SQLite transaction. Successful card downloads are saved individually so a failed import can resume. Set and card pages, known search results and collection snapshots share this result; lightweight listings cannot downgrade complete stored classifications.

Recent sets (released within 90 days) are queued daily; older sets weekly. On-demand catalogues are fresh for six hours. A failed refresh retains the last complete catalogue and retries after an hour. Queues survive restarts. A changed source profile reclassifies every card in that set. Policy and printing versions invalidate cached results. Newly named foil patterns can qualify through the same set-profile rules; an incompatible API schema still needs an adapter update.

## Existing collections and prices

Migration 7 adds the catalogue, raw-record, set-list and queue tables, clears obsolete completion totals and marks card snapshots stale. It preserves entries, quantities, conditions, notes, costs, graded IDs, photo links and price history. Reclassification itself does not move holdings. Existing unambiguous identity-alias reconciliation remains available; ambiguous legacy holdings are retained for individual identification without destructive merges.

Prices join to physical identities and API product references, independently of checklist role. A base product quote cannot spill onto an unrelated treatment. Detailed prices remain available for Additional printings. Price-only changes do not alter the profile fingerprint. Historical prices retain their original keys.

No production database is modified by editing this repository. The migration runs through the normal application update/start process.

## Validation and read-only audit

Run with Node 24 or newer:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run audit:printings -- sv03 base1 swsh9tg sv10.5b --out /tmp/printings.json
npm run audit:printings -- --lang all --out /tmp/printings-all.json
npm run audit:printings -- sv03 --baseline /tmp/previous.json --out /tmp/next.json
```

Tests cover renamed future sets, extra Holo and extra Normal printings, multiple Core finishes, editions, novel parallels, exact peer thresholds, conflicting or missing evidence, complete-import requirements, refreshes, resumable failures, route parity, inventory preservation and migrations.

Live API audit on 2026-10-14:

| Set | Cards | Assigned Master | All printings | Additional | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Obsidian Flames (`sv03`) | 230 | 396 | 454 | 29 | 29 |
| Base Set (`base1`) | 102 | 232 | 415 | 7 | 176 |
| Brilliant Stars Trainer Gallery (`swsh9tg`) | 30 | 32 | 32 | 0 | 0 |
| Black Bolt (`sv10.5b`) | 172 | 376 | 425 | 6 | 43 |

All four imports completed. Charmander and Charmeleon in Obsidian Flames each produced Core Normal, Parallel Reverse Holo and Additional Holo. The unresolved totals, especially historical variants, show the limits of API-only evidence. Assigned totals are policy estimates, not independently verified physical checklists; even zero unresolved records is not proof of real-world completeness.

The audit writes role counts, profiles, source records, unresolved items, import failures and optional baseline differences. Exit status is nonzero for failed imports. Runtime classification changes are retained in `printing_changes`; owners/admins can inspect the latest 500 via `GET /api/catalog/printing-review`.
