# PokeTracker printing standard v2

Status: implemented in the shared classifier and persistent server import pipeline. See [implementation and audit results](printings.md).

## Purpose

PokeTracker should automatically turn the provider's catalogue into a consistent collection checklist for existing and newly released sets. Collectors should be able to see what counts towards completion and why, without maintaining card exceptions themselves.

This is PokeTracker's collection standard. Its automatic decisions are not an official checklist or proof of a printing's historical distribution. An inferred checklist assignment must remain distinguishable from an API-declared fact.

The design takes inspiration from Dex's separation of [Master and Additional variants](https://dextcg.com/help/compendium/variants-compendium) and its [completion levels](https://dextcg.com/help/compendium/sets-compendium). Runtime classification uses API payloads only. Dex's catalogue, product articles and manual checklists are not runtime inputs.

## Collection roles

| Role | Meaning | Required for PokeTracker Master? |
| --- | --- | --- |
| Core | A printing selected as a main version of the card under this policy | Yes |
| Parallel | A corresponding alternative treatment selected under this policy | Yes |
| Additional | A printing this policy places outside the main checklist | No; included in All printings |
| Unresolved | The available data does not support an assignment | Not a mandatory slot; included in All printings and reported separately |

Core is not restricted to exactly one printing per card. Multiple editions or finishes can qualify. The default shown in a card picker is a presentation choice, not evidence that other Core printings are Additional.

Normal, Holo and Reverse Holo describe physical finishes. They are not collection roles. A named foil pattern, edition or stamp does not by itself establish booster eligibility. Parallel treatments are counted only for cards for which the API actually lists them.

Release origin is a separate field. It remains unknown unless the API supplies sufficiently specific release information. Assigning Additional must not populate a source product, promotion name or release date that the API did not establish.

## Completion definitions

| View | Requirement |
| --- | --- |
| Base | One Core or Parallel printing per distinct card within the printed numbering |
| Full | One Core or Parallel printing per distinct card, including secret cards |
| PokeTracker Master | Every Core and Parallel printing, including those of secret cards |
| All printings | Every distinct API-listed printing, including Additional and Unresolved |

Additional holdings remain owned and valued but do not substitute for a Core or Parallel slot. Cards without an eligible printing remain visible; unresolved eligibility cannot silently make Base or Full easier to complete. Report eligible, Additional and Unresolved counts alongside coverage, rather than equating a smaller denominator with certainty.

Master is the standard booster checklist, including secret rares and standard parallel variants; special-product and promotional versions are optional extras. Show progress against the current checklist as a percentage and owned/required counts. Keep catalogue limitations and unchecked-version counts in the collapsed checklist explanation, rather than replacing progress with “Pending” or putting classification jargon above the set header. A zero-slot checklist displays 0%, never complete. All-printings completion means completion of the current API catalogue, not proof that every physical variation has been catalogued.

## Input and identity rules

- Import full detailed printing records, card rarity/category/mechanic, set membership, language, provider identifiers and marketplace references supplied by the API. Preserve the raw payload and retrieval time.
- Prefer valid detailed records over summary finish flags. A conflict is recorded and triggers a refresh; do not union both sources into invented additional printings.
- Flags-only or provider-generated records may be displayed as coarse catalogue data. They do not establish detailed release eligibility or contribute to the set-profile evidence below. Missing flags and explicit false values are distinct.
- Never create a finish from rarity, pricing availability, another card's variants or the API's set card count. Card count is not printing count.
- Treat optional null attributes as absent when the API contract allows that. Retain unfamiliar values. An unfamiliar finish is not automatically a promotion.
- Keep identity separate from collection role, evidence strength, product grouping and price. Preserve existing ownership keys and namespace provider identifiers by card and language; a provider variant identifier need not be globally unique.
- Compare product IDs only within the same marketplace. Missing references are neutral. Equal numeric IDs at different marketplaces have no relationship. Multiple marketplaces repeating a relationship are corroboration, not independent proof of release origin.
- Infer within the same catalogue language and set. Do not copy English release assumptions into another catalogue.

