# Azure Container Apps: simple managed hosting

Run one Container App with Azure Files mounted at `/data`. This avoids maintaining a VM or
paying for a separate database service. `containerapps.bicep` (and its generated portal template,
`containerapps.json`) creates the app, storage and built-in HTTPS endpoint. Review regional
Container Apps, Azure Files and logging charges; this is not a promise of free hosting.

The template configures one always-on replica, Single revision mode, rollback journaling
(`SQLITE_JOURNAL_MODE=delete`) and the SMB `nobrl` mount option for SQLite compatibility.
The app automatically selects rollback journaling on recognised network mounts and reports
a warning in the startup logs and owner Settings. No opt-in environment variable is required.

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

[Single revision mode](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
keeps traffic on one revision, but may overlap containers during a normal rollout. It does not replace step 2. Avoid routine `az containerapp up` image replacements on a
running SQLite instance. Do not delete or detach the persistent share to fix an upgrade.

The original 2.1.3 bundle rejects network mounts. Retrying that exact bundle will still fail;
these changes must be published in a newer release before updating your existing instance.
An image update preserves the launcher's previously selected application bundle, so confirm
the running version in Settings and use the in-app updater to select the fixed release.

## Backups and recovery

Nightly and pre-update `.db` backups are automatic, but contain no photo files or instance key.
Download database backups from the admin page and keep copies away from the share. For full
recovery, capture a complete instance snapshot with the packaged CLI inside the running container:

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

## Optional: VM with local storage

A VM is an alternative for users who want local filesystem semantics and accept host maintenance.
It is not required to use PokéTracker on Azure.

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
