# Printing catalogue

A card belongs to a set. Its printings have independent identities, finishes, sizes, stamps, editions and distribution classifications. `variants` remains the ownership-key list for compatibility; `printings` supplies its meaning. Stable physical keys do not depend on upstream array order or the number of other printings. Raw physical attributes and REST provider/product IDs are retained alongside classifications.

Base counts one eligible printing per card within the printed total; Full also includes secret rares. Master counts each standard expansion printing. All printings additionally counts exclusive and unverified printings. An exclusive copy adds to inventory and value but cannot substitute for a standard completion slot. Raw and eligible graded holdings use the same shared completion rules. Legacy snapshots without detailed metadata retain provisional behaviour until refreshed.

## Classification and corrections

`packages/shared/src/printings.ts` resolves upstream detailed records for both GraphQL listings and REST details. `printingRules.ts` contains scoped corrections and historical exceptions. Rules distinguish standard EX set-logo reverse printings, historical editions, gallery gold cards and supported Black Bolt/White Flare finishes from promotions. The Bounsweet/Steenee Cosmos Holos identify the Tsareena ex Premium Collection with supporting evidence. Recognised promotional stamps identify their distribution; unknown treatments remain unverified and are excluded from standard Master totals. Foil finish or rarity alone never proves exclusivity.

Status is verified, inferred, or unverified. Inferred standard distribution is provisional; it does not claim a human-verified checklist. No set-wide completeness claim is made merely because its automated audit succeeded. Rules are language-scoped where required. Other-language unknown treatments remain in review rather than inheriting an English product origin.

When adding a rule, retain the raw attributes, cite the product/checklist evidence where available, scope it to the appropriate language/set/printing, and add a regression fixture. Increase `PRINTING_VERSION` when classification or identity semantics change. Versioned server set totals are recalculated on demand; snapshot refresh rejects prices from an older printing version. Tracked cards are refreshed by the existing price job. Provider failures retain the previous snapshot and its classification.

## Existing collections

Database migration 6 clears outdated set totals and provider responses, marks snapshots stale, and adds printing change/reassignment records. It does not delete collection entries, prices, price history or graded photos. On snapshot refresh, an unambiguous legacy alias is reassigned atomically, preserving all raw-entry metadata and graded IDs/photo links. If a destination raw entry already exists, the old entry stays unresolved; no automatic merge overwrites its condition or cost. Ambiguous raw holdings remain visible on the card page with an identification selector. Graded holdings can be identified individually through Edit. Reassignment history records the old/new keys and reason; repeating refresh does not duplicate holdings.

The identification endpoint requires collection write access, validates the destination against the stored catalogue, and refuses merges. A collector may need to refresh prices before a newly catalogued printing is available to identify.

The app's normal database backup/update process should be used before rollout. No production database is modified by editing this repository. Historical generic prices retain their original keys and are labelled as legacy attribution; they are not relabelled as a particular physical treatment.

## Prices

Detailed printing prices map to the matching physical record. Base product quotes never populate exclusive or ambiguous treatments. Classified snapshots do not borrow another printing's price, and generic ungraded PriceCharting fallback is disabled for classified cards. Missing quotes remain missing; manual valuation remains available. Graded product links are unchanged.

## Audit and ongoing review

Run with Node 24 or newer:

```sh
npm run audit:printings -- --out /tmp/printings.json
npm run audit:printings -- --lang fr --out /tmp/printings-fr.json
npm run audit:printings -- --lang all --out /tmp/printings-all.json
npm run audit:printings -- sv03 swsh9tg --baseline /tmp/previous.json --out /tmp/next.json
```

The audit is read-only. It reports each set's standard/all totals, physical records, unverified review items, failures and changes against an optional baseline. Exit status is nonzero if any set fails; a successful fetch is not evidence that its classifications are verified. An English catalogue audit on 2026-10-12 fetched 205 sets without failures; unverified treatments still require evidence-based review. Other languages are supported by the audit but are not thereby certified.

Regular snapshot refreshes also retain previous/new classifications in `printing_changes`; owners/admins can retrieve the latest 500 changes from `GET /api/catalog/printing-review`. Changes in price alone do not create a classification event. Review new unknown treatments and unexpected completion-total changes rather than silently guessing. Persist audit artifacts outside the app database and use `--baseline` on subsequent runs.
