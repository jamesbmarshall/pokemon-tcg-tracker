# Multi-game collection framework

PokéTracker supports Pokémon and Magic: The Gathering in the same installation,
accounts and personal/shared collections. The game selector scopes navigation,
collection state, totals, catalogues and decks. The selected game survives reloads;
existing Pokémon bookmarks and IDs continue to work.

## Boundaries

`packages/shared/src/tcg` contains the game-neutral card/set, playable identity,
printing, finish, holding and deck contracts. `registry.ts` registers source-owned
game modules with languages, search fields, capabilities, completion policy,
formats, scanning and optional deck-text/analysis tools. Modules are bundled with
the application; this is not a runtime third-party-code plugin loader.

Providers are separate from game rules. `apps/server/src/tcg/provider.ts` registers
server-side provider factories. Providers return normalized records rather than
upstream payloads. `apps/web/src/tcg` consumes these contracts and registry
capabilities for collecting, search, card detail, scanning and decks.

Pokémon retains its existing storage, printing policies, catalog adapter, pages and
deck validators as the compatibility implementation. New games use generic
`tcg_*` tables. These share collection IDs, memberships, revisions and durable
mutation receipts with Pokémon. A game ID is a stable string; adding a game does
not require changing SQL enum constraints. New IDs must be namespaced by game;
Pokémon IDs must never be rewritten.

### Additive physical-variant contracts (U03)

`tcg/printing.ts` owns `CollectibleVariant`; the legacy `CardPrinting` name is a
type alias to preserve existing consumers. `TcgCard.variants` is optional so old
cached records remain valid. `tcg/variants.ts` projects detailed Pokémon printings
or older generic finish lists into independent cloned variant records. Detailed
evidence and aliases are preserved; summary finishes do not establish size,
release distribution or completion eligibility. Explicit empty generic variant
lists remain empty, rather than being unioned with summary flags. Duplicate or
empty identities fail projection before ownership could collapse.

These helpers consume trusted typed domain records; provider runtime validation
remains required at the server boundary. They do not rewrite stored cards,
holdings, prices or API responses. `PokemonDetails` retains game facts, complete
source price blocks, set/image metadata and printing context for the future
catalogue adapter. `PokemonTcgCard` requires detailed variant records, but does
not certify that the catalogue's coverage is complete. See the
[field mapping](tcg-field-mapping.md) before migrating a consumer.

`tcg/completion.ts` adds keyed completion reports alongside the existing result
shapes. Pokémon retains Base/Full/Master/All via its existing policy; generic
games retain identity/printing/finish measures. Measure slot completion is separate
from catalogue coverage and uncertainty, and an empty measure is never complete.
Callers must scope catalogues by language and provide Pokémon's existing eligible
ownership index, including opted-in slabs. These projections do not change current
module callbacks or UI; module/provider wiring and caller migration follow later.

### Module registration and rule context (U05)

Game definitions live under `tcg/modules`; existing exports from `tcg/registry`
remain supported. Registry construction rejects duplicate language/filter/format
keys, missing completion/format/scan handlers and advertised deck capabilities
without formats and deck tools. Sealed and precon declarations require product
types and attribution respectively. Pokémon explicitly declares its temporary
controller-owned compatibility behavior until the normalized adapters replace it.

`requireCapability` provides a typed `GameCapabilityError` with a stable
`unsupported_capability` code. Server boundaries must map that domain error to an
appropriate HTTP error when they adopt the helper; capabilities never replace
authorization. Disabled capabilities may retain handlers for compatibility but
must not be exposed by callers. Provider capabilities are validated separately.

Validators, ownership and analysis accept optional `GameRulesContext` so callers
can supply catalogue completeness and source-owned settings without global reads.
Settings are `unknown` until a game adapter validates them; do not assert them into
a trusted configuration. Existing functions remain valid when no context is used.
Magic now also registers its keyed completion report; Pokémon's report wiring
waits for the normalized catalogue adapter.

### Pokémon deck and scan adapters (U06)

The Pokémon module now registers Standard, Expanded and Unlimited formats,
PTCGL text tools, format-aware raw ownership and the existing OCR parser.
`tcg/pokemonRules.ts` wraps the current shared rules rather than duplicating their
construction logic. Normalized Pokémon details must explicitly be detailed and
carry subtype data before they count as complete rule evidence. Missing details,
unknown source legality and unverified catalogue completeness cannot produce a
legal result. Proven violations remain illegal even when other rows are unknown.
Explicit Expanded bans apply to requested main-deck IDs even when their catalogue
records are missing or incomplete.

