# U02 lossless field mapping and compatibility boundaries

Status: implementation specification for additive adapters. Existing storage remains authoritative. Source schemas: `packages/shared/src/types.ts`, `tcg/types.ts`, and the append-only server migrations. Parent: [architecture decisions](tcg-unification-decisions.md).

## Catalogue and variant data

| Existing source fields | Destination / invariant |
| --- | --- |
| Pokémon card `id`, `name`, `number`, `rarity`, `artist` | Common card identity/display fields; preserve exact strings, including numbering prefixes and leading zeroes |
| `set` including ID, name, series, printed/total counts, dates, code, images | Explicit common membership plus typed Pokémon set metadata; do not discard logos, printed totals or update dates |
| `images.small/large` | Preserve both sizes in typed metadata; common image is a selected presentation URL |
| `supertype`, `subtypes`, `hp`, `types`, evolution, rules, abilities, attacks, weakness/resistance, retreat, flavor, Pokédex numbers, regulation mark, `legal` | Typed Pokémon game details; missing legality remains unknown |
| `variants`, `printings` | Preserve legacy keys and full physical variant records. A summary list remains distinguishable from detailed evidence |
| Printing `id`, label, finish, size, stamp, edition | Common physical variant; finish never replaces identity |
| Printing distribution, status, role, decision (all rule/profile/peer/product fields), data quality, source product, evidence | Optional common variant evidence/policy metadata; absence is retained, not promoted to certainty |
| Printing provider ID, legacy aliases, raw attributes, marketplace IDs | Common variant provenance, cloned without mutation. Marketplace IDs remain scoped by marketplace |
| Printing version/context/profile/coverage; `detailed` | Typed catalogue metadata with explicit language/set context, separate from eligibility and fetch freshness |
| `tcgplayer` / `cardmarket` including URL, updated time, low/mid/high/market/direct-low blocks | Preserve complete source blocks in typed Pokémon catalogue metadata in addition to normalized quotes. A normalized market quote alone is not a lossless replacement |
| Pokémon snapshot set/display fields, images, types and printing fields | Preserve existing snapshots until catalogue adapter can populate equivalent normalized records; never require a full upstream fetch merely to read holdings |
| Snapshot `prices`, source URLs/timestamps, `pricingComplete`, `syncedAt` | Preserve exact variant quote values and their provenance/completeness. Existing USD snapshot values are not mislabeled native EUR |
| Magic common `TcgCard` fields, faces, `details`, finishes, treatments, quotes, `fetchedAt` | Keep every field verbatim. Add variant records as a projection, not a rewrite of card/finish IDs or quotes |
| Magic Oracle ID, rules completeness, colors/identity, mana value, text/type, keywords, layout, meld result, legalities and produced mana | Existing typed Magic details; retain all face and rules fields |
| Generic `TcgSet` game/id/provider/code/name/date/total/type/parent | Preserve as-is; no new requirement to infer membership from IDs |

Raw provider responses retained by existing catalogue storage remain retained there. Common types do not imply permission to discard unknown source attributes or rewrite source snapshots. Runtime boundary validation is required before treating external JSON as a typed record.

## Collection and operational data

| Existing source fields/tables | Destination / invariant |
| --- | --- |
| Entry ID, card/set IDs, variant/finish, quantity, condition, notes, paid amount/currency, value override, added/updated times | Repository DTO must represent each field. Keep variant IDs independent of finish, manual value precedence, currency and explicit unknowns; no generic writer replaces legacy fields before DTO parity |
| Wishlist card ID and added time; note text and updated time | Preserve metadata even where generic state currently projects only an ID or text; repository storage retains full rows |
| Slab ID, card/set/variant, company/companyName, grade/label/certificate, subgrades, completion flag, paid/value/notes, price link/value/update time, added/updated times | Preserve complete typed slab data, including leading-zero certificates and custom grading company; generic `Slab` needs additive parity fields before caller migration |
| Sealed ID/name/type/set/language/quantity, paid/value/notes, price link/value/update time, status/opened time, added/updated times | Preserve opened products and total-manual-value semantics; generic DTO needs missing timestamps before migration |
| Lists ID/name/description/kind/format, timestamps; ordered cards/quantities or generic zone items | Preserve order, zones, quantities and timestamps. Maintain existing destination-ID import mapping; generic `addedAt` alone does not replace created/updated timestamps |
| Raw/graded/sealed deletion markers and generic `deleted_at` | Retain tombstones and current retention rules; do not resurrect deleted records on backfill |
| Pokémon and generic photo metadata and byte files | Preserve IDs, parent links, side/MIME/size/time where present, exact bytes and game/collection scope. No rekey required |
| Price history source/currency/variant/date/price/printing-version and value-history data | Preserve native prices, legacy attribution and historical totals/cost fields. Do not recompute past values using today's FX or policy |
| Printing raw cards/catalogues, profiles, changes, reassignments and sync queue | Retain source data, audit evidence, versions and resumable state behind catalogue adapter |
| Collections including revision, owners/members/roles, import mapping and mutation receipts | Remain in existing collection/mutation services; game-scoped operations share the collection revision. Receipts remain durable across collection deletion as currently designed |
| Shares, share users, encrypted tokens, privacy flags, scope/target, audience, expiry/revocation/view metadata, game/language | Existing authorization/projection remains authoritative until U20 parity; legacy game/language defaults remain Pokémon/English |
| Users, authentication/session/MFA/invite/reset records, encryption settings, update/write-protocol state, operational settings/audit logs | Outside catalogue refactor. Preserve through instance recovery; export/import does not become an account/secret migration |
| HTTP/image caches, set stats and provider job status | Preserve current invalidation/retention contracts. Explicitly distinguish reconstructable cache invalidation from collector data loss |

No persisted-field deletion is authorized by this table. Repositories retain source rows until full DTO parity is demonstrated. New fields discovered during U09 must extend this mapping and fixtures before caller migration.

## Adversarial mapping examples and tests

- Same card and finish, two stamps: two variant IDs and two independent ownership keys. Completion role changes do not change either key. See `completion.test.ts` and new variant contract tests in U03.
- Japanese release without English equivalent: retain its own set/language/card references; unknown playable equivalence stays unknown. No name translation or provider setting invents a mapping.
- Existing Magic nonfoil/foil holdings: variant IDs are exactly `nonfoil`/`foil`, so entry keys and `prices` indexing remain unchanged. Missing foil quotes stay absent.
- Ambiguous Pokémon alias: retain all candidate evidence; no new migration picks a candidate by name or first position. Legacy import behavior remains separately tested and documented.
- Schema-2 list upgraded to decks: default quantity remains 1; existing order survives. Later deck quantities remain unchanged. See `tcg-baseline.test.ts`.
- Revoked user-audience share: encrypted token, allowed users, revocation and hidden-note flags survive upgrades and remain enforced. Photo access follows the same projection.

## Sequencing and retirement

Additive type/projection work may proceed with preservation fixtures and mapping decisions established; it does not cut over users or remove compatibility behavior. U01's remaining WebKit/manual accessibility and extended performance checks remain explicit gates for affected caller cutovers and final release. This narrows the initial plan's all-or-nothing baseline dependency so independent, reversible contract work can proceed without claiming those checks passed.

Compatibility projections retire only after both endpoint families use common services, field/round-trip fixtures pass and no active consumer requires the old shape. Supported export readers and URL aliases have separate longevity requirements; deleting old UI does not justify removing them. Physical table retirement stays in the optional M track.
