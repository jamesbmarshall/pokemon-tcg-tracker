# TCG unification refactoring plan

Status: proposed implementation plan, 25 October 2026. This document authorizes no production data migration. Implementation phases below have not been executed.

## Goal and acceptance criteria

Make Pokémon, Magic and future games use common collection services and accessible workflows through explicit game and provider contracts. Preserve every existing supported behavior and stored record. Adopt Bindarr's normalization boundaries, centralized provider decisions and shared workflows while retaining this application's printing evidence, completion policies, game modules, currency handling and recovery protections.

Completion means:

- Pokémon works through the shared catalogue, collection, mutation, sharing and UI contracts.
- Existing Pokémon IDs, links, exports and holdings remain usable; supported imports retain their semantics.
- Existing Magic features, including Commander and precons, remain functional.
- A small test game can exercise supported capabilities without adding game branches to shared services or screens.
- Security, migration, accessibility and regression gates pass with recorded evidence.
- Compatibility implementations have named removal criteria; unfinished migration work is visible.

Zero regression is a release requirement to verify, not a guarantee inferred from passing tests. Unknown baseline behavior must be characterized before replacement.

## Evidence and architectural choices

Current boundaries are documented in [multi-game.md](multi-game.md). Pokémon is intentionally a compatibility implementation: its module has empty formats and scanning behavior, generic routes reject it, and generic providers only register Magic. The app routes and collection state take separate paths. Generic finish-based holdings cannot directly express all Pokémon physical printing semantics.

Bindarr's [architecture](https://github.com/thenotoriousJeremy/bindarr/blob/main/PROJECT.md) normalizes providers into a shared card cache and collection model. Its [central provider policy](https://github.com/thenotoriousJeremy/bindarr/blob/main/backend/src/utils/pokemonProvider.js) prevents inconsistent language/provider decisions. Its [printing options](https://github.com/thenotoriousJeremy/bindarr/blob/main/frontend/src/utils/cardOptions.js) retain fixed game branches and Pokémon-derived storage values. Borrow the first two patterns; represent finishes and treatments through explicit contracts here.

Retain the current TypeScript/Fastify/React stack. Do not introduce a runtime third-party plugin loader. Game modules are reviewed application code. Avoid adding a general event bus, dependency injection framework or new persistence library without a demonstrated requirement.

Target dependency flow:

```text
Accessible shared screens + game presentation slots
                       |
Game-scoped client queries and commands
                       |
Authenticated application services / mutation boundary
                       |
Game rules     Collection repository     Catalogue provider
                       |
          Legacy Pokémon or generic storage
```

Providers normalize external data; rules interpret game semantics; repositories persist; application services authorize and coordinate; UI renders. Rules do not perform HTTP or SQL. Repositories do not decide whether a request is authorized. Provider configuration never determines how an already stored identifier is interpreted.

## Contracts to establish before cutover

1. **Identity:** distinguish game, provider reference, playable identity, set membership, language-specific card printing and collectible variant. Do not assume Pokémon names form a universal playable identity. Keep game-specific deck equivalence in rules. Preserve all existing public IDs; use explicit game scope and validated catalogue ownership rather than requiring a prefix on historical Pokémon IDs.
2. **Variants:** model finish, stamp, edition, size and treatment separately from identity, price and completion role. Preserve raw evidence, source, classification version, aliases and unresolved status. Never manufacture a variant from price availability. Existing Magic card/finish pairs receive lossless mappings. Specify the unique ownership key before changing storage.
3. **Completion:** use named measures with stable keys, display labels and numerator/denominator, plus coverage and uncertainty metadata. Pokémon supplies Base/Full/Master/All; Magic supplies its current measures. Keep zero-denominator and stale catalogue behavior explicit. Reuse the existing classifier and [printing standard](printing-standard.md).
4. **Rules:** register formats, scan parsing, deck text and analysis adapters. Supply explicit rules context for regulation marks, ban lists, format and catalogue completeness. Return legal/illegal/unverified, with unknown data unable to certify legality. Preserve Pokémon's format-aware ownership and Magic's Commander rules.
5. **Capabilities:** model supported operations and required handlers together so a module cannot advertise scanning or decks without implementing them. Use discriminated contracts or registry validation. Presentation extension points cover card facts/text, symbols and printing explanations; they do not replace entire page controllers.
6. **Providers:** separate game rules from catalogue and price providers. Centralize provider/language selection, stored-ID resolution, runtime validation, pagination, cache policy and supported image hosts. Keep source-specific query syntax inside adapters. Expose stale/partial/unavailable states explicitly.
7. **Collection repository:** define reads, validated writes, deletes, referenced-card lookup, photos and history behind an interface. Initially implement it against existing Pokémon tables and generic tables. Transactions, revisions and idempotency receipts remain at the application-service boundary.
8. **Valuation:** preserve quote currency, source, timestamp and exact variant attribution. Keep manual overrides, historical values, FX semantics and missing prices. Never borrow another language's price silently or total different currencies without the established conversion policy.

