# Multi-game security and quality review

Reviewed on 23 October 2026 against the Pokémon-only base of PR #60. The review
covered the generic TCG APIs, collection validation, public shares and photos,
Scryfall/MTGJSON adapters, precon cloning, catalogue jobs, migrations, recovery
integration, shared card components and browser mutation flows.

## Findings addressed

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | A language-specific set share included owned printings from other languages, along with associated holdings, notes and slab photos. | Apply the selected language to card and sealed-product visibility; public photo authorization derives from that same filtered state. |
| Medium | Generic game imports bypassed the existing import admission guard and worker JSON parser. Large imports could also trigger extensive provider hydration before rejecting malformed history or oversized lists. | Reuse the existing import safeguards; preflight references, lists and history; cap distinct references, history and uncached hydration before external requests. |
| Medium | Provider JSON was trusted through TypeScript assertions. Malformed precon/card responses could cause internal errors; new catalogue requests followed redirects. | Add runtime checks, return controlled upstream failures and disable redirects for MTGJSON and Scryfall catalogue requests. |
| Medium | The streaming bulk decoder accepted missing separators, trailing commas and trailing data, allowing malformed downloads to be published as complete. | Require valid array boundaries and separators before staged catalogue publication. |
| Medium | Sealed product identity changes retained an unrelated PriceCharting link and valuation. | Preserve links only while name, product type, set and language still match; keep quantity and note edits independent. |

The reviewed collection and photo queries use bound SQL parameters. Private
collection routes require existing membership permissions; shared photo routes
recheck scope, audience, revocation and expiry. Writes retain the existing CSRF,
revision and receipt protocol. Uploaded catalogue fields are not trusted during
imports. No dependency changes were required.

## Efficiency and maintainability

Batch validation loads referenced catalogue cards together instead of issuing one
query per deck row. Collection state parses each stored record once. Daily value
recording skips loading the complete value history. Precon row merging uses a map,
and fresh Scryfall cache reads avoid the network pacing delay. Provider card
normalization is shared by interactive, precon and background bulk paths.

Operational limits and extension requirements are documented in
[multi-game.md](multi-game.md). The build still reports the application-wide large
JavaScript chunk warning; route-level code splitting remains a performance
follow-up.

## Verification

Regression tests exercise cross-language share isolation, scoped photo access,
shared import admission and release, preflight budgets without external requests,
malformed provider responses, strict bulk array parsing and sealed-price identity.
The existing tests also cover unauthorized collection access, revision conflicts,
receipt replay, export catalogue poisoning, share redaction and revocation.

Validation commands: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm test -w @poketracker/server`, and `npm run audit:dependencies`. Socket tests
require an environment that permits local socket creation. The dependency gate
checks development dependencies as well as runtime dependencies and passed with
no advisory exceptions.
