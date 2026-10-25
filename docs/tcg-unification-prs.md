# Incremental TCG unification PR plan

Status: proposed, 25 October 2026. These identifiers are planning IDs, not GitHub PR numbers. Parent: [TCG unification plan](tcg-unification-plan.md).

Implementation started: U01 is in progress; see the [baseline inventory and outstanding gates](tcg-unification-baseline.md). Later PRs remain proposed.

## Merge and release rules

Every PR leaves both Pokémon and Magic usable. New abstractions initially coexist with compatibility adapters; callers move only after their prerequisites pass. Preserve one authoritative write path throughout. A read/UI rollout switch must not select a second independent writer. Legacy URLs and exported formats remain supported.

Each implementation PR includes its tests and documentation. Run lint, typecheck, affected unit/integration suites and build; run browser checks for changed journeys and dependency auditing when dependencies change. Final release candidates run the full parent-plan gates. Record pre-existing failures separately; they do not excuse new failures. No runtime changes are implied by this planning document.

Each PR description must state its observable outcome, dependencies, data impact, security/accessibility considerations, validation evidence and rollback behavior. Require specialist review for changes to authorization, persisted identity, migration and interactive accessibility. Documentation-only PRs need link/content checks rather than application tests.

Dependencies below are minimum merge prerequisites. The numbered order is a safe default. Independent work may proceed on separate branches, but no PR should absorb unrelated work merely because it shares a phase.

## Overview

| ID | PR title | Depends on |
| --- | --- | --- |
| U01 | Record behavior, data and accessibility baseline | — |
| U02 | Define identity and compatibility architecture decisions | U01 |
| U03 | Add lossless card and collectible-variant contracts | U02 |
| U04 | Add extensible completion measures | U03 |
| U05 | Formalize module capabilities and rules context | U03 |
| U06 | Adapt Pokémon deck and scan rules | U05 |
| U07 | Centralize provider registration and ID dispatch | U03, U05 |
| U08 | Implement normalized Pokémon catalogue adapter | U04, U07 |
| U09 | Introduce collection repositories and common reads | U03, U04, U08 |
| U10 | Centralize authorized collection commands | U09 |
| U11 | Expose shared Pokémon API and legacy compatibility routes | U06, U10 |
| U12 | Add game-scoped client state and accessible primitives | U11 |
| U13 | Unify collection and wishlist screens | U12 |
| U14 | Unify search and set checklists | U12, U04 |
| U15 | Unify card-detail controllers and variant editing | U13, U14 |
| U16 | Unify graded/sealed workflows and private photos | U15 |
| U17 | Unify lists, deck editing and precon integration | U12, U06 |
| U18 | Unify scanning with manual alternatives | U14, U06 |
| U19 | Consolidate import/export and data settings | U11, U12 |
| U20 | Consolidate public sharing and scoped photos | U16, U17 |
| U21 | Dispatch catalogue/price jobs and histories through adapters | U08, U10 |
| U22 | Complete application-shell cutover | U13–U21 |
| U23 | Verify recovery, security, accessibility and extension readiness | U22 |
| U24 | Retire superseded implementations and publish final guides | U23 |
| M01 | Decide whether storage consolidation is justified | U23 |
| M02 | Add target schema and resumable migration tooling | M01, if proceeding |
| M03 | Rehearse reconciliation, cutover and recovery | M02 |
| M04 | Enable verified storage cutover | M03 |
| M05 | Retire obsolete storage after retention window | M04 + release evidence |

U24 does not depend on the optional M track. Retained legacy repository adapters are a valid final architecture when their storage remains authoritative.

## Foundation

### U01 — Record behavior, data and accessibility baseline

- **Scope:** add a feature/field/route matrix covering both games; synthetic historical database/export fixtures; reproducible performance scenarios and existing accessibility findings. Include private/public photos, printing reassignment history, receipts, revisions, deletion markers and recovery material.
- **Acceptance:** each supported workflow has an owner, expected behavior and test or explicit test gap. Record existing test results and quantitative performance budgets. Fixtures contain no production personal data.
- **Validation/docs:** validate fixtures against the existing app; record semantic manifests with counts, values and relationships. Document baseline environment and supported upgrade/import versions.
- **Data/rollout:** no production behavior or schema changes.

### U02 — Define identity and compatibility architecture decisions

