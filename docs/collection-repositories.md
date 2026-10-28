# Collection read repositories (U09)

`apps/server/src/tcg/repositories/collection.ts` is an internal read boundary over
existing Pokémon tables and generic `tcg_*` tables. It performs no migration,
provider request, snapshot hydration, valuation-history write or file operation.
Existing routes and writes still use their current implementations.

## Contract

`collectionRepository(ctx, collectionId, game)` fixes collection/game scope and
returns `read(role)`, `history()` and `photos()` methods. Game selection uses the
source-owned module registry. Stored card IDs are passed to existing readers as
stored; repositories do not require a textual game prefix or rewrite IDs.

`read()` returns common collection/game/role/revision metadata and a valuation
projection, together with a discriminated native state:

- `storage: 'pokemon'` retains the full `collectionState` shape: card snapshots,
  variants, entry/set IDs and timestamps, grading labels/custom graders/subgrades,
  PriceCharting dates, sealed opening dates, timestamped notes/wishlist, list
  ordering/quantities/dates, completion statistics and history cost basis.
- `storage: 'generic'` retains the full `gameState` shape: normalized catalogue
  records, generic holdings and their stored extension fields, finish IDs, game
  lists/zones, notes, wishlist and history.

This is deliberately a shared envelope over native states, not a conversion of
Pokémon snapshots into full normalized catalogue cards. Snapshots do not contain
all source rule/quote details. Likewise, current generic DTOs omit some Pokémon
collector metadata. Callers must narrow `storage` before interpreting native
fields. Later endpoint/UI adapters must follow the field-mapping document before
adopting a common DTO; this boundary alone does not establish DTO parity.

Valuation uses existing game policies: `computeValue` for Pokémon and
`collectionValue` for generic records, with current EUR rates where needed. Manual
zero values remain zero, missing prices stay unknown in source state, and opened
sealed products contribute no value. The envelope reports numeric value and copy
count; Pokémon also reports its existing unique-card count. No generic unique or
cost-basis value is invented. History retains each storage format's original
fields, independently of the current calculated valuation.

`photos()` returns metadata only: ID, parent kind/ID, MIME and added date, plus
legacy side/size when stored. Queries join live parents using collection scope
(and game/kind for generic records). Deleted-parent/orphan photos are excluded
from this read view, without deleting or repairing any stored row or file. Byte
serving, shares and endpoint consolidation remain later work.

## Authorization and consistency

Repositories are privileged internal persistence adapters. Their `role` argument
is descriptive, not authorization. Do not call them with untrusted scope and then
serialize the result to a client.

`readCollection(ctx, userId, collectionId, game)` is the member-read service seam.
The user ID must come from an authenticated server session. It checks current
collection ownership/membership on every read and returns the same not-found error
for absent collections and nonmembers. It derives the role on the server and
returns state, valuation and photo metadata within one synchronous deferred SQLite
transaction. The first authorization read pins the snapshot; concurrent commits
cannot mix a new revision with old holdings. An existing caller transaction is
joined and is never committed by this service. Errors close only transactions the
service opened. No write reservation is acquired for these standalone reads.

Do not pass a share token as a member identity or expose this private envelope
through public-share endpoints. Existing share scoping/redaction remains
mandatory and authoritative. U10 introduces command services; U11 adopts shared
read services in authorized routes. No authorization shortcut is permitted merely
because a game advertises a capability.

## Validation and budgets

Both repositories run the same real-SQLite contract suite. Tests compare native
outputs against existing readers and independently assert literal preservation
manifests, valuation totals, purchase currencies, multilingual notes, timestamps,
list ordering, graded details, photo references and cost-basis history.

Reads run under `PRAGMA query_only = ON`; raw stored-row snapshots remain identical
before/after, and network access is stubbed to fail. Tests cover revoked access,
foreign collections/games, deleted parents, detached return values, rollback of
caller transactions, and a concurrent commit through a second WAL connection.

Each storage implementation reads 20,000 distinct cached cards and holdings with
at most 80 `all`/`get` calls and zero provider requests. This deterministic query
budget detects per-card SQL regressions. A generous three-second local test guard
also catches catastrophic synchronous regressions; it is not a production SLA or
a substitute for the remaining end-to-end performance gates in the baseline.