## Deterministic classification order

Evaluate the following rules in order. Each assignment records its rule ID and supporting inputs. Contradictory release evidence produces Unresolved before weaker rules run.

### R10: Explicit release information

Where documented API fields establish the release context of a specific printing, use them to assign its role. Card-level booster availability does not establish availability for every printing of that card. A future field can be used only after its semantics are understood and the adapter supports it.

### R20: Physical and campaign exclusions

An oversized printing is Additional under this policy. A documented campaign stamp with a regular-sized, unstamped counterpart in the same edition is Additional, even if its finish differs. Distinguish edition marks from campaign marks; an edition mark or set logo alone is not an exclusion.

A promotional catalogue can have its own Core printings. A campaign label must not cause every regular-sized card in its own identified catalogue to disappear from completion. Where catalogue context is insufficient, leave the affected assignment Unresolved. Absence of a stamp never proves a standard release.

### R30: Recurring set patterns

Construct a profile from the set's raw API records, not previously inferred roles. Compare cards by set, language, rarity, category and mechanic. Count each comparable card once per physical signature. A signature retains type, foil, size, edition and sorted stamps.

Initial v1 thresholds are policy parameters, not measured accuracy probabilities:

- Exclude the target card from its own comparison group.
- Require at least 10 peers with valid, non-generated detailed records and the comparison fields present.
- Require a complete successful set import before making a new profile-based assignment. Missing cards or failed pages are not negative evidence.
- A signature present on at least 80% of those peers is supported by the profile.
- A signature present on at most 20% of those peers is uncommon in that profile. Being uncommon alone never makes it Additional.

Supported ordinary-sized Normal, Holo, Metal and Lenticular signatures become inferred Core; unfamiliar type semantics remain unresolved. Supported reverse signatures become inferred Parallel when the card has a Core printing. Novel named patterns can qualify by the same rules; there is no per-set list of allowed foil names. Known exclusions and contrary explicit release evidence take precedence.

Small or heterogeneous comparison groups do not inherit a different language's or era's majority. They proceed to the remaining rules. Tests must cover boundary cases and ensure that incomplete inputs cannot masquerade as a strong profile.

### R40: Corroborated additional printing

An otherwise ambiguous extra printing becomes inferred Additional when all of these are true:

1. The target has at least two profile-supported Core/Parallel printings, such as Normal plus Reverse or Holo plus Reverse.
2. Those supported printings share a product reference within at least one marketplace.
3. The extra printing has a different non-missing product reference in that same marketplace and is uncommon in the comparison group.
4. No overlapping marketplace references link the extra printing back to those supported printings, and no stronger API evidence contradicts the assignment.

The explanation is that it falls outside the supported main printing group. Do not label it as a particular promotional product or as proven booster-exclusive/non-booster-exclusive. API-supplied product relationships are used; no marketplace page lookup is required.

This rule applies symmetrically to an extra Normal or an extra Holo. It does not assume that Holo is always the promotional version.

### R50: Unambiguous default and linked parallel

When stronger rules do not resolve the card, prefer ordinary-sized, unstamped Normal or Holo printings without named foils or unfamiliar editions. If exactly one remains, select it as Core even when extra named foils are also listed. If there are no ordinary candidates, a sole named foil can be the default. Do not force a choice between multiple ordinary candidates.

An ordinary listed reverse becomes Parallel when it has no campaign or incompatible edition attributes and has no conflicting marketplace references with a Core printing. Missing marketplace references do not prevent this default. A named reverse pattern still requires a shared marketplace reference or support from the set profile.

These are PokeTracker policy defaults. They are not proof of the card's original release. They do not synthesize an absent Normal or Holo if the provider lists only Reverse.

### R90: Unresolved

Retain the printing and its raw attributes, explain the missing or conflicting evidence, and retry automatically when its card or set data changes. Unknown data does not require a maintainer to approve the rest of the set. Unknown type semantics are preserved for display rather than silently converted to a familiar finish.

