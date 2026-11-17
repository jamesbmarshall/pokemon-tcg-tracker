# Improvement plan: prioritised and assigned by model

Status: proposed, 16 November 2026. Nothing here has been implemented. It comes from a read-through of the server, shared package and web client. The tests, type-check and build were not run during that review, so every efficiency item is a reading of the code, not a measurement. Task T1 exists to fix that.

Each task below is a self-contained brief: an agent starting cold should be able to pick one up without reading the others.

## How the models are assigned

| Model | ID | Price per MTok (in / out) | Used here for |
|---|---|---|---|
| Fable 5.2 | `claude-fable-5-2` | $8 / $40 | Changes where a subtle mistake loses data or weakens security, and the design is not yet settled |
| Opus 5.5 | `claude-opus-5-5` | $4 / $20 | Multi-file changes that need judgement about existing invariants |
| Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 | Well-specified changes in one or two modules |
| Haiku 5.5 | `claude-haiku-5-5` | $0.10 / $0.50 | Mechanical edits where the brief names the exact line and the expected result |

Assignments are judgement by task shape (blast radius, ambiguity, how many invariants are in play). They are not measured on this repository. Two cautions:

- A cheaper model that needs a second attempt is not cheaper. If a task bounces once, move it up a tier instead of retrying.
- For a codebase this size the cost difference between tiers is small. The review gate matters more than the implementer.

Suggested effort: Fable `high`, Opus `high` (its default is `medium`, so set it), Sonnet `medium`, Haiku default.

**Review rule.** No task is reviewed by the model that wrote it. Tasks marked *security* are reviewed by Fable 5.2 and then by a person. Everything else is reviewed one tier above the implementer.

**Rules for every task.** One PR per task. No behaviour change beyond the brief. Add or update a test that fails before the change. Run `npm run lint`, `npm run typecheck` and `npm test` and paste the result in the PR. Do not skip or weaken a test to get green.

## Decisions only the maintainer can make

These block the tasks named, and no model should decide them.

1. **Lockfile registry.** 328 lockfile entries resolve to `ms-feed-25.pkgs.visualstudio.com` (deliberate, commit `6f3313e`). Agents in an environment that cannot reach that host cannot run `npm ci`. Either allow the host in the agent environment or normalise the lockfile to `registry.npmjs.org`. Blocks everything, because no task can be verified without an install.
2. **Backup passphrase.** Whether synced and downloaded backup packages may be encrypted with an owner-supplied passphrase, accepting that a lost passphrase makes the backup unrecoverable. Blocks T12.
3. **Branding.** Whether the product keeps the PokéTracker name now that it tracks Magic too. Blocks D7.
4. **Unification scope.** Whether `docs/tcg-unification-plan.md` goes all the way to the UI, or stops at the server repository boundary until a third game is planned. Blocks T19 onward being more than local tidying.

## Priority 0: unblock and measure

### T0. Make the agent environment able to build (maintainer, then Haiku 5.5)
The environment needs Node 24 (`.nvmrc`) and a working `npm ci`. Once decision 1 is made, if the answer is to normalise: rewrite the `resolved` URLs to `registry.npmjs.org`, confirm `npm ci` passes with integrity checks intact, and add a CI step that fails on any other registry host. Done when a fresh checkout installs and `npm test` runs.

### T1. Baseline timings (Sonnet 5.5)
Extend `scripts/tcg-baseline.ts` (or add a sibling) to seed a 10,000-entry Pokémon collection with 50 graded slabs and photos, then time: `GET /api/collections/:id/state`, `POST .../entries/adjust`, `GET .../movers`, and a public share page that loads every slab photo. Write the numbers to `docs/` next to `tcg-baseline-performance.json`. Done when the script runs in CI-sized time and the numbers are committed. Every performance task below quotes before and after from this script.

## Priority 1: small, high-value fixes