Pass `GameRulesContext.format` for ownership and validated `settings` containing
the existing `regulationMarks` and `bannedCardIds` options. Provider flags retain
precedence over regulation-mark fallback. The adapter never reads global settings.
`PokemonRuleError` identifies invalid configuration or an unrepresentable export
for later API error mapping; no server route adopts it in this PR.

Ownership uses ungraded entries across eligible reprints and finishes; it retains
all reprints of requested main-deck names and skips unrelated catalogue details.
Empty main decks return before scanning the catalogue. The result retains
all source deck IDs and marks incomplete name groups or unknown format eligibility
unverified. Copies of unknown eligibility do not count as verified ownership. Maybeboard is
excluded from construction/ownership/analysis. PTCGL export rejects unsupported
zones and missing details instead of silently dropping them. Each exported row must
round-trip through the shared parser with its name, quantity, set code and number
intact. Missing printing identifiers and collector numbers outside the existing
one-to-four-character grammar (such as `SV045`) produce `invalid_deck_export`.
Import retains source
line numbers and reports malformed rows, with bounded text and row counts. Scan
results preserve number padding, printed total, confidence and raw OCR evidence.
The rule-only snapshot projection is never a persistence or catalogue converter:
its display defaults must not replace the source metadata documented in the field
mapping. Existing Pokémon UI, routes and data formats remain in service until their
planned cutover.

## Adding another game

1. Define its normalized game-specific details alongside the shared contracts.
   Preserve playable identity separately from printing/language/finish. Set
   membership is explicit and must not be parsed from IDs.
2. Register its module, capabilities, supported language codes, search filters,
   sealed categories, completion policy and scan parser. Supply deck formats and
   deck tools only if supported. Validators return legal, illegal or unverified;
   unknown data must never certify legality. Existing collection pages and
   game-prefixed routes are registered from the module list.
3. Implement and register a provider factory using the shared server cache,
   resilience helpers, pagination and explicit image-host allowlist. Optional
   `resolve` maps parsed deck rows to candidate printings. Browser requests must
   remain same-origin. Keep vendor syntax inside the provider.
4. Add rules/provider fixtures, a collecting round trip, game-isolation tests and
   browser acceptance journeys. The example third-game registry and UI tests
   demonstrate a game with no deck/scanning/grading capabilities.
5. Add any provider-specific background catalogue importer. The regular tracked
   card-price refresh already dispatches by game/provider; instance backups
   include every game's records and photos.

## Magic

Scryfall supplies paper cards, sets, printed languages, images, Oracle identity,
Commander legality and available USD/EUR price quotes. Search supports its query
syntax plus structured filters. Nonfoil, foil and etched finishes are offered
only when listed for that printing; prices are never copied between printings,
languages or finishes. Manual values override quotes. EUR prices use the shared
FX service. Missing quotes remain unavailable.

Set completion is scoped to language and separates distinct Oracle identities,
all printings, and every printing/finish. Tokens and other extras have a separate
checklist. These measures describe the current provider catalogue, not every
physical variation ever produced. Stale or incomplete set coverage is labelled.

Sets are cached for six hours. Full language-specific set pages are cached for a
day and published after successful pagination. Once Magic has been used, a daily
job can stream Scryfall's all-language bulk catalogue, staging bounded batches and
publishing only a complete download. This can require substantial disk space;
reserve checks abort safely. A failed/restarted import leaves the previous
catalogue available and retries on the next run. The bulk version avoids
re-downloading unchanged data. Daily tracked-card jobs preserve quote history and
game-specific collection value history. Admin Jobs and Providers expose outcomes.

Commander decks have command/main/companion/maybeboard sections. Validation checks
100 cards, commanders and supported pairings, color identity, singleton/copy
exceptions and source legality. Drafts and house-rule decks remain saveable.
Known companions have explicit construction checks; Zirda's activated-ability
condition and unfamiliar companion rules are marked unverified rather than
claimed legal. Validation does not model gameplay, table agreements or tournament
judgments. Recommendations and other Magic deck formats are not included.

Deck text import previews printings before replacing a deck. Unknown or ambiguous
rows need resolution. Owned/missing counts use raw physical copies across reprints
and languages, exclude graded slabs, and do not reserve cards between decks.

Paper Commander precons are searchable by name, set code and release year through
MTGJSON. Search → Precons and Lists & decks → Browse precons open the catalogue.
Each preview separates the playable commander/main deck from display copies and
tokens, preserves quantities and original printing IDs, and links to the publisher
when available. Save as deck resolves exact Scryfall printings in batches of at
most 75 and creates a normal editable Commander deck. Unresolved cards block
saving; no raw holdings or sealed products are created by this action. Catalogue
responses are cached for a day with a labelled stale fallback. The catalogue is
English/source-printing based and is independent of the card-language filter.
Other games can register a precon provider and enable the precons capability.

