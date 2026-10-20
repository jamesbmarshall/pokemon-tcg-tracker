# Azure with a local SQLite database

The supported Azure deployment is one Ubuntu VM with a separate ext4 managed data disk.
Container Apps/Azure Files and App Service `/home` database mounts are legacy examples;
they do not provide the required single-writer/local-locking guarantee. Do not deploy
new collector instances from those templates or scale them out.

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