### T2. Count failed second-factor attempts toward account lockout (Opus 5.5, *security*)
`apps/server/src/auth.ts:351`. The only limit on `/api/auth/mfa` is an in-memory limiter of 10 tries per 5 minutes, which resets on restart. Someone who already has the password gets about 2,880 guesses a day against three valid codes. Make failed codes increment the same persisted `failed_logins` / `locked_until` counters the password step uses (`auth.ts:320-331`), and refuse the MFA step while locked. Keep the response identical for wrong code and locked account. Done when a test shows the ninth wrong code locks the account across a simulated restart.

### T3. Throttle the password-confirmation endpoints (Sonnet 5.5, *security*)
`auth.ts:448` (TOTP disable), `auth.ts:458` (recovery codes) and `auth.ts:687` (ownership transfer) verify the account password with no limit, so a stolen session can guess it indefinitely. Apply the same per-user limiter that password change uses at `auth.ts:407`. Done when a test shows the 21st attempt in the window returns 429 on each route.

### T4. Fix the stale set-stats fallback (Haiku 5.5)
`apps/server/src/collections.ts:1076` returns only `{ ok, masterTotal, stale }` when TCGdex is unreachable. Return the same shape as the fresh path at line 1057 (`allTotal`, `provisional`, `unresolvedTotal`, `additionalTotal`, `profile`) plus `stale: true`. `existing` already holds every field. Done when a test with the upstream failing asserts all fields are present.

### T5. Stop reading the whole collection to change one row (Sonnet 5.5)
`collections.ts:622` and `:627` call `readEntries(...).find(...)` twice per `+1` click. Replace with a single-row select by `(collection_id, id)` using `rowToEntry`. Do the same for the graded lookups at `:719` and `:736`. Response bodies must not change. Done when existing tests pass and T1 shows adjust time no longer grows with collection size.

### T6. Mechanical hardening batch (Haiku 5.5)
Four independent one-line changes, one commit each:
- `collections.ts:157`: cap `pcUpdatedAt` to 40 characters, as neighbouring string fields are capped.
- `apps/server/src/app.ts:103`: evaluate `!SAFE.has(req.method)` before `existsSync(...)`, so reads do not touch the filesystem.
- `apps/server/src/system.ts:78`: wrap the job error message in `redactSecrets(...)` before returning it.
- `apps/server/src/tcg/routes.ts:508`: add `cache-control: private, max-age=31536000, immutable` to the Magic photo response, matching `collections.ts:777`.

## Priority 1b: design fixes

From running the built app in demo mode on 17 November 2026: every main page at 1440×900 and iPhone 13 size, light and dark, plus axe (WCAG 2 A/AA). No page scrolls sideways and axe found only near-threshold issues. These tasks cover what a person notices.

### D1. Make card tile prices match what is owned (Opus 5.5)
`apps/web/src/components/CardTile.tsx:52`: when the tile is not tied to one printing, it shows the highest price across all printings. On the Collection page that is usually the 1st Edition price, not the copy you own. In the demo, Base Set Mewtwo shows £618 (1st Edition Holo) while the owned copy is valued at £0, and a grid of hundreds-of-pounds tiles sits under a £57.57 total.

Decide the rule per context and apply it everywhere `CardTile` is used:
- **Holdings** (collection, binder, dashboard "Most valuable" and "Recently added"): the value of the owned copies, using the same function as the totals (`entryValue` in `packages/shared/src/value.ts`).
- **Catalogue** (set pages, search, wishlist): a labelled range ("£27–£618") or the cheapest printing.

Done when the tile values on the Collection page sum to the page total, and the catalogue label cannot be mistaken for the value of a copy.

### D2. Fix the demo seed's printings (Sonnet 5.5)
`apps/server/src/demo.ts:94` files every demo card as the `normal` printing, which predates the printing catalogue. On the public demo, the shop window for people deciding whether to self-host, this produces:
- a dashboard that leads with "−£1,699.03 (96.7%)" and a chart that falls off a cliff on the last day;
- Base Set and Sword & Shield at 0% complete although six in seven cards are owned;
- "Identify this printing" prompts on most card pages.