## Delivery sequence

The executable breakdown is in [Incremental PR plan](tcg-unification-prs.md), including dependencies, per-PR acceptance tests, rollout boundaries and the optional migration track.

Each phase is a series of small reviewable PRs. Each PR includes contract changes, implementation, relevant tests and documentation. Merge dependencies follow the order below; implementation estimates follow the phase-0 inventory.

### Phase 0 — Baseline and design decisions

Inventory Pokémon and Magic workflows, APIs, persisted fields, routes, exports, background jobs, permissions and accessibility behavior. Include CSV/JSON import, PTCGL, Commander, precons, printing reassignment history, photos, sealed products, sharing and admin settings. Record each feature's current owner, target service, acceptance test and retirement dependency.

Create synthetic historical databases representing supported schema/import versions and edge cases. Run the current validation suite and record pre-existing failures separately. Establish representative catalogue/collection sizes and performance baselines for state loading, search, mutations, jobs, backup and import.

Write architecture decisions for identity, variants, completion, rule context, repositories, export compatibility and eventual storage consolidation. Pin the Bindarr revision used as design evidence if implementation borrows code; preserve required attribution and review dependencies/licenses.

Exit: feature/field matrix reviewed; baseline fixtures and validation results reproducible; data invariants agreed.

### Phase 1 — Shared contracts and Pokémon adapters

Extend `packages/shared/src/tcg` with the contracts above. Move game implementations into dedicated modules; retain compatibility re-exports until consumers move. Wrap existing Pokémon printing, completion, scanning and deck functions rather than rewriting their algorithms. Adapt existing catalogue services into `TcgProvider`; register both games through one server provider registry.

Add contract tests for every module/provider and the minimal third game. Detect duplicate IDs, missing handlers and unsupported operations at startup/test time. Extend Magic adapters in the same PRs where contracts change.

Exit: adapters reproduce baseline outputs, including incomplete data and language-specific cases; no consumer requires a lossy conversion.

### Phase 2 — Common application services over existing storage

Implement repository adapters and shared collection/query/command services. Enable Pokémon on generic routes only once ID validation and repository dispatch are correct. Keep legacy endpoints as thin compatibility translators to those services. Consolidate validation and privacy projections so legacy and new routes cannot diverge.

Use a single authoritative write path. Introduce controlled rollout switches for reads/UI, never simultaneous independent writers. Differentially compare old/new read projections on fixtures and staging data, with normalized ordering and timestamps.

Exit: equivalent collection state, valuation and export content; authorization and retry/conflict behavior match through both endpoint families; no new writes bypass the durable mutation protocol.

### Phase 3 — Shared accessible frontend

Create a common game/collection context and query/command layer. Include collection, game, language and relevant filters in cache keys. Cancel or discard stale responses when account, collection or game changes. Prevent background Pokémon store loading from becoming an implicit requirement for other games.

Move screens incrementally: collection/wishlist, sets/search, card detail, graded/sealed, lists/decks, scanning, then settings/sharing. Reuse `CardDetailLayout` and existing dialogs. Preserve route aliases, URL filters, binder preferences, pending edits, error recovery and mobile navigation. Put Pokémon and Magic facts in typed content slots. Replace app-shell branches with module metadata/capabilities where appropriate.

Exit: workflow parity matrix passes for both games across desktop/mobile; accessibility review passes; old controllers are removed only after all callers move.

### Phase 4 — Supporting workflows

Dispatch refresh and catalogue jobs through registered provider capabilities, keeping provider-specific bulk import implementations separate. Reuse existing admission, storage reserve and staged publication safeguards. Consolidate price history, photos, sharing, import/export and public views through the same services.

Preserve version-7 exports and earlier supported Pokémon inputs. If a richer format is required, introduce an explicitly versioned exporter and migration chain; keep old readers and fixture tests. Imported snapshots never become trusted global catalogue updates.