- **Scope:** ADRs for playable identity, physical variants, ownership keys, provider IDs, rule context, repository boundaries and export compatibility. Map every persisted field to its intended representation. Pin external design references.
- **Acceptance:** existing Pokémon IDs and Magic card/finish pairs have lossless mappings; unknown/ambiguous records have explicit handling; no requirement to infer set membership from IDs. Define the strategy for additive contract versions and compatibility adapters.
- **Validation/docs:** walk adversarial fixture examples through the proposed mappings. Document dependency rules and removal criteria for compatibility paths.
- **Data/rollout:** design only; unresolved mapping decisions block U03.

### U03 — Add lossless card and collectible-variant contracts

- **Scope:** introduce typed game details and variant identities alongside existing contracts. Preserve finish, size, edition, stamps, treatment, evidence, aliases, coverage and classification version. Adapt Magic's current shape without changing its public IDs or stored records.
- **Acceptance:** conversions preserve all U02 fixture semantics. Collection keys cannot collapse distinct physical variants. Price references target the correct variant and language.
- **Validation/docs:** unit and round-trip tests for conflicting evidence, unfamiliar finishes, missing values and aliases; document identity examples. Existing consumers continue through compatibility projections.
- **Data/rollout:** additive types/adapters only; no backfill or externally visible format change.

### U04 — Add extensible completion measures

- **Scope:** stable named measures and coverage/uncertainty metadata; adapt Pokémon's existing classifier/progress functions and Magic's completion policy. Preserve compatibility projections for existing UI.
- **Acceptance:** Pokémon Base/Full/Master/All and Magic's measures match baseline, including graded participation, extras, incomplete catalogues and zero-slot checklists.
- **Validation/docs:** table-driven and order-invariance tests; update extension guide and completion examples. Do not rewrite classifier algorithms in this PR.
- **Data/rollout:** derived reads only; retain original stored evidence.

### U05 — Formalize module capabilities and rules context

- **Scope:** separate module implementations from registry wiring; pair capabilities with required handlers; add explicit format/admin-settings context and typed presentation slots. Keep the current Pokémon compatibility module explicit until U06 installs its handlers.
- **Acceptance:** invalid new modules fail registry validation; unsupported operations produce controlled errors; a minimal third-game fixture works without deck/scanning handlers.
- **Validation/docs:** registry and capability-absence tests, Magic contract tests and module-author checklist. Existing application registration remains valid at every merge.
- **Data/rollout:** no persisted changes or feature removal.

### U06 — Adapt Pokémon deck and scan rules

- **Scope:** wrap existing PTCGL parsing/formatting, ownership, legality, analysis and scan parser through the module contract; add formats and configured regulation/ban-list context.
- **Acceptance:** preserve Standard/Expanded/Unlimited behavior, basic Energy exceptions and eligible reprint ownership; unknown legality maps to unverified. Scan candidates preserve required set/number information.
- **Validation/docs:** deterministic fixture suites for both games, import/export round trips, unknown cards, configurable rules and scan ambiguity. Document intentional differences between copy-limit grouping and playable identity.
- **Data/rollout:** existing pages remain on their current paths until later UI PRs.

### U07 — Centralize provider registration and ID dispatch

- **Scope:** server provider factories and capabilities, centralized language/configuration policy, stored-reference dispatch and reusable request safeguards. Move Magic behind this boundary first.
- **Acceptance:** stored IDs resolve independently of today's selected provider. Pagination, redirects, timeouts, response limits, host allowlists and cache visibility are explicit. Keep vendor syntax within adapters.
- **Validation/docs:** provider contract and hostile-response tests; configuration-switch and cache tests; security/provider guide updates.
- **Data/rollout:** retain existing caches and response compatibility; no provider switch by default.

### U08 — Implement normalized Pokémon catalogue adapter

- **Scope:** adapt existing catalogue/cache/printing services for sets, search, details, set cards and deck resolution. Preserve detailed versus summary data and exact quote provenance.
- **Acceptance:** Pokémon and Magic satisfy the same provider suite; partial responses cannot erase better cached evidence or prices. Historical Pokémon IDs remain valid.
- **Validation/docs:** multilingual, outage, stale-cache, paging, partial-detail and malformed-upstream fixtures; verify request counts and pricing against baseline.
- **Data/rollout:** reuse current authoritative catalogue storage; expose adapter internally before routing users to it.

## Common services

### U09 — Introduce collection repositories and common reads