Seed each entry with a real printing id taken from the catalogue profile for that card (the first core printing), and generate the seeded value history from the same priced holdings, so it ends at today's total. Done when a fresh demo shows no legacy-printing prompts, plausible completion, and a continuous chart.

### D3. Get cards above the fold on phones (Sonnet 5.5)
At 390×664 (iPhone 13), the Collection page shows no cards on the first screen and the dashboard shows only half its chart. Above them sit the full-width game selector, the page header with three buttons, and the valuation footnotes:

> 412 of 605 held copies priced · 193 unpriced · 2 estimates · 0 owner valuations · 0 quotes older than 48 hours · 0 without a verified source date · Unpriced items are excluded…

- Collapse the footnotes into one line ("412 of 605 priced") with the detail behind a disclosure.
- On phones, move the game selector into the top bar or the menu.

The bottom bar also carries seven items, leaves out Lists, and duplicates Search (which is also in the top bar). Cut it to four or five and put the rest under "More". Done when the first phone screen of Collection shows at least one row of cards.

### D4. Tell the two Share buttons apart (Haiku 5.5)
`apps/web/src/pages/CollectionPage.tsx:101-102` renders two buttons both labelled "Share" with the same icon: one shares the collection, the other the graded cards. Label the second "Share slabs", or merge both into one Share menu.

### D5. Rewrite printing-status jargon (Sonnet 5.5)
Every printing row of a well-known card can read "Not counted towards Master · needs checking", and a new set shows "Master 0% · 0/0". Both describe internal catalogue state. Write user-facing wording: say what is uncertain and what the user can do, or show nothing when they cannot act. Show "—" instead of "0/0". On a set with no cards yet, the empty state should say the set has not been catalogued yet, not "No cards match these filters" (`apps/web/src/pages/SetPage.tsx`).

### D6. Accessibility clean-up (Haiku 5.5)
- Add an `h1` to the dashboard and Sealed pages; both currently have none.
- Label the narrow input in Settings (axe flags `.!w-40`).
- `text-faint` at 10–11px measures 4.3:1 on tinted backgrounds, just under the 4.5:1 minimum. Darken the token slightly, or stop using it below 12px.
- `main#main-content` gets a visible focus ring around the whole page on a fresh load (`Layout.tsx:178` focuses it). Suppress the outline on `main` only; it is a programmatic focus target, not a control.

### D7. Brand for more than one game (maintainer decision first)
The app is called PokéTracker, with a Pokémon-styled wordmark, yet it now tracks Magic, and the Magic dashboard sits under that name. The pastel "Tracker" half of the wordmark is also hard to read on the light theme. Whether to rename is a product decision; the wordmark contrast can be fixed regardless.

## Priority 2: larger fixes with clear payoff

### T7. Bound the disk growth any reader can cause (Opus 5.5, *security*)
Anyone signed in, and any anonymous visitor holding a share link, can make the server store unbounded data:
- `apps/server/src/catalog.ts:267`: the GraphQL proxy caches every distinct payload and validates only by rejecting the word `mutation`.
- `catalog.ts:253`: the TCGdex proxy keys its cache on arbitrary query strings.
- `catalog.ts:279` and `:121`: `/api/img` accepts query-string variants of allowed URLs and has no rate limit.
- `catalog.ts:104`: `http_cache` is pruned by age only.

Work out which GraphQL queries and query parameters the client really sends (`packages/shared/src/catalog.ts`, `apps/web/src/api/client.ts`) and allow only those. Strip query and fragment in `imageUrl`. Add a rate limit to `/api/img`. Add a byte cap to `http_cache` with least-recently-fetched eviction, run from the cleanup job and on insert when over the cap. Done when tests show a share visitor cannot add more than the cap, and the existing catalogue and share tests still pass.