## Charmander acceptance example

The API source for [Obsidian Flames Charmander](https://github.com/tcgdex/cards-database/blob/master/data/Scarlet%20%26%20Violet/Obsidian%20Flames/026.ts) lists Normal and Reverse with Cardmarket reference `725106`, and Holo with reference `727116`.

Given a complete set import whose comparable cards satisfy R30 for Normal and Reverse and the uncommon-signature condition for Holo, R40 yields:

| Printing | Collection role | Basis | Release origin |
| --- | --- | --- | --- |
| Normal | Core | Policy inference | Unknown unless explicitly supplied |
| Reverse Holo | Parallel | Policy inference | Unknown unless explicitly supplied |
| Holo | Additional | Policy inference | Unknown unless explicitly supplied |

A read-only import of all 230 Obsidian Flames cards on 2026-10-14 satisfied these conditions for both Charmander and Charmeleon. The single card's product references alone cannot satisfy R40. If the profile or references are absent or contradictory, the ambiguous assignment remains Unresolved. This validates the automatic path, not universal real-world accuracy.

Renaming the card, replacing the set ID and changing product IDs while preserving their equality relationships must leave the result unchanged. There must be no production rule that matches Charmander, Charmeleon or Obsidian Flames by name or identifier.

## Automatic processing and change handling

Discover set IDs through the API on a schedule, with catch-up after server restarts. Import newly discovered sets through a bounded, resumable queue. Refresh recent sets frequently and older sets on a rolling schedule; refresh classification independently of whether anybody owns a card.

Preserve the last successful snapshot on transport failure. Show newly available records with their current evidence coverage, but do not replace a complete profile with a partial import. A profile fingerprint changes when relevant source records change; re-evaluate all dependent cards, not just the card that changed.

Persist policy version, rule ID, profile fingerprint and supporting fields alongside each assignment. Include the policy/profile versions in completion-cache invalidation. Set pages, card pages, collection summaries, raw holdings and graded holdings must consume the same result.

Reclassification changes checklist membership, not holdings, costs, graded IDs, photos or historical prices. Join prices to physical printing identity and product reference, not display labels or Master membership. A price change alone cannot alter classification.

New sets within the supported API contract need no named-set rule, checklist upload or deployment. New data values can be retained automatically. An incompatible API schema change may require an adapter update; this standard does not promise to understand arbitrary future field semantics.

## Implementation and validation

1. Add collection role and evidence metadata separately from the existing distribution field. Keep the physical identity layer in `packages/shared/src/printings.ts`.
2. Replace production card/set overrides in `printingRules.ts` with the ordered policy and set-profile computation. Remove unsupported rarity guesses and corrections that delete API records. Keep historical cases as regression inputs rather than production allowlists.
3. Make `catalog.ts` preserve the inputs needed by the policy and hydrate full records where listings omit them. Store a shared classification result so incomplete listing fields cannot override richer detail data.
4. Update shared completion and server totals to use collection role, including explicit unresolved coverage. Update UI terminology and explanations together.
5. Add migration and refresh handling that preserves existing inventory, reclassifies cached cards and recalculates totals when the policy or profile changes.
6. Test the policy with API-shaped fixtures for Charmander-like extra Holos, extra Normals, genuine multiple Core finishes, historical editions, promotional catalogues, new parallel treatments and small comparison groups. Test missing references, contradictory references, generated variants, nullable fields and partially imported sets.
7. Test whole-set renaming, record reordering, price-only changes, refreshes and cache parity. A newly introduced set must go through the same automatic path without a fixture-specific production branch.
8. Run a read-only catalogue audit before rollout. Report classification coverage, changed memberships, unresolved cases and failed imports. Do not describe agreement with our own rules as independently measured real-world accuracy.

The implementation includes policy, import, migration and UI regression tests. The live audit measures coverage under this policy; it does not establish independently measured classification accuracy.