- **Scope:** repository interfaces and implementations over existing Pokémon/generic tables; shared state and valuation projections. Include repository seams for photos/history, with endpoint consolidation in later PRs.
- **Acceptance:** both implementations pass one contract suite. Field-by-field differential fixtures preserve quantities, timestamps, notes, manual values, purchase currencies and references. No game-prefix assumption rejects legacy IDs.
- **Validation/docs:** real SQLite read tests, query-count and large-collection budgets, immutable expected manifests and repository contract documentation.
- **Data/rollout:** read-only comparison; existing writes remain authoritative.

### U10 — Centralize authorized collection commands

- **Scope:** common validation and command services for entries, wishlist, notes, graded/sealed and lists. Move existing endpoint implementations onto them without changing public request shapes. Repository writes run inside existing mutation transactions.
- **Acceptance:** one authoritative writer per operation; server-derived authorization, revision checks, CSRF and durable receipts are preserved. No capability flag substitutes for authorization.
- **Validation/docs:** cross-user/collection/game denial, atomic batches, conflicts, retry replay, rollback-on-error and deletion tests through current endpoints. Document transaction ownership.
- **Data/rollout:** no table migration. Reverting service code is safe only while request/storage semantics remain compatible; explicitly check that condition.

### U11 — Expose shared Pokémon API and legacy compatibility routes

- **Scope:** enable Pokémon in shared catalogue/state/command routes; translate old routes into the same services. Validate ownership by catalogue/game scope rather than only ID prefix.
- **Acceptance:** equivalent operations through either API produce equivalent persisted state and security outcomes; existing clients/bookmarks still work. Unsupported endpoints fail predictably.
- **Validation/docs:** API parity tests, mixed endpoint retry/conflict cases and error contracts. Document compatibility endpoints and deprecation criteria without removing them.
- **Data/rollout:** additive API exposure; continue using existing tables and one writer.

## Incremental UI cutover

### U12 — Add game-scoped client state and accessible primitives

- **Scope:** common query/command context, account/collection/game/language cache scoping, mutation error handling and read/UI rollout mechanism. Audit reusable dialogs, quantity inputs, notifications and card layouts before reuse.
- **Acceptance:** stale responses cannot cross account or game boundaries; pending edits survive recoverable failures; focus and live-region behavior are defined. Existing pages continue to run.
- **Validation/docs:** race/unmount/switching tests and keyboard/dialog tests; document query keys, refresh ownership and primitive accessibility contracts.
- **Data/rollout:** client infrastructure only; read/UI switch never redirects writes to a second writer.

### U13 — Unify collection and wishlist screens

- **Scope:** move Pokémon collection/wishlist to shared controllers; preserve sorting, filtering, quantities, binder/grid preferences and empty/error states for both games.
- **Acceptance:** old URLs and preferences work; keyboard access and reading order are maintained in binder views; totals match baseline.
- **Validation/docs:** both-game browser journeys, failed-save retention, responsive checks, axe and manual keyboard checks. Update the feature matrix.
- **Data/rollout:** independently enable these screens; retain old controllers until U24.

### U14 — Unify search and set checklists

- **Scope:** shared search/set pages using provider fields, module completion measures and language-scoped catalogue coverage. Preserve URL filters, debounce and existing set links.
- **Acceptance:** the same holdings yield the same completion; additional/unresolved variants remain visible; missing data is clearly distinguished from empty results.
- **Validation/docs:** both-game search/checklist tests, URL reload/deep links, live-region behavior, keyboard selection and narrow-screen reflow.
- **Data/rollout:** screen-level enablement; no new catalogue policy.

### U15 — Unify card-detail controllers and variant editing

- **Scope:** use the existing shared layout with common controllers; Pokémon/Magic content slots; variant selection, notes, purchases, prices and history presentation.
- **Acceptance:** every existing Pokémon physical variant remains independently editable; prices and images retain provenance; no loss of manual valuations or printing explanations.
- **Validation/docs:** both-game fixture/browser tests, geometry checks, accessible symbol text, focus restoration and failed edits; document content-slot examples.
- **Data/rollout:** preserve variant keys and card URLs; independently enable the new controller.

### U16 — Unify graded/sealed workflows and private photos

- **Scope:** common dialogs/controllers and private photo services; retain certificate metadata, completion participation, sealed status, PriceCharting identity rules and photo references.
- **Acceptance:** metadata edits preserve photos; identity changes invalidate only incompatible price links; private photo authorization is enforced at every read/write.
- **Validation/docs:** photo integrity and access-denial integration tests, slab/sealed browser journeys, dialog focus/errors and keyboard upload controls.
- **Data/rollout:** no photo relocation or rekeying. Public share photo paths remain unchanged until U20.

