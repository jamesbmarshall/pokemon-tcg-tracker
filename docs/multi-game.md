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
rows need resolution. Built-in precon browsing is not included; import their text
lists. Owned/missing counts use raw physical copies across reprints and languages,
exclude graded slabs, and do not reserve cards between decks.

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
scope on every request. Existing shares default to Pokémon.

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
