# Encrypted off-host recovery

Install Restic, Python 3 and `flock` on the Linux Docker host. Install these scripts as
`/opt/poketracker/backup/{backup,verify}.sh` and `status.py`, executable by root, and the service/timer files
under `/etc/systemd/system`. Keep cloud credentials outside the application container.

Create a root-owned mode-0600 `/etc/poketracker-backup.env`:

```sh
PT_DATA_DIR=/srv/poketracker/data
PT_COMPOSE_FILE=/opt/poketracker/compose.yaml
PT_BACKUP_ID=poketracker
PT_IMAGE=ghcr.io/jamesbmarshall/pokemon-tcg-tracker@sha256:REPLACE_WITH_PUBLISHED_DIGEST
RESTIC_PASSWORD_FILE=/etc/poketracker-restic-password
RESTIC_REPOSITORY=azure:YOUR_CONTAINER:/poketracker
AZURE_ACCOUNT_NAME=YOUR_INDEPENDENT_BACKUP_ACCOUNT
AZURE_ACCOUNT_KEY=YOUR_SECRET_ACCOUNT_KEY
```

The repository password file must also be mode 0600. Preserve the password independently of
the VM, its data disk and its cloud credential files. Use a dedicated repository for each app
instance and an independent storage account. Configure Azure storage recovery/retention for
accidental account or container deletion. Encryption alone does not prevent backup deletion.

For an S3-compatible destination, replace the Azure settings with:

```sh
RESTIC_REPOSITORY=s3:https://YOUR_ENDPOINT/YOUR_BUCKET/poketracker
AWS_ACCESS_KEY_ID=YOUR_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_SECRET
```

Initialize the repository using these host-only environment settings and `restic init`, then
run the backup and verification scripts once. After both succeed, enable the timers:

```sh
systemctl daemon-reload
systemctl enable --now poketracker-backup.timer poketracker-verify.timer
```

Capture runs every 30 minutes to allow upload time and retries while targeting a remote recovery
point no older than one hour. The app remains usable while immutable photo files are copied.
Local complete snapshots are restricted plaintext recovery material; at most two completed
local copies are retained after a successful backup/retention run. Restic keeps 24 hourly,
7 daily and 4 weekly remote points. Downloaded update bundles and caches are not copied.

The weekly job checks remote data and restores into a temporary directory, then runs the
compatible application CLI in network-isolated containers. Its success timestamp advances
only after integrity, photo and secret validation and an offline restore complete. Schedule
an additional timed fresh-host rehearsal to prove the two-hour recovery target on your own
network and dataset; an isolated local test does not prove cloud provisioning time.

Monitor systemd failures independently of the app. A failed upload leaves the last successful
capture timestamp unchanged. The app reports protection overdue once that capture exceeds
one hour. A repository integrity check, upload and actual restore verification are separate
events. Repository credentials must not be configured under application integrations.

See [complete snapshot/restore instructions](../../docs/recovery.md) for disaster recovery.
References: [Restic repository backends](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)
and [restore verification](https://restic.readthedocs.io/en/stable/050_restore.html).
