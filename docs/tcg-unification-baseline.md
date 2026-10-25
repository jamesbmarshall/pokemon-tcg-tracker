# U01: TCG unification baseline

Status: in progress, 25 October 2026. This inventory describes existing behavior, not promised new functionality. No production schema or records have changed. Owners below identify code responsibility, not assigned individuals.

## Behavior inventory

| Workflow / invariant | Current owner | Existing evidence | Target owner / retirement prerequisite |
| --- | --- | --- | --- |
| Pokémon physical printing identity, evidence and aliases | shared `printings.ts`, `printingRules.ts`; server `printingCatalog.ts`, `cards.ts` | shared printing tests; server `printing-catalog.test.ts` | game adapter; U03/U08 lossless mapping |
| Base/Full/Master/All; additional and unresolved slots | shared `completion.ts` | new `completion.test.ts` synthetic counts | completion policy; U04 parity |
| Pokémon catalogue and language resolution | shared/server `catalog.ts` | `catalog.test.ts`, `catalog-resilience.test.ts` | provider adapter; U08 |
| Magic identities, faces, finishes and absent quotes | shared `tcg/scryfall.ts` | `tcg/tcg.test.ts` | provider adapter; U03/U07 |
| Collection quantities, notes and wishlist | server `collections.ts`; web `collectionStore.ts`; server `tcg/state.ts` | server `collections.test.ts`, `tcg.test.ts`; store tests | repositories/commands; U09/U10 |
| Paid currencies, manual values and FX | shared `value.ts`, `valuation.ts`, `tcg/collection.ts` | shared value/valuation tests | valuation projection; U09 |
| Grading, sealed products and linked prices | server collection/sealed routes and TCG routes | `sealed.test.ts`, `pricecharting.test.ts`, `tcg.test.ts` | commands/UI; U16 |
| Photos and stable metadata references | server `photoStorage.ts`, collection/TCG routes | `photo-storage.test.ts`, `tcg.test.ts` | photo repository; U16/U20 |
| Pokémon deck legality and ownership | shared `decks/legality.ts`, `ownership.ts`, `ptcgl.ts` | corresponding shared tests; server `decks.test.ts` | game rules; U06/U17 |
| Commander legality and deck text | shared `tcg/commander.ts`, `deckText.ts` | `tcg/tcg.test.ts` | game rules; U05/U17 |
| Precon preview, resolution and cloning | server/web `tcg/precons` | server `precons.test.ts`, browser `precons.spec.ts` | shared workflow; U17 |
| OCR/manual lookup | shared `scan.ts`, server scan routes | shared scan tests; `scan-lookup.test.ts` | parser/controller; U06/U18 |
| Legacy Pokémon imports and ID remapping | shared `migrate.ts`; server collections import | `migrate.test.ts`, `import-legacy.test.ts` | compatibility readers; U19 |
| Export version 7, repeated imports and future rejection | server collection/TCG routes | `export-roundtrip.test.ts`, `future-format.test.ts`, `tcg.test.ts` | export service; U19 |
| Membership, CSRF, revisions and durable retries | server context/collections, `mutations.ts`, `security.ts` | `security.test.ts`, `mutations.test.ts`, `concurrent-edits.test.ts` | application boundary; U10/U11 |
| Share language/game scope, redaction and revocation | server `shares.ts`, `tcg/state.ts` | `shares.test.ts`, `tcg.test.ts` | privacy projection; U20 |
| Price histories and job recovery | server `cards.ts`, `tcg/jobs.ts` | `price-history.test.ts`, `job-recovery.test.ts` | provider jobs; U21 |
| Complete backup, encryption material and restore | server backup/recovery services | backup/recovery tests and rehearsal scripts | retained recovery services; U23 |
| Legacy URLs, filters, binder preferences and game switching | web `App.tsx`, hooks, pages and `tcg` | `core.spec.ts`, `tcg.spec.ts`, store tests | shared controllers/shell; U12–U22 |
| Card geometry and automated accessibility | shared card layout and dialogs | `card-layout.spec.ts` (axe, desktop/phone) | common presentation; U12–U23 |

Existing evidence names locate relevant suites; they do not assert that every invariant is fully tested. Each caller migration must verify exact coverage before retiring its predecessor.

## Preservation manifest requirements

Compare records by collection/game and stable identity, not just totals. Preserve entry quantities and variant IDs; note/wishlist content; slab grade/company/certificate and completion eligibility; sealed type/status/language; list order, quantities, zones and format; purchase currency/amount; manual values; price/value histories and attribution; timestamps; printing evidence/raw records/version/aliases/reassignment history; photo byte digests and references; share scopes/tokens; memberships; deletion markers; durable receipts and revisions when affected. Secrets and photo contents must not enter reports.

