# Complete instance recovery

The nightly `.db` copies remain database-only backups. Complete snapshots additionally contain
the referenced photos, effective instance key, recoverable configuration and write-protocol floor.
They exclude image/HTTP caches, nested backups and downloaded application bundles.

Run the packaged host CLI inside the running application container:

```sh
docker compose exec -T poketracker node /app/bundle/recovery.mjs snapshot
docker compose exec -T poketracker node /app/bundle/recovery.mjs status
```

The first command returns a JSON object with `path`, `name`, `capturedAt` and `files`. The
complete directory is published atomically below `/data/recovery-snapshots`. Hidden `.incoming-`
directories are incomplete and must never be uploaded as successful recovery points.

Snapshots contain **plaintext secrets** locally and are restricted to the host/container owner.
Copy them off-host only through encrypted backup tooling. Keep the backup-repository password
outside the app and preserve an independent copy: losing it makes encrypted backups unusable.
The control interface is a permission-0600 Unix socket, never a public HTTP endpoint. Anyone
with host root or Docker access already has authority over the live database and its key.

To validate or restore using a compatible published image's packaged CLI:

```sh
node recovery.mjs verify /recovery/source-snapshot
node recovery.mjs restore /recovery/source-snapshot /recovery/new-empty-data
```

Use the executable bundled with the application, or run it in an isolated container with the
recovery working directory mounted. Restore is offline: it refuses to replace an existing data
directory. It validates the manifest, hashes, database integrity, foreign keys, encrypted secrets
and every referenced photo before publishing a new directory. Sessions are cleared on restore;
accounts, TOTP, share links and mutation receipts are retained. Existing `.db`-only backups still
need their matching photos and original key supplied separately.

Start exactly one compatible application against the restored directory. Read `recovery-config.json`
to restore runtime options, replacing `PUBLIC_URL` if the address changed. `secret.key` contains
the effective original key even when the source used an environment-supplied key; do not start
with an unrelated `SECRET_KEY`. Preserve the required launcher/write protocol. A manifest from
a newer schema is rejected by older restore executables; use the matching or newer image.

Verify accounts, TOTP, sharing, list quantities, collection counts and photo hashes before routing
users to the restored instance. The recovery-point target concerns the capture time of the most
recent **completed remote backup**, not the last local snapshot or job start. A backup failure
can invalidate the target; it never becomes a zero-loss storage guarantee.
