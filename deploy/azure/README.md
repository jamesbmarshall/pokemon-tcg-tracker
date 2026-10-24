# Azure hosting

For new production installations, use the [VM with local storage](#vm-with-local-storage)
template. SQLite is a single-host database; a persistent local data disk avoids the SMB
locking/latency and overlapping-revision constraints of Container Apps. The VM still needs
host maintenance and independent backups. It is not a managed database service.

## Existing Container Apps installations

Run one Container App with Azure Files mounted at `/data`. This avoids maintaining a VM or
paying for a separate database service. `containerapps.bicep` (and its generated portal template,
`containerapps.json`) creates the app, storage and built-in HTTPS endpoint. Review regional
Container Apps, Azure Files and logging charges; this is not a promise of free hosting.

The template configures one always-on replica, Single revision mode, rollback journaling
(`SQLITE_JOURNAL_MODE=delete`) and the SMB `nobrl` mount option for SQLite compatibility.
The app automatically selects rollback journaling on recognised network mounts and reports
a warning in the startup logs and owner Settings. No opt-in environment variable is required.

The share quota is configurable using `dataShareQuotaGiB` (64 GiB by default for new
deployments). The former 20 GiB default could fill with a 1.1 GiB database, retained database
copies and interrupted snapshots. Capacity must include the live database, retained packages,
photos and roughly three database sizes of temporary backup/compaction space. Increasing a
quota alone does not fix blocking database work. Review Azure storage costs before changing it.

Startup probes now allow ten minutes and liveness probes tolerate transient slow responses
with explicit five-second timeouts. Expensive recovery operations run on a worker; longer
probe tolerance is a safeguard, not the mechanism that keeps the app responsive.

## What protection you get

- Transactions, strict SQLite synchronisation, nightly database backups and pre-update backups.
- A crash-released local process lock prevents two app processes on the same host/runtime
  directory. On network mounts the lock and recovery socket live in private local temporary
  storage, because SMB cannot reliably provide these facilities.
- The lock **does not coordinate separate Azure replicas**. Never scale out, run a second app
  against the same share, or perform a rolling/blue-green deployment against it. Keep both
  minimum and maximum replicas at one. Background jobs need the app to remain running.

Azure Files is persistent storage, but SQLite over a network filesystem has residual locking
and flush risks. This setup cannot promise that every acknowledged edit survives every failure.
A backup on the same share also cannot protect against loss or deletion of that share.

## Updates

Prefer the in-app updater for ordinary releases. It stops the current server before starting
the replacement within the same container, and restores its pre-update database backup if
startup fails. Leave the container replica count at one.

For an image/launcher update, accept a short outage and use **stop before start**:

1. Save an independent complete recovery copy (see below), and pause collection edits.
2. In Azure Portal, open **Revisions and replicas**. Deactivate every active revision of this
   app. Wait until all replicas have stopped; do not proceed while any old replica remains.
3. Update the container image with the explicit new release tag. For example, in Azure Cloud
   Shell, replacing `VERSION` with the release containing the fix:

   ```sh
   az containerapp update --resource-group RGpoketracker --name poketracker \
     --image ghcr.io/jamesbmarshall/pokemon-tcg-tracker:VERSION
   ```

4. Verify that only the new revision is active, with one replica, and check its logs and
   health. If Azure leaves the new revision inactive, activate only that revision after
   confirming all old replicas are stopped. Verify sign-in, collections and a saved edit.

   Recheck *all* revisions after the update: the service may reactivate the previous revision
   while the replacement starts. A revision with zero traffic can still run background jobs
   against the database. If the platform cannot maintain exclusive access through a rollout,
   use the VM deployment rather than relying on traffic weights to protect SQLite.

[Single revision mode](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
keeps traffic on one revision, but may overlap containers during a normal rollout. It does not replace step 2. Avoid routine `az containerapp up` image replacements on a
running SQLite instance. Do not delete or detach the persistent share to fix an upgrade.

The original 2.1.3 bundle rejects network mounts. Retrying that exact bundle will still fail;
these changes must be published in a newer release before updating your existing instance.
An image update preserves the launcher's previously selected application bundle, so confirm
the running version in Settings and use the in-app updater to select the fixed release.

## Backups and recovery

Nightly complete packages contain the database, photos, settings and effective instance key.
Use **Back up now** in owner Settings to start a background backup; it continues if the page
is closed and the download appears after completion. Download completed packages and keep
copies away from the share. Pre-update `.db` rollback files contain only the database.

Interrupted snapshot/archive staging is removed on startup under the instance lock. Completed
CLI snapshots and published packages are preserved. Automatic retention runs before admission;
under space pressure, older automatic packages may be removed sooner, but the newest complete
package and manual/before-restore packages are preserved. Once complete packages exist, only
the newest legacy daily database copy is retained, alongside the normal pre-update retention.
If protected files leave insufficient space, the backup fails without taking down the app.
Failed/interrupted startup jobs have a one-hour catch-up cooldown rather than retrying at every
restart. Cron schedules and explicit manual retries remain available.

For a directory snapshot suitable for host backup tools, run inside the container:

```sh
node /app/bundle/recovery.mjs snapshot
```

Use Azure Portal's container console to run this command. It returns a snapshot path under
`/data/recovery-snapshots`. Copy that completed directory from the Azure file share to independent
storage using Storage Explorer or your preferred backup tool. It includes sensitive secrets;
protect/encrypt the copy and restrict access. Preserve any external configuration separately.
Do not copy the live database file directly while the app is writing it.

See [complete recovery](../../docs/recovery.md) for validation and restoration. Test a restore
before relying on backups. Built-in nightly copies are useful protection against mistakes;
independent full copies protect the complete collection against storage loss. External backup
automation is optional and must be configured separately; the app does not upload backups for you.

## VM with local storage

A VM with a persistent data disk is the recommended production Azure deployment for the
current SQLite architecture. Users must still maintain the host; the included Caddy service
handles HTTPS and the backup tooling supports independent encrypted recovery copies.

Compile `vm.bicep` and deploy it with a published application image **digest**, your SSH
public key and a restricted administrator source CIDR. The defaults are a B2s VM and
64 GiB Standard SSD data disk; review the Azure cost and regional availability first.
The template does not deploy anything until you explicitly submit it to Azure.

The application data disk is retained when its VM is deleted. The app is not exposed
on port 3000. Caddy supplies HTTPS on the generated Azure DNS name. Read the setup token
with `sudo docker compose -f /opt/poketracker/compose.yaml logs poketracker` after cloud-init
finishes. Preserve that token privately until setup is complete.

For upgrades, verify a complete independent recovery point, pull the replacement digest,
then stop the application before recreating it. Do not run two containers against the same
data directory. The required mount must be present before Docker starts; the bind mount
also refuses to create a missing host directory.

## Moving an existing Azure test instance

1. Rehearse with a disposable copy. Record the source build, image and encryption-key source.
2. Stop the source app and all its active revisions. Verify no process is writing the database.
3. Copy the complete data directory, including photos and `secret.key`, to independent storage.
   If `SECRET_KEY` is external, preserve it separately; do not substitute a new key.
4. Validate the offline SQLite database with `PRAGMA integrity_check` and `foreign_key_check`.
   Copy the data to the mounted destination disk with the application stopped. Restore the
   original external key where applicable. Set data ownership to the configured container UID.
5. Start exactly one destination application. Verify accounts, TOTP, shares, lists, counts,
   values and photo hashes. Configure and verify encrypted off-host backups before cutover.
6. Switch the public address only after verification. Keep the stopped source and its recovery
   copy intact. Returning to the source after new destination writes requires migrating those
   writes back; simply restarting the old copy would lose the newer changes.

The repository templates alone do not establish recovery guarantees. Record the most recent
successful remote recovery point and perform a timed restore rehearsal before relying on it.

Image reference: [Canonical's Ubuntu image catalogue](https://ubuntu.com/azure/docs/azure-how-to/find-ubuntu-images/).