Known compatibility behavior: Pokémon cross-collection deck imports currently remap list IDs (`export-roundtrip.test.ts`). Preserve that behavior through compatibility readers; do not assume all imports universally preserve list IDs. Historical card remapping can merge equivalent entry quantities. Ambiguous legacy matching needs an explicit U02 decision before stronger preservation claims.

## New deterministic fixture

`packages/shared/src/completion.test.ts` defines a synthetic three-card set with five physical slots sharing a finish: core, parallel, stamped additional, unresolved and secret. Literal expected results capture eligible completion, all-printing ownership, quantity independence, catalogue-order independence, partial coverage and empty denominators. It is independent of provider availability and contains no personal data.

Existing legacy import/export fixtures remain in the suites above. A comprehensive historical SQLite fixture matrix and independent record-level reconciliation manifest are still required before U01 can close; no migration is safe merely because completion fixtures pass.

### Historical database checkpoints

`apps/server/test/fixtures/tcg-baseline.ts` now constructs synthetic databases at schema versions 2, 6, 10 and 11 using the append-only migration history. These represent pre-sealed, pre-printing-policy, pre-multi-game and current installations. `tcg-baseline.test.ts` upgrades each file-backed database to the current schema, checks raw preserved rows plus independently specified semantic expectations, runs foreign-key/integrity checks, repeats migration, backs up through the actual worker and reopens the backup.

The fixtures include two physical variants with the same card ID, Unicode notes, GBP/EUR purchase amounts, manual values, revoked user-scoped shares, viewer membership, ordered deck rows, grading certificates with leading zeroes, tombstones, photo references, historical prices, printing change/reassignment evidence, import ID mappings and durable receipts where their schemas support them. Negative checks deliberately change quantities, evidence, photo references and receipts without changing row counts and verify that reconciliation notices.

These are schema checkpoints, not a claim that every supported historical schema/export combination is covered. They supplement existing schema-2/schema-6 tests and historical JSON readers. Fixtures use synthetic invalid credential placeholders and must never be served as production accounts. Database backup tests preserve photo references, not file bytes; the expanded complete-instance `recovery.test.ts` separately verifies simultaneous Pokémon/Magic records, tombstones, exact photo bytes, encryption material and live foreign keys after restoration.

## Outstanding baseline gates

The separate web run completed successfully: 68 files, 823 tests passed in 78 seconds. The duplicate web stage started by the root runner after stopping the launcher was terminated to avoid repeating that completed check. Browser acceptance tests and launcher tests remain unverified.

Follow-up validation after adding historical fixtures and mixed-game recovery assertions:

| Check | Outcome |
| --- | --- |
| `npm test -w @poketracker/server -- tcg-baseline.test.ts` | 5 passed |
| Migration/baseline/recovery selection before recovery extension | 13 passed across 4 files |
| `npm test -w @poketracker/server -- tcg-baseline.test.ts recovery.test.ts` after recovery extension | 11 passed across 3 files (selection also matches job recovery) |
| `npm run typecheck` and `npm run lint` | Passed after correcting the completion fixture's inferred map type |
| Chromium card-layout acceptance selection | Blocked before page rendering by `listen EPERM` on `127.0.0.1`; 1 failed, 3 not run |

The earlier typecheck success preceded creation of the completion test; the follow-up run found and corrected its type error. Browser execution requires an environment permitting local HTTP listeners. No accessibility outcome can be inferred from this blocked run. Re-run the full browser matrix and launcher in a suitable environment before closing those gates.

Initial automated run (25 October 2026): lint, typecheck and production build passed. The pre-change shared suite passed 139 tests; the new completion suite separately passed 3 tests. Server baseline passed 251 tests and failed 2 because Unix socket creation returned `listen EPERM` in `network-storage.test.ts` and `recovery-control.test.ts`. These are environment-blocked checks, not verified passes. The root run was stopped in the launcher stage after it produced no test results for over a minute; launcher baseline remains unverified. Web tests are run separately. Logs for this session are `/tmp/tcg-u01-{tests,types,lint,build,web}.log`; these are ephemeral, not release evidence artifacts.