### T8. Serve share photos without rebuilding the share (Opus 5.5, *security*)
`apps/server/src/shares.ts:401`, `:426` and `:446` call `shareView` or `gameShareState` for every photo request, which loads and redacts the whole collection each time. Replace with a direct query that answers "is this slab or sealed item inside this share's scope and not soft-deleted". The scope rules in `shareView` (`shares.ts:96-139`) and `gameShareState` are the specification; the new check must give the same answer for every scope. Done when a table-driven test compares old and new visibility for all six scopes, and T1 shows the share page no longer scales with collection size times photo count.

### T9. Conditional requests for collection state (Fable 5.2)
`collections.ts:612` already sends an `ETag`, but the server never answers 304, and the client refetches the full state after each adjust (`apps/web/src/store/collectionStore.ts:453`, `:463`). Add `If-None-Match` handling to `/state` and the Magic equivalent.

This is assigned to the strongest model because of two traps. First, the client parses the `ETag` as the collection revision for its write protocol (`apps/web/src/api/http.ts`, the `acceptRevision` path), so the header's format cannot simply change. Second, prices change without bumping the revision, so a revision-only validator would serve stale values. The task is to design a validator that covers both without weakening the `If-Match` conflict detection in `apps/server/src/mutations.ts`, then implement it. Done when `apps/server/test/concurrent-edits.test.ts` and the client concurrency tests pass unchanged, and a new test shows a price refresh invalidates the cached state.

### T10. Replace the per-card queries in "biggest movers" (Sonnet 5.5)
`apps/server/src/cards.ts:298` and `apps/server/src/tcg/routes.ts:186` run one or two queries per card. Fetch the latest price at or before the cutoff for all cards in one grouped query per source. Results must be identical. Done when a test compares old and new output on a seeded collection and T1 shows the improvement.

### T11. Second hardening batch (Sonnet 5.5, *security*)
- `auth.ts:645` and `collections.ts:1179`: the audit log stores the raw request body. Store an allow-list of the fields each route acts on.
- `apps/server/src/updater.ts`, function `download`: it buffers the whole response before checking size when there is no `content-length`. Use `boundedBody` from `resourceLimits.ts`.
- `apps/server/src/providers/pricecharting.ts:198`: add a per-user limit to search so one member cannot spend the shared 60-per-minute budget the price job depends on.
- `apps/server/src/context.ts`, `Limiter.take`: key IPv6 clients by their /64.

### T12. Optional passphrase encryption for backup packages (Fable 5.2, *security*, needs decision 2)
Packages built in `apps/server/src/backupPackages.ts` contain `secret.key` beside the database, and the product encourages copying them to a cloud-synced folder. Whoever reads that folder gets password hashes, decryptable TOTP seeds and share tokens. Design and implement authenticated, streaming encryption with a passphrase-derived key for synced and downloaded packages. It must cover the restore path, the recovery CLI (`recoveryCli.ts`), the host scripts in `deploy/backup/`, and `docs/recovery.md`.

Assigned to the strongest model because a mistake here either leaks every secret or produces backups that cannot be restored, and neither shows up until it is too late. Done when `npm run test:recovery` round-trips an encrypted package, a wrong passphrase fails cleanly before anything is staged, and unencrypted packages still restore.

### T13. Let jobs be cancelled at shutdown (Opus 5.5)
First confirm the suspected behaviour: a long `prices` or `images` job at update or restore time outlasts the 30-second deadline in `apps/server/src/index.ts:64`, the process exits with code 1 instead of 75, and `apps/launcher/launcher.mjs` counts it as a crash. If confirmed, pass an `AbortSignal` into job runners in `jobs.ts`, check it between batches in `refreshCards` and the image loop, and make the deadline path exit with the requested code. Done when `npm run test:crash` covers a restart requested during a running job.

