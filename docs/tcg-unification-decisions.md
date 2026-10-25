# U02 architecture decisions: TCG unification

Status: proposed implementation decisions, 25 October 2026. Prepared alongside U01; contract changes remain gated on the baseline inventory and relevant regression evidence. Parent: [refactoring plan](tcg-unification-plan.md). No persisted format changes are introduced by this document.

## 1. Preserve external identity; scope internal operations explicitly

Public Pokémon card IDs and ownership keys remain unchanged. Existing Magic IDs remain unchanged. Server operations carry a game ID explicitly and verify referenced records against that game's catalogue; textual prefixes alone do not establish ownership. Never derive set membership from ID parsing in shared domain logic.

Distinguish provider references, language-specific card records, physical variants and playable equivalence. Provider references include provider, provider ID and language/release context where required. A playable identity is supplied by game rules with provenance; a shared name is not universal proof that cards are interchangeable. Pokémon copy-limit grouping and format-aware ownership retain their existing rules. Magic retains Oracle identity and printing-specific finish support.

Stored-reference dispatch resolves the provider from the stored reference, independently of today's configured provider. Configuration selects new catalogue requests, not a reinterpretation of existing IDs. Any historical ID resolution requiring guesswork remains explicitly unresolved in new migrations. Existing legacy import tie-breaking is characterized in tests and retained in compatibility readers until an explicit behavior change is designed; silently tightening it would be a regression.

## 2. Physical variants are first-class; finish is an attribute

A normalized card contains collectible variant records with stable IDs, labels, finish, size, edition, stamps and treatments. Evidence, raw provider attributes, source/product references, aliases and classification versions survive adaptation. Completion role and price do not participate in identity: reclassification must not rekey holdings. Unknown attributes remain unknown; price availability never invents variants.

Existing Pokémon `variant` values map to variant IDs without mutation. Existing Magic card/finish pairs receive stable variants preserving their current entry keys. Distinct variants sharing a finish must never merge. Ownership identity is scoped by collection, game, card and variant; preserve existing row IDs where current APIs expose them. Per-stack physical location tracking is deferred and must not be smuggled into this ownership-key refactor.

One physical signature is not assumed globally unique across languages/providers. Cross-provider equivalence needs an explicit reviewed mapping with provenance. Ambiguous aliases are retained for display/repair and cannot trigger automatic quantity reassignment.

## 3. Completion measures are game policies over lossless records

Use keyed measures with owned/total counts, labels, coverage and uncertainty metadata. Pokémon uses existing Base/Full/Master/All calculations and policy versions. Magic preserves distinct playable identities, card printings and finish slots. A default generic measure is allowed only for games that explicitly select it.

Keep catalogue coverage distinct from ownership. Additional/unresolved Pokémon variants remain collectible and valued without filling eligible slots. No zero-denominator checklist is declared complete by division defaults. A compatibility projection supplies current UI/API fields until callers migrate. Test expected counts independently of the implementation, including graded participation and language scope.

## 4. Game capabilities require implementations

Source-owned modules declare supported operations with required handlers, validated at registry construction. Represent absence explicitly. Transitional Pokémon compatibility behavior must be named rather than silently claiming empty scan/deck implementations are complete. Rule functions are deterministic, side-effect-free and receive explicit format/settings/catalogue context; they neither read SQL nor fetch HTTP.

Formats return legal, illegal or unverified. Unknown required information cannot certify legality. User-configurable rotation marks and bans are passed into Pokémon rules. Presentation hooks supply facts, text, symbols and explanations through typed slots, while shared controllers retain state, permissions and mutation orchestration.

## 5. Share services before consolidating tables

Introduce repository adapters for existing Pokémon and generic storage. Application services own authorization, transaction boundaries, revisions, receipts and coordinated writes. Repositories operate within that boundary and cannot bypass it. Existing endpoints become translators to common services so there is one authoritative writer per operation.

The collection revision remains collection-wide under the current durable mutation protocol, even when requests select a game. Shared reads may be compared against legacy projections, but rollout flags never create two independent write paths. SQL access is isolated to adapters only as callers migrate; enforce the final boundary when retirement completes.

Storage consolidation requires its own evidence-based decision after service parity. An adapter-backed final design is valid. If migration proceeds, use additive schema, journaled backfill, full reconciliation, a final write pause and a tested plan for post-cutover writes. Keep source storage through the retention window. Backups alone cannot recover edits made after their capture.

## 6. One provider policy; distinct catalogue and price responsibilities

Server registry factories centralize provider selection and stored-reference resolution. Adapters own vendor queries, normalization, runtime validation, bounded pagination, cache freshness and supported image hosts. Common request helpers enforce timeouts, redirects and byte/resource limits. Providers return explicit partial/stale/unavailable results.

Price selection retains exact language/variant attribution, currency, source and timestamp. Preserve manual override precedence, existing FX policy, genuine zero quotes and absence. Do not copy a quote to another language or variant to make a valuation available. Retain historical source attribution and printing version. Provider credentials remain server-only; cache visibility must account for credential-scoped responses without storing credentials in keys or logs.

## 7. Compatibility is a versioned contract

Keep current exports and supported historical readers. Do not add a new export version simply to reflect internal types. A richer format requires a field-by-field reason, explicit version, lossless reader chain and round-trip fixtures. Preserve current Pokémon destination list-ID remapping and import mapping records. Reject unknown future versions before mutations or provider calls.

Client state keys include account/session lifecycle, collection, game, language and relevant query fields. Cancel or discard obsolete requests on scope switches; clear private state on logout. Retain URLs, filters and user preferences while moving controllers. Compatibility code receives documented removal conditions and tests.

## 8. Accessible interaction and privacy are shared boundaries

Use common accessible dialogs, inputs, status/error announcements and layouts. Game content slots cannot replace required labels, focus management or permission checks. Manual search provides an alternative to camera scanning; button/menu controls provide alternatives to dragging. Charts have equivalent text/data views; meaningful symbols and states have non-color text alternatives.

Public state and photo access derive from the same server privacy projection, including audience, expiry/revocation, game, language and set/list scope. Capability flags are presentation hints, never authorization. Tests cover isolation and redaction before common routes or controllers become default.

## Consequences and review gates

The richer variant contract adds adapter work for Magic and Pokémon together; it prevents flattening Pokémon evidence or hardcoding Pokémon finish names into future games. Temporary compatibility projections increase code until callers migrate; each has an explicit retirement dependency in the [PR plan](tcg-unification-prs.md).

Before U03 implementation, confirm every baseline persisted field has a lossless mapping, ambiguous import handling is explicit, capability registration remains usable at every merge, and the contract changes can be introduced additively. Record unresolved baseline checks separately. No security, recovery or accessibility gate is waived by this design document.