- Run and record lint, typecheck, full unit/integration suites and build. Preserve command outcomes and pre-existing failures without labeling infrastructure failures as application regressions.
- Run isolated browser matrix and record browser versions. Existing axe checks cover selected journeys, not WCAG conformance.
- Manually audit keyboard, NVDA/Firefox and VoiceOver/Safari flows, 400% zoom, contrast, reduced motion and dragging alternatives. Not yet performed; no accessibility conformance claim is made.
- Create historical schema fixtures across supported upgrade paths, including mixed games, photos, tombstones and mutation receipts; verify restoration.
- Measure state loads/imports/jobs/backups at representative 1k/10k/20k-record datasets and record latency, peak memory, query/network counts and lock durations. Numerical budgets must follow measurement; not yet established.
- Assign human review/release owners and complete U02 ADR decisions before contract implementation.

U01 remains open until these gates have evidence. The source architecture and compatibility tests are the baseline; this document must evolve when new behavior is discovered.

## Follow-up: executable performance rehearsal and permission-enabled checks

Run `node --import tsx scripts/tcg-baseline.ts 1000` (or `10000`, `20000`) from the repository root. The script creates a disposable SQLite database, seeds that many owned card records **per game**, samples warm state projections, exports/imports into new collections and verifies a worker-created backup. Assertions check restored record counts, quantities and foreign keys. Fetch is replaced by a rejecting stub; network attempts are counted, never sent. Setup and measured-workflow attempts are reported separately. This is a cached/offline scenario, not a provider-throughput benchmark or a full preservation audit.

Initial [machine-readable measurements](tcg-baseline-performance.json) used Node 24.19.0 on Linux x64. Dataset processes ran concurrently, so these are exploratory values rather than stable latency budgets. At 20k records per game the observed state medians were about 166 ms for Pokémon and 153 ms for Magic; import times were 348 ms and 1,047 ms; database backup took 114 ms. Process high-water RSS was about 702 MiB, including setup/import/serialization allocations. Network attempts ranged from 1 to 3; every attempt was blocked. Do not call these zero-network workflows. Query counts, lock duration, isolated memory attribution, provider jobs and repeated sequential performance budgets remain outstanding.

Re-running the socket tests with sandbox network access enabled passed all 4 selected server tests (`network-storage` and `recovery-control`). The launcher suite also passed all 8 tests under those permissions. These resolve the earlier socket/launcher baseline blockers; browser diagnostics are recorded separately because browser runtime availability is a distinct prerequisite.

With network permissions enabled, Chromium reaches browser launch but cannot run because the Playwright Chromium executable is absent (`chromium_headless_shell-1248`). The full browser attempt likewise cannot establish acceptance results. Install the matching Playwright browsers and OS dependencies before rerunning the matrix; this PR makes no browser or manual accessibility conformance claim.

The [U02 decisions](tcg-unification-decisions.md) are prepared for review. They preserve public identity, distinguish physical variant from finish, keep rules and provider selection explicit, and retain compatibility readers and repository-backed legacy storage. U02 remains proposed while its baseline/review prerequisites are open.

## Sequential follow-up and working performance budgets

The performance harness now counts main-connection `Db.all/get/run` calls per state read and import. It seeds current printing-version snapshots to model genuinely cached Pokémon data; previous snapshots triggered background hydration. The standalone harness retains its rejecting fetch stub through shutdown, including deferred work. The sequential follow-up in the measurement JSON is authoritative for this cached scenario; the initial concurrent measurements remain for transparency.

At 20k records per game: Pokémon/Magic state medians were 98/119 ms, with 50/53 database calls (batched catalogue reads rather than one query per card). Imports took 392/1,062 ms with 20,109/20,173 calls, including per-record writes. Worker database backup took 106 ms; process high-water RSS was 658 MiB. All three dataset sizes completed with zero network attempts. SQL performed in workers and time spent holding SQLite locks are not instrumented.

Working budgets for the same local cached workload: state median at most 500 ms and sample maximum at most 1,000 ms; imports and database backup each at most 5 seconds; process high-water RSS at most 1 GiB; zero upstream attempts. Compare query counts with the recorded size-specific counts and investigate increases or per-card read queries. These are investigation thresholds, not universal hardware SLAs or automatic CI timing gates. Repeat sequential samples before concluding a regression; provider jobs, real catalogue diversity and lock-duration budgets still need their own scenarios.

After downloading Playwright browsers to `/workspace/.playwright-browsers`, all 16 Chromium acceptance tests passed (25.3 seconds) with local network permissions enabled, including axe, narrow-screen layouts, dialog keyboard focus, failed-write handling, game switching and precon journeys. Chromium build: Playwright v1248 (Chrome for Testing 156.0.8078.4). WebKit build v2370 downloaded, but host validation reports missing GTK4, Graphene, Harfbuzz ICU, Manette, Hyphen and GLES libraries. WebKit/mobile and manual screen-reader checks remain outstanding; Chromium automation does not establish WCAG conformance.