Exit: backup/restore, repeated import, public sharing, provider outage and interrupted job scenarios pass for both games.

### Phase 5 — Optional storage consolidation

Make this decision after service/UI parity. Shared interfaces can remain backed by different tables. Consolidate only if it materially simplifies maintenance and preserves the complete model.

If approved for implementation: use additive schema changes, deterministic resumable backfill, verified cutover and delayed retirement. Build a dry-run migration report before production rollout. Preserve original IDs and timestamps; use internal mapping tables where needed. Retain source records through the rollback window. Never resolve ambiguous printing aliases by guessing.

Exit: migration and restore rehearsal evidence below is complete. No destructive cleanup is bundled with first cutover.

### Phase 6 — Retirement and extension proof

Remove superseded controllers, direct legacy-table access outside adapters and temporary read comparisons. Retain documented compatibility endpoints/import readers as necessary. Run the minimal third-game collecting journey and capability-absence tests to demonstrate extension without shared-code changes. Update the architecture guide to describe the final implementation rather than transitional behavior.

## Data preservation and migration gates

- Establish a manifest covering entries, quantities, variants, notes, wishlists, slabs, certificates, sealed products, lists/decks, paid currencies, manual values, histories, photos, shares, memberships and catalogue provenance. Include deletion markers and operational receipt/revision state when affected.
- Verify counts and semantic digests per collection/game, foreign keys, uniqueness, ownership quantities and relationships. Aggregate totals alone cannot establish preservation. Validate photo bytes/references and authorization relationships.
- Preserve unresolved records losslessly and report them. Block cutover when their semantics cannot be represented. Preserve explicit null/unknown values where they differ from defaults.
- Backfill bounded batches with a migration journal. Prove restartability and exactly-once effects with failures between checkpoints. For concurrent installations, use a documented maintenance window or a proven change-capture protocol; default to a brief write pause for final reconciliation.
- Take and verify a complete pre-cutover backup including photo files and required encryption material. Check disk reserve before writing target data.
- Switch authoritative storage transactionally where possible, and run reconciliation before reopening writes. Define how to recover writes made after cutover; restoring an older backup alone would lose them. Test forward repair or replay/export of subsequent writes before claiming rollback safety.
- Test every supported upgrade path, repeated startup, interruption, disk-full failures and restoration. Older binaries must continue rejecting unsupported newer schemas. Publish downgrade instructions and backup retention/removal criteria.

## Security requirements

Use the [existing security review](multi-game-security-review.md) as a regression checklist and extend its threat model for the new boundaries.

- Resolve authenticated user, collection membership, role and game scope server-side on every operation. Validate card/record ownership against the selected game. A client capability flag is never authorization.
- Preserve CSRF protection, atomic revision checks, durable idempotency receipts and parameterized SQL. Test conflicting writes, retries and account/collection switches.
- Public shares and photo reads reuse one filtered projection, including audience, expiry, revocation, language and set/list scope. Avoid disclosing private resource existence in errors.
- Validate all external JSON at runtime before normalization; use bounded responses, timeouts, pagination budgets and fixed HTTPS endpoints. Disable or tightly validate redirects and pagination links. Maintain image host/raster restrictions and protection against arbitrary internal-network requests.
- Preflight imports before hydration. Keep worker parsing, admission control, record/reference limits and storage budgets. Reject prototype-bearing/unexpected structures at boundaries; imported catalogue data never overwrites trusted shared data.
- Keep provider credentials server-side and redact logs/errors. Document cache scope when credentials change data visibility; do not put secret values in cache keys or telemetry.
- Record structured operational outcomes without private notes, credentials or sensitive photo URLs. Exercise abuse limits for searches, scans, imports and provider jobs.
- Require dependency audit and review of new dependencies. Retain supply-chain/update verification and backup protections already implemented.

Security exit: negative tests cover cross-user, cross-collection, cross-game and cross-language access, mutation replay/conflicts, revoked shares, malformed upstream data, import poisoning and resource exhaustion. A dedicated review occurs before full cutover.

## Testing strategy

**Unit tests:** pure normalization, ID parsing, variant mapping, alias ambiguity, completion, quote selection, capability validation, scan parsing, deck rules and export migrations. Use table-driven fixtures across languages and missing/conflicting data. Assert observable behavior rather than internal call order. Property tests are useful for quantity preservation, round trips and order-independent completion; choose tooling only after assessing existing facilities.

