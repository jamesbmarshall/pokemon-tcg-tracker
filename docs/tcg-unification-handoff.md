# TCG unification continuation handoff

Updated 26 October 2026. Read this before continuing in a fresh context.

## Goal and controlling documents

Unify existing Pokémon support with the extensible multi-TCG framework, incorporating
useful Bindarr ideas while preserving data and existing behavior. Priorities: coding
standards, documentation, security, meaningful unit/integration tests, accessibility,
and migrations only where necessary. Work in incremental logical PRs.

- [Full architecture plan](tcg-unification-plan.md)
- [Incremental U01–U24 PR plan and optional M01–M05 storage track](tcg-unification-prs.md)
- [Architecture decisions](tcg-unification-decisions.md)
- [Lossless field mapping](tcg-field-mapping.md)
- [Baseline and outstanding release gates](tcg-unification-baseline.md)
- [Developer extension guide](multi-game.md)

The user has authorized implementation, commits and pushes. Most recently they
asked to address PR #70's recommended changes before continuing. The first three
fixes were pushed; a second review identified unnecessary ownership work across
unrelated catalogue cards, addressed in the follow-up accompanying this note.
No new UI cutover, schema migration or production-data mutation
has been performed in this work.

## Branch and PR stack

Repository: `jamesbmarshall/pokemon-tcg-tracker`, workspace
`/workspace/pokemon-tcg-tracker`. Current branch: `codex/tcg-provider-registry`.
Initial base: `8da7d5b` (PR #64 merge). Each PR targets the preceding stack branch.
The stack has not been merged during this session; verify current remote state on resume.

| Plan | Branch | Latest implementation commit | PR |
| --- | --- | --- | --- |
| U01 | `codex/tcg-unification-baseline` | `4236145` | [#65](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/65) |
| U02 | `codex/tcg-identity-decisions` | `2995bda` | [#66](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/66) |
| U03 | `codex/tcg-variant-contracts` | `f66b301` | [#67](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/67) |
| U04 | `codex/tcg-completion-measures` | `61406e3` | [#68](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/68) |
| U05 | `codex/tcg-module-validation` | `ad05187` | [#69](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/69) |
| U06 | `codex/pokemon-rule-adapters` | `90e3a77` | [#70](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/70) |
| U07 | `codex/tcg-provider-registry` | `613e5ba` | [#71](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/71) |

U07 originally branched from U06's `c221c02`; merge `1dcce32` now incorporates all U06 review fixes and this handoff. Its initial
push failed authentication; a later retry was interrupted. Publication subsequently
succeeded on 26 October: PR #71 targets `codex/pokemon-rule-adapters`. The explicit U06 push succeeded: `c221c02..90e3a77` on the remote branch.

## Implemented work

- U01: preservation fixtures, baseline docs, sequential performance harness and
  Chromium acceptance checks. Outstanding checks below remain gates.
- U02: identity decisions and field-by-field preservation contract. Additive work
  may proceed, but affected caller cutovers/release still require baseline gates.
- U03: lossless collectible variants, compatibility alias for `CardPrinting`,
  typed Pokémon details and projections. Existing storage and keys retained.
- U04: named completion measures separate completion, coverage and uncertainty;
  existing callbacks remain compatible.
- U05: source-owned module definitions, registry/capability validation and explicit
  rule context. Pokémon controller compatibility remains intentional.
- U06: Pokémon format validation, PTCGL parse/export, format-aware ownership,
  analysis and OCR adapters. Rule snapshots are not persistent-card converters.
- U07 (local branch): provider registry separates configurable catalogue selection
  from stored card/set ID ownership. Rejects ambiguity, isolates games and passes
  language to factories. Magic routes/jobs use it; existing Scryfall transport,
  caching and safeguards remain. Pokémon registration is U08 work.

### PR #70 review fixes

All three Copilot findings were valid and fixed in `90e3a77`:

1. Explicit Expanded bans inspect requested main-deck IDs even when details are
   missing/incomplete; known cards do not generate duplicate ban issues.
2. PTCGL export validates each row against the actual shared parser. Missing
   identifiers, unrepresentable numbers such as `SV045`, and injected rows fail
   with `invalid_deck_export`. The existing one-to-four-character collector-number
   grammar was deliberately not expanded. Valid lowercase set codes normalize.
3. Unknown format eligibility marks ownership groups unverified while excluding
   those copies from verified ownership. Unlimited and explicit legal/illegal
   flags retain their existing semantics.

The reviewer subsequently resolved those three threads. A fourth recommendation
identified full eligibility checks for unrelated catalogue cards. The follow-up
filters to valid main-deck names before projecting details, retains all matching
reprints, and returns immediately for an empty main deck. Regression tests verify
that unrelated detail getters and empty-deck catalogue iteration are not invoked.
No review reply was posted and threads were not manually resolved; check subsequent
review/CI and verify the latest remote commit on resume.

## Validation evidence and limits

- U06 original implementation: 179 shared tests, 35 selected server tests,
  typecheck, lint and production build passed.
- U06 review follow-up: 191 shared tests, including 28 Pokémon adapter cases,
  typecheck and lint passed. An attempted server rerun was interrupted; no new
  server/build result is claimed for the follow-up.
- U06 second review follow-up: 193 shared tests, including 30 Pokémon adapter
  cases, typecheck, lint and production build passed after limiting ownership
  catalogue work.
- U07 before review fixes: 41 provider-registry/TCG/precon server tests, typecheck,
  lint and production build passed. Recheck affected tests after incorporating U06.
- Through U05: full run passed 163 shared, 258 server, 8 launcher and 823 web tests;
  all 16 Chromium acceptance journeys passed. These are historical results, not
  a full-suite run of the latest commit.
- WebKit/mobile host-library dependencies remain unavailable. Manual screen-reader
  review, extended job/lock performance measurements and final review remain open.
  Do not label those checks passed or waived.

## Resume sequence

1. All four PR #70 review threads were resolved by the reviewer as of 26 October. Inspect worktree, current review/CI and branch publication state. Complete
   any new legitimate review fixes before advancing.
2. U06 is already merged into U07 (`1dcce32`). Do not repeat that work. The merged
   branch passed 57 selected server tests, 193 shared tests, typecheck, lint and
   production build. Check publication state before creating a duplicate PR.
3. U07 is published as PR #71 targeting `codex/pokemon-rule-adapters`. Inspect
   review/CI and address legitimate findings before advancing; do not create a duplicate.
4. Begin U08 on a new branch from U07: normalized Pokémon catalogue adapter using
   existing authoritative catalogue/cache/printing services. Preserve historical
   IDs, multilingual behavior, detailed versus summary evidence, quote provenance,
   stale fallback and cache quality. Add contract and hostile-response fixtures.
5. U09 repositories/common reads, U10 authorized commands, U11 shared API and then
   the later UI/import/sharing/jobs phases follow the incremental plan. Optional
   storage consolidation is not a prerequisite for a successful unification.

U08 has not been implemented. Relevant starting files are
`apps/server/src/providers/tcgdex.ts`, `apps/server/src/cards.ts`,
`packages/shared/src/catalog.ts`, `packages/shared/src/languages.ts`,
`packages/shared/src/tcg/types.ts` and `tcg/variants.ts`. The existing shared
catalogue client has process-level configuration/caches; inspect its isolation
before introducing adapter instances. `saveSnapshots` has preservation and alias
reassignment behavior: do not casually invoke it from new read-only projections.
Keep Pokémon generic routes behind the existing compatibility boundary until U11.

## Environment notes

Read the cloud-environment runtime skill on resume. Networked Git and server tests
that bind local sockets need network permission in this sandbox. Plain Git has no
credential helper configured; this command successfully pushed the U06 fix using
the existing environment credential, without exposing its value:

```sh
git -c credential.helper='!gh auth git-credential' push origin codex/pokemon-rule-adapters
```

Use the execution tool's additional network permission for that command. An
interrupted tool call is not proof of completion: inspect processes, sessions,
logs and remote state before claiming success or launching duplicate work.
Chromium is installed under `/workspace/.playwright-browsers`; set
`PLAYWRIGHT_BROWSERS_PATH` accordingly if browser checks are needed.