### U17 — Unify lists, deck editing and precon integration

- **Scope:** common list/deck controllers driven by module rules; preserve Pokémon PTCGL and Magic Commander/precon flows, unresolved-card preview and ownership reports.
- **Acceptance:** drafts remain saveable; legal/illegal/unverified results remain accurate; precon creation creates neither holdings nor sealed products. Preserve quantity blur/Enter/Escape behavior.
- **Validation/docs:** both-game deck/import browser journeys, rule-context changes, missing-card resolution and keyboard editing tests; update deck adapter guide.
- **Data/rollout:** preserve deck/list IDs and rows; no checkout/reservation feature added.

### U18 — Unify scanning with manual alternatives

- **Scope:** common scanning controller with game-specific parser/resolution; preserve on-device OCR and explicit variant choice.
- **Acceptance:** supported games retain current scan behavior; unsupported games show no dead controls; manual lookup offers the same add workflow without camera access.
- **Validation/docs:** parser fixtures, denied/unavailable camera, ambiguous candidates, keyboard candidate selection and accessible progress/errors. Use deterministic camera/OCR stubs in CI.
- **Data/rollout:** no new image-recognition service or model dependency.

## Supporting workflows

### U19 — Consolidate import/export and data settings

- **Scope:** common import/export services and settings UI with existing version-7 and supported historical Pokémon/CSV readers. Add a new export version only if the field matrix proves it necessary.
- **Acceptance:** round trips preserve all supported fields and stable IDs; repeated imports remain idempotent; catalogue payloads never poison trusted caches. Preflight all limits before provider hydration.
- **Validation/docs:** historical fixtures, worker/admission limits, malformed inputs, atomic conflicts, semantic manifests and accessible preview/error reports. Update format and recovery documentation.
- **Data/rollout:** compatibility readers stay available; no automatic conversion of users' export files.

### U20 — Consolidate public sharing and scoped photos

- **Scope:** one privacy projection for public pages and photo authorization; shared UI for both games while retaining legacy share defaults/links.
- **Acceptance:** expiry, revocation, audience, collection, game, language and set/list scope apply identically to records and photos. Private notes/values are exposed only under existing policy.
- **Validation/docs:** negative scope matrix, revocation-after-load, photo access and redaction tests; screen-reader/keyboard public journeys; update threat model.
- **Data/rollout:** preserve tokens and references; remove old projections only after differential comparison passes.

### U21 — Dispatch catalogue/price jobs and histories through adapters

- **Scope:** register provider job capabilities, tracked-card discovery and valuation/history operations; keep provider-specific bulk algorithms isolated. Adapt history API reads while preserving existing response compatibility.
- **Acceptance:** each tracked item refreshes through its correct provider; missing quotes stay missing; stale fallback does not mark a failed refresh fresh. Staged catalogue publication remains atomic.
- **Validation/docs:** outage, timeout, interrupted pagination/import, storage pressure and repeated-job tests; performance budgets and operational runbooks. Check retention and historical attribution.
- **Data/rollout:** retain existing history tables; prevent old/new schedulers running duplicate jobs during deployment.

## Completion and release

### U22 — Complete application-shell cutover

- **Scope:** switch default routes, navigation, search entry points, totals and settings/sharing to common controllers; remove unconditional Pokémon store bootstrapping once unused. Retain legacy URL aliases.
- **Acceptance:** both games use the shared application path; navigation, reloads, pending edits and account switches work; no hidden dependency on the legacy Pokémon store.
- **Validation/docs:** full browser journey matrix, stale-request tests, bundle/performance comparisons and end-to-end keyboard navigation. Document rollout switches and reversion procedure.
- **Data/rollout:** initially opt-in, then default after recorded acceptance. UI fallback uses the same authoritative services.

### U23 — Verify recovery, security, accessibility and extension readiness

- **Scope:** close cross-cutting gaps discovered by tests/review; add a minimal third-game end-to-end fixture; run final release-candidate rehearsals. This consolidates evidence; security and accessibility work already belongs in each preceding PR.
- **Acceptance:** backup/restore includes every game's records/photos; no critical behavior-matrix gaps; security threat cases pass; manual WCAG 2.2 AA review is recorded; third-game supported workflows need no new shared-code game branches.
- **Validation/docs:** full lint/typecheck/test/build/dependency/browser gates, printing audit, crash/recovery/backup rehearsals and applicable deploy checks. Record measured budgets, manual review platforms and unresolved limitations.
- **Data/rollout:** staging and opt-in cohort evidence precedes broad release. Assign rollout/recovery owners.