**Contract tests:** run the same repository suite against legacy Pokémon and generic storage, and the same provider/module suite against each adapter. Fixtures must include third-game capabilities being absent, unfamiliar finishes, non-English releases and missing prices.

**Integration tests:** real SQLite transactions and HTTP boundaries; permissions, receipts, revisions, photos, import admission, exports, jobs and partial catalogue publication. Stub upstream providers with sanitized deterministic responses; ordinary CI does not require live credentials.

**Migration tests:** historical synthetic databases, semantic reconciliation, retry/crash injection, large batches, disk pressure and complete restore. Keep an immutable expected pre/post manifest so identical mistakes in old/new code cannot pass by comparison alone.

**Browser tests:** Pokémon and Magic critical journeys, legacy deep links, switching accounts/games/collections, edit errors, import preview, deck ownership, binder behavior and public shares. Preserve existing Chromium/WebKit coverage and isolated server/database setup. Add focused Firefox checks where supported rather than silently claiming coverage.

**Performance:** compare against phase-0 budgets for large state reads, provider request counts, import memory, SQLite lock duration and frontend bundle cost. No unbounded per-card network requests or per-row database queries in collection paths. Gate measured regressions and document exceptions.

Use branch coverage to find untested decisions in new domain/security/migration code; require explicit tests for each critical failure path. Set numerical thresholds after measuring the baseline, and prevent coverage from decreasing in touched critical modules. Coverage is supporting evidence, not the acceptance criterion.

## Accessibility requirements

Target WCAG 2.2 AA throughout changed workflows, with manual validation in addition to axe.

- Every control has a programmatic name and visible focus. Dialogs manage initial focus, containment, Escape and return focus. Validation links errors to inputs and retains user-entered values.
- Keyboard users can search, select variants, change quantities, manage lists and navigate binder pages. Dragging/reordering has equivalent button/menu operations. Camera scanning has search/manual-entry alternatives.
- Card imagery has appropriate alternative text; decorative symbols are hidden; meaningful game symbols have text equivalents. Ownership, rarity and legality never rely on color alone.
- Charts provide equivalent values/tables. Announce save errors, results and progress through restrained live regions without moving focus unnecessarily.
- Validate contrast, target sizes, reduced motion, text resizing, 400% zoom and narrow-screen reflow. Tables/binders retain logical reading order and reachable controls, including when virtualized.
- Test keyboard-only and screen-reader journeys using NVDA/Firefox and VoiceOver/Safari when available. Record platform, workflow and findings; automated browser checks do not replace those sessions.

Accessibility exit: no unresolved critical/serious automated findings in changed journeys, plus documented manual conformance checks and fixes for issues at any severity that prevent WCAG AA compliance.

## Coding and documentation standards

- Strict TypeScript at boundaries; narrow validated unknowns and avoid unchecked casts/`any`. Prefer explicit domain types and exhaustive discriminated unions.
- Keep changes focused, dependencies directional and modules small enough to review by responsibility. Separate parsing, normalization, policy and persistence. Use stable error codes and consistent user-facing messages.
- Share validation rules where semantics truly match; preserve server enforcement even when client validation exists. Use deterministic pure functions and injectable clock/provider dependencies for tests.
- Document invariants and reasons for unusual compatibility behavior. Avoid comments that merely restate implementation. Do not hide transitional fallbacks or silently swallow data failures.
- Maintain architecture decisions, extension/provider guides, API/error contracts, schema/identity diagrams, migration/rollback runbooks, security threat model, accessibility checklist and behavior matrix alongside code.
- Each PR states the user-visible behavior, data/security impact, validation performed, limitations and rollback path. Assign a reviewer for domain behavior and an additional specialist review for security, migration and accessibility boundaries.

## Release gates and follow-ups

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run audit:dependencies`, and the affected browser matrix. Run printing audits, crash/recovery/backup-reliability rehearsals and deployment-template validation when the change touches those paths; require the full applicable set for the final release candidate.

Roll out to fixtures, staging copies, then an opt-in installation cohort before broad release. Gate expansion on parity, reconciliation, error rates, latency and accessibility evidence. Keep operational metrics game-scoped and free of collection content. Set quantitative budgets during phase 0. Assign release and rollback owners before deployment.

Physical location tracking, per-stack copies and deck checkout are useful Bindarr-inspired follow-ups. Image embedding recognition is another independent project with model licensing, resource and accuracy requirements. These are not prerequisites for TCG unification; introducing them during parity work would obscure regression and migration review. The new contracts should permit such additions without speculative implementation now.