Camera OCR runs on-device. Set-code/collector-number lookup is best for modern
cards. Older cards need manual lookup or name search, and finish is always chosen
by the user.

## Browsing and editing

Card detail pages use the same `CardDetailLayout` presentation components for
Pokémon and additional games: navigation, columns and artwork sizing, identity,
collection summaries, finish rows, graded sections/slab rows, market tables and
other-printing strips. Notes and price-history controls also share implementations.
The Pokémon controller retains its existing data/store integration; the generic
controller adapts normalized cards and game records. Game-specific card text,
symbols and facts are content slots rather than separate page layouts. Browser
regression checks compare column geometry and typography at desktop and phone
widths.

Additional games share Pokémon's page headers, dialogs, charts, artwork renderer
and animated binder. Binder pocket size follows the existing display preference.
Grid/binder choices are remembered separately per game and page. Collection and
wishlist toolbars support name, set and value sorting; set checklists filter owned
and missing printings. Search waits for input, debounces changes and preserves
filters in the URL for reloads and bookmarks.

Copy details, slabs, sealed products and list/deck editing use dialogs. Failed
saves retain entered values. Deck quantities save on blur or Enter; Escape
restores the saved quantity. Import still requires printing resolution and preview.
Lists and decks are reachable from the desktop sidebar and the mobile header.

## Sharing, exports and recovery

Every new share records its game and reuses expiry, revocation, audiences and
server-side privacy redaction. Item-photo routes recheck both share access and
scope on every request. Set shares include only the selected language, including
holdings, notes, wishlist entries, slabs, sealed products and photo access. Sealed
products without a known language are excluded from language-specific shares.
Existing shares default to Pokémon.

JSON version 7 exports are game-scoped. Pokémon uses the existing top-level
collection shape with `game: pokemon`; additional games use a `games` object
containing their state. Import a file from the matching game's data settings.
Legacy Pokémon export versions remain accepted. Magic snapshots are rehydrated
through the provider on import, never trusted as global catalogue updates.
Repeated imports upsert stable record IDs. JSON exports omit photo files; complete
instance backup packages include their files, references and encryption key.

Migrations are additive and keep existing Pokémon constraints unchanged.
Commander quantities use new generic record storage. Editing metadata updates
records in place so photo foreign keys survive. Older application versions reject
newer schema versions; downgrade through the existing pre-update backup restore
workflow rather than opening a migrated database with an old binary.

## Security and resource limits

Game imports reuse Pokémon's permission checks, single-import admission, worker
JSON parser, storage reserve, atomic revision checks and durable retry receipts.
An import accepts at most 20,000 records, 20,000 distinct card references and
20,000 history points; each list accepts at most 1,000 rows. At most 500 uncached
cards may be hydrated per import. Split larger imports before retrying. Invalid
references, oversized lists and malformed history fail before provider requests.
Catalogue payloads supplied in an export never update the shared card catalogue.

Provider endpoints use fixed HTTPS hosts, disable redirects, bound response sizes
and validate external data before normalization. Precon filenames must occur in
the cached upstream index and pass a path-safe allowlist. Malformed provider data
returns an upstream error rather than being treated as a successful deck import.
The streamed bulk catalogue validates JSON array separators and completion before
publishing staged cards. Image downloads retain the explicit raster/host allowlist.

Record batches load referenced cards once for validation. Collection state parses
each record once, and recording today's valuation skips loading historical values.
Precon resolution merges repeated printing/zone rows with a map rather than
repeatedly scanning the deck. Fresh cached Scryfall responses bypass the network
request gate. Linked sealed-product prices survive metadata edits but are cleared
when the product name, type, set or language changes.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
`npm run audit:dependencies` for verification. The server TCG/precon tests cover
collection isolation, revisions, redaction, scoped photos, import admission and
budgets, malformed providers and bulk stream boundaries. Browser tests additionally
cover shared card layouts and the precon search/preview/save journey.

Run the full browser matrix with `npm run test:browser` after building the web
app and installing Playwright's Chromium/WebKit browsers and OS dependencies.
Each browser test starts its own HTTP server on an ephemeral port with a freshly
seeded database and closes it on teardown. This prevents shared collection edits,
revision state and login rate limits from leaking between tests or browser
projects; production authentication limits remain enabled. Card-layout checks
also add an owned copy before running axe so purchase/value controls are covered.