### U24 — Retire superseded implementations and publish final guides

- **Scope:** remove unused page controllers, duplicate service logic and temporary differential reads after successful rollout. Retain legacy repository adapters, URL aliases and supported import readers where still required.
- **Acceptance:** no live consumer uses removed code; all routes and recovery paths pass. Update architecture, extension/provider guides and compatibility inventory to reflect the shipped implementation.
- **Validation/docs:** full affected suites plus dependency/import-boundary checks; document retained compatibility code and exact future removal conditions.
- **Data/rollout:** no destructive SQL or source-data deletion. Retirement waits for agreed cohort/observation evidence from U23.

## Optional storage migration track

### M01 — Decide whether storage consolidation is justified

- **Scope:** compare continued adapter-backed storage against a unified schema using actual maintenance costs, field coverage and measured performance. Specify the schema and migration invariant manifest only if proceeding.
- **Acceptance:** decision records benefits, costs, supported upgrade paths, concurrent-write strategy and recovery of post-cutover writes. No field may disappear silently.
- **Validation/docs:** review every baseline field and relationship; update ADR and migration runbook. A decision to retain current tables completes this track.

### M02 — Add target schema and resumable migration tooling

- **Scope:** additive target tables/indexes, deterministic mappings, bounded batch journal, dry-run reports and backfill tools. Preserve public IDs; internal surrogate keys must not leak into existing links/exports.
- **Acceptance:** source remains authoritative; interrupted/repeated backfills preserve exactly-once effects and explicit unknowns. Ambiguous mappings block cutover and remain losslessly retained.
- **Validation/docs:** synthetic historical upgrades, failure injection, disk reserve, foreign-key checks and per-record semantic digests. No destructive schema operations.

### M03 — Rehearse reconciliation, cutover and recovery

- **Scope:** implement and exercise final write pause, delta reconciliation, source/target manifest comparison, verified complete backup and restoration/forward-repair procedures.
- **Acceptance:** quantities, identities, metadata, histories, photos, membership and receipts reconcile. Demonstrate recovery of writes made after simulated cutover; an old backup by itself is insufficient.
- **Validation/docs:** crash at each transition, disk-full failures, repeated startup, concurrent request drain and recovery rehearsal on representative datasets. Record downtime/resource budgets.

### M04 — Enable verified storage cutover

- **Scope:** install the target repository implementation and controlled cutover procedure. Keep source tables and migration journal through the retention window; prevent stale-source writes.
- **Acceptance:** final reconciliation succeeds before reopening writes; authoritative repository selection is durable and restart-safe. Older binaries reject unsupported schemas.
- **Validation/docs:** full migration/integration/browser/recovery gates and opt-in cohort report; explicit rollback/forward-repair decision points.
- **Data/rollout:** production migration follows the release runbook and required deployment authorization; merging tooling does not itself migrate production data.

### M05 — Retire obsolete storage after retention window

- **Scope:** remove old storage only after the retention period, broad-rollout evidence and verified recovery backups meet documented criteria. Maintain an upgrade path for installations that skipped intermediate releases.
- **Acceptance:** no active reader/writer references obsolete tables; remaining exports/backups stay interpretable; preservation manifest is archived.
- **Validation/docs:** upgrade from every supported starting version, restore rehearsal and destructive-migration review. Ship separately from M04; no automatic cleanup merely because first cutover succeeded.

## Practical merge batches

1. **Foundation:** U01–U08. Produces tested contracts/adapters with current user workflows intact.
2. **Server convergence:** U09–U11. Shared APIs work against existing data with one write path.
3. **Client migration:** U12–U18. Enable one workflow at a time; U13/U14/U17 can be developed independently after prerequisites.
4. **Workflow completion:** U19–U21 can proceed alongside ready client PRs, subject to listed dependencies.
5. **Release and retirement:** U22–U24. Verify complete parity before deleting old implementations.
6. **Optional persistence project:** M01–M05, with separate release and destructive-cleanup gates.

If a PR grows beyond one reviewable responsibility, split it into additive adapter introduction followed by caller migration, keeping tests/docs with each. Do not split validation or security enforcement into a later follow-up. Physical locations, deck checkout and image-embedding scanning remain separate feature projects after unification.
