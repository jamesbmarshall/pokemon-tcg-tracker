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

## Release and deployment acceptance

Run `npm run build`, `npm run test:crash` and, with Restic installed,
`npm run test:recovery`. The recovery rehearsal creates synthetic data, captures a complete
snapshot, backs it up using actual Restic encryption, checks all repository data, deletes the
source instance, restores to a new directory, and checks TOTP sign-in, shares, deck data, photos,
provider-secret decryption and mutation receipts. It never targets your configured instance.

`FULL_REHEARSAL=1 REHEARSAL_REPORT=/tmp/recovery-result.json npm run test:recovery` uses
50,000 entries and 5 GiB of independent random photo bytes. Reserve at least 25 GiB free space
for the source, snapshot, repository and restored copies. Temporary files are removed after
completion. Run this on the target resource profile (2 CPUs / 4 GiB RAM), with the actual remote
repository and expected bandwidth, to establish performance. A local repository benchmark
proves neither cloud upload time nor fresh-VM provisioning time.

Before promoting a real instance:

1. Preserve a stopped, complete copy of the old volume and its effective key.
2. Deploy one pinned application image and Caddy proxy to the managed local disk. Verify TLS,
   mount identity, non-root application UID, write readiness and duplicate-writer rejection.
3. Configure independent off-host repository credentials/password custody, run backup and
   verification, and inspect the capture/upload/check/restore timestamps in owner Settings.
4. Stop the test instance, restore the latest remote snapshot on a new host, restore configuration
   and DNS/TLS, and time the entire outage. Verify TOTP/recovery-code sign-in, existing share
   links, counts, list/deck quantities, photos and a new write. Record the capture age and outage.
5. Rehearse failed uploads, unavailable storage and a filled data disk. Confirm failures remain
   visible and do not advance the reported successful recovery point.
6. Promote only when remote capture age is within one hour and complete fresh-host recovery
   is within two hours. If it fails, keep the instance in testing and record the actual limits.

The supported launcher is 1.1.0 or newer and write protocol is 1. Application startup rejects
unknown future schema/protocol floors. Do not roll an external image back to a pre-protocol
launcher: an old binary cannot enforce a guard that did not exist in its code. Use a compatible
newer image or restore a complete pre-upgrade snapshot to a separate host. Database-only
rollback can discard newer writes and is not a recovery strategy for the active collection.
