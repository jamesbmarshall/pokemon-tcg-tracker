# Privacy

PokéTracker is **self-hosted**: you (or whoever deploys an instance) run the server and
database, not the project maintainer. That means the person who deploys an instance is
the data controller for it, not `jamesbmarshall/pokemon-tcg-tracker`. This document
describes what the *software itself* does with data, so both operators and the people
they invite know what to expect.

## What the app stores

An instance keeps, in its own SQLite database under `/data`:

- **Accounts**: username/email, an Argon2id password hash, role (owner/admin/member),
  and, if enabled, an encrypted TOTP secret for two-factor sign-in (encrypted at rest
  with a per-instance key in `/data/secret.key`).
- **Collection data**: the cards, sets, sealed product, graded slabs, wishlist and
  custom-list entries an account owns, including optional notes, prices paid and photos
  of slabs.
- **Share links**: a random, hashed token and whatever fields the sharer chose to expose.
- **Audit log**: sign-ins, admin changes, shares and update events, as described in the
  README's [Security](README.md#security) section.

## What the app sends elsewhere

To do its job, the server makes outbound requests to:

- **[TCGdex](https://tcgdex.dev)** — card, set and price data. The server fetches and
  caches this centrally, so TCGdex sees one request per card per instance, not one per
  user.
- **[Frankfurter](https://frankfurter.dev)** (ECB reference rates) — daily currency
  conversion rates.

No personal or collection data is sent to either service: both are read-only reference
data lookups keyed by card/set IDs or currency codes.

## What the app does *not* do

- No analytics, telemetry, crash reporting or third-party trackers are built into the
  app. Nothing about how you use your instance is sent back to the project maintainer.
- No advertising, and no data is sold or shared with anyone beyond the two services
  above.
- Card images are cached on the instance's own disk, not proxied through a third party.

## Your choices as an operator

- **Export or delete**: export your data as JSON or CSV at any time from Settings, and
  delete your account or instance data outright by removing the `/data` volume.
- **Backups**: the server takes a nightly database backup (kept for `BACKUPS_TO_KEEP`
  days, default 7); these live in `/data/backups` on your own infrastructure.
- **Access control**: invite-only sign-up, roles, and per-share visibility controls
  (anyone with the link, specific people, or everyone on your instance) are described in
  the README.

## Questions

If you're a beta tester with questions about what a particular instance does with your
data, ask whoever invited you — they're the operator and data controller. For questions
about the software's own behaviour, see [SUPPORT.md](SUPPORT.md).