### T14. Lighter Magic writes (Opus 5.5)
Every Magic write recomputes the whole collection value (`recordGameValue` in `apps/server/src/tcg/state.ts`, called from `tcg/routes.ts:233` onward), then the client blocks the UI and refetches the full state (`apps/web/src/tcg/GamePage.tsx`, `perform`). Debounce the value snapshot the way the Pokémon store does, and add optimistic updates through the React Query cache with rollback on error. Done when quantity changes feel immediate, a failed save restores the previous state with a toast, and `e2e/tcg.spec.ts` passes.

### T15. Lazy-load the heavy routes (Sonnet 5.5)
`apps/web/src/App.tsx:12-27` imports every page eagerly. Lazy-load the admin, scan, account and Magic routes behind the existing splash. Record the main bundle size before and after in the PR. Do not add list windowing in this task; profile the collection and set grids at 5,000 cards first and report whether it is needed.

### T16. Background Magic import (Sonnet 5.5)
`tcg/routes.ts:365` fetches up to 500 uncached cards one at a time inside the request while holding the single import lock. Move hydration into a job with progress the client can poll, keeping the validation that already precedes it.

### T17. Paging for the audit log and invite list (Sonnet 5.5)
`auth.ts:711` returns the last 200 audit rows and `auth.ts:521` the last 100 invites, with no way to see more. Add cursor paging and an action filter to both, and the matching controls in `apps/web/src/pages/AdminPage.tsx`.

### T18. Coverage thresholds (Haiku 5.5)
Run coverage for the server, shared and web workspaces, then set thresholds two points below the measured figures in each Vitest config so coverage cannot silently fall. Report the measured figures in the PR.

## Priority 3: design

Do these only after priorities 1 and 2, and after decision 3.

### T19. Split `collections.ts` (Sonnet 5.5, reviewed by Opus 5.5)
`apps/server/src/collections.ts` is 1,182 lines mixing validation, the read model, import, scan and deck resolution, set stats and routes. Split it along those lines with no behaviour change and no renamed exports. Done when the diff is moves only and every test passes untouched.

### T20. Per-route body schemas (Sonnet 5.5)
Almost every route casts `req.body as Record<string, unknown>`; only `entries/adjust` (`collections.ts:616`) declares a schema. Add Fastify schemas route by route, starting with auth and shares. Keep the existing hand-written checks until the schema demonstrably covers them, and keep error messages stable, because the client switches on error codes.

### T21. Move module-level state onto `ctx` (Sonnet 5.5)
The in-flight maps in `cards.ts` and `catalog.ts`, the scan cache in `collections.ts` and the limiter in `pricecharting.ts` are process-wide, which leaks between tests. Hang them off `ctx`, as the `WeakMap<Ctx, …>` code in `photoStorage.ts` and `tcg/provider.ts` already does.

### T22. Adopt a formatter (Haiku 5.5)
Add Prettier with a config that matches the already-formatted `apps/server/src/tcg/` files, format the repository in one commit, and add a CI check. Schedule it when no other task branch is open, because it conflicts with everything.

### T23. Review the unification plan against this one (Fable 5.2, after decision 3)
Read `docs/tcg-unification-plan.md` and `docs/tcg-unification-prs.md` and report which of its phases are still worth doing once T5, T8, T9, T14 and T19 have landed, which are now smaller, and which carry risk with no user-visible return. Output is a written recommendation, not code.

## Order and parallelism

1. Decisions 1 to 4, then T0 and T1.
2. T2 to T6 in parallel; they touch different lines. D1, D2, D4 and D6 alongside them; D1 first if only one, because wrong prices undermine trust in everything else. D3 and D5 next.
3. T7, T8, T10 and T11 in parallel. T9 alone, since it touches the write protocol.
4. T12 to T18 as capacity allows. T13 and T14 should not overlap with T9.
5. T19 before T20 and T21. T22 last. T23 whenever decision 4 is made.
