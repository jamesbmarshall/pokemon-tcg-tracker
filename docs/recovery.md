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
The control interface is a permission-0600 Unix socket, never a public HTTP endpoint.
On network mounts it lives in a private local temporary directory; the packaged CLI resolves
the same location automatically when run inside the app container. Anyone
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

## Optional stronger recovery targets

The following host-tooling checks target installations seeking measured recovery times.
See the [Azure guide](../deploy/azure/README.md) for the recommended local-disk VM deployment
and the additional constraints for existing Container Apps installations.

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

## Daily backup packages in Settings

Open **Settings → Backups and restore** as the instance owner. **Back up now** creates
one `.tar.gz` package containing the database, all referenced photos, accounts, settings,
and the encryption key. Use **Download** to save it to your computer or cloud drive.
Keep these packages private: anyone who has one has the data and its recovery key.
Catalogue/image caches and other backups are excluded.

With scheduled jobs enabled (the default), complete packages are created daily at 03:00
in the server's timezone. Overdue jobs catch up after startup. Retention keeps the union
of the most recent 14 distinct daily, 3 monthly and 1 yearly recovery points; a package
can satisfy several periods. Manual and before-restore packages are retained. Packages
are stored in `DATA_DIR/backup-packages`; completed packages appear only after an atomic
rename. Old `.db` backups remain available in Admin and for update rollback, but don't
include photos or keys.

**Restore** on a saved package, or **Choose backup package** for a downloaded file,
checks the manifest, database and photo hashes before staging any replacement. Type
`RESTORE` to confirm. The app saves a complete before-restore backup, restarts through
the launcher, finishes installing the staged data before opening SQLite, and signs
everyone out. Sign in using credentials from the restored backup. Interrupted installs
resume on startup. The current app address, hosting configuration and launcher are kept.
If a server has an environment-supplied `SECRET_KEY` that differs from the package's
key, use offline restore with the package's original key instead.

For a standalone server without the launcher, stop it and restore the package into a
new empty data directory using the included recovery executable:

```sh
node recovery.mjs verify /path/to/poketracker-backup.tar.gz
node recovery.mjs restore /path/to/poketracker-backup.tar.gz /path/to/new-data
```

Start the server with `DATA_DIR` pointing at the new directory. Preserve the original
folder until the restored accounts and collections have been checked. Follow the key
and runtime-configuration instructions above when moving to a different host.

### Automatic copies to OneDrive or Google Drive

This option uses a folder already synced or mounted by the server host. It does not
sign users into Google or Microsoft from PokéTracker.

1. Connect the destination using your host's supported OneDrive/Google Drive sync or
   mount tool. Use a dedicated folder outside PokéTracker's data directory.
2. Make that existing folder writable by the app user (and mount it into the app container
   if applicable). Set `BACKUP_SYNC_DIR` to its **server/container path** and restart.
3. In **Settings → Backups and restore**, enable **Copy new backups to the connected
   folder**, then select **Back up now** to test it.
4. Check the storage service to confirm it has uploaded the package. PokéTracker can
   report only that the folder copy finished, not that the cloud upload succeeded.

Copies use a separate `poketracker-<instance-id>` subfolder, with the same retention
policy. Other files are untouched. The destination folder must already exist, so a
missing mount isn't silently replaced with a new directory. If copying fails, the local
package remains downloadable and Settings shows the failure. A synced folder on the
same disk provides no independent recovery until the storage service has uploaded it.
