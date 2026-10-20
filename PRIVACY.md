# Privacy

PokéTracker is self-hosted. The instance operator controls its data, access, hosting and backup
services; the project maintainer does not receive the instance database.

## Stored on the instance

- Accounts: username, display name, password hash, role, account timestamps and optional
  encrypted TOTP secrets. Recovery codes and invite/reset tokens are hashed.
- Sessions: a hashed session token, expiry, recent activity, client IP and user agent.
- Collections: raw cards, graded copies, sealed products, quantities, purchase prices, notes,
  owner valuations, lists/decks, daily value history and uploaded photos.
- Shares: access scope, visibility settings, expiry, view count and last-view timestamp. The
  share token is hashed for lookup and encrypted so its owner can retrieve the existing link.
- Audit events: actor, action, timestamp and relevant request metadata, including IP where
  available. Audit events are normally pruned after 400 days when housekeeping jobs run.
- Mutation receipts: the actor, operation fingerprint, revision and acknowledged response,
  retained to prevent duplicate writes after retries. These are private instance records.
- Optional PriceCharting API key, encrypted using the same instance key as TOTP/share secrets.

Collection data and photos are not encrypted individually. The effective instance key is in
`secret.key` or supplied by `SECRET_KEY`; host/disk encryption and host access remain the
operator's responsibility. Anyone with host root or Docker access can read the live instance.

## Outbound services

The server contacts TCGdex for card/set/pricing data and its approved image hosts for card
images; Frankfurter for exchange rates; GitHub for release metadata and signed update bundles;
and PriceCharting when the operator configures that integration. These providers see the
server's network address and the requested reference identifiers. PriceCharting receives its
configured API key. Collection records, account passwords, private notes and uploaded photos
are not submitted to these reference providers. Their lookups can nevertheless reveal which
card or product identifiers interest this instance.

Browsers retrieve catalogue images through the instance. External links, including source and
product links, open the chosen third-party site and are governed by that site's policies.
There is no built-in analytics, advertising, crash reporting or usage telemetry to the maintainer.
The public demo is a separate, read-only synthetic instance; operators must not put personal
collections or real integration credentials in a demo deployment.

## Sharing and recovery

Public links deliberately publish the selected collection scope. Visibility settings hide
structured prices, purchase costs or notes, but do not redact writing visible inside uploaded
photos. Anyone who receives an unrestricted link can forward it. Revocation prevents further
server access; it cannot erase copies already downloaded by another person.

Portable exports contain collection data and can contain photos when requested. They do not
restore instance accounts, sessions or integrations. Keep downloaded exports private.
Nightly database copies retain a configured number of files (`BACKUPS_TO_KEEP`, default 7),
plus separate pre-update/manual backups. Database copies alone do not recover photo files.
Complete instance snapshots contain the database, referenced photos, effective encryption key,
configuration and compatibility metadata. They are restricted plaintext recovery material on
the host. The recommended host backup jobs encrypt them with Restic before uploading to the
operator's independent Azure/S3 repository; the application container receives no repository
credentials. Default remote retention is 24 hourly, 7 daily and 4 weekly points.

Deleting live records does not immediately remove older backup copies. Unreferenced photo
files have a grace period before housekeeping removes them, and soft-deleted slabs can be
restored during their undo retention. Account/instance removal, external storage retention and
requests about personal data must be handled by the instance operator, including their backups.
