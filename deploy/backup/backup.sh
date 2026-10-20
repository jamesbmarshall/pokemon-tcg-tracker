#!/usr/bin/env bash
set -euo pipefail
config=${POKETRACKER_BACKUP_CONFIG:-/etc/poketracker-backup.env}
python3 - "$config" <<'PY'
import os, stat, sys
s=os.stat(sys.argv[1])
if s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) & 0o077:
    raise SystemExit('Backup configuration must belong to this user and have mode 0600')
PY
set -a
# shellcheck source=/dev/null
source "$config"
set +a
: "${PT_DATA_DIR:?Set the host data directory}"
: "${PT_COMPOSE_FILE:?Set the application compose file}"
: "${PT_BACKUP_ID:?Set a stable instance name}"
: "${RESTIC_REPOSITORY:?Set an independent remote repository}"
: "${RESTIC_PASSWORD_FILE:?Set a host-protected repository password file}"
[[ "$RESTIC_REPOSITORY" == azure:* || "$RESTIC_REPOSITORY" == s3:https://* ]] || { echo 'Use an independent Azure Blob or HTTPS S3 repository' >&2; exit 1; }
[[ "$PT_BACKUP_ID" =~ ^[a-zA-Z0-9_-]{1,64}$ ]] || exit 1
exec 9>"${PT_LOCK_FILE:-/run/lock/poketracker-backup-$PT_BACKUP_ID.lock}"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
status="$PT_DATA_DIR/recovery-status.json"
status_helper="$(dirname "$0")/status.py"
trap 'python3 "$status_helper" "$status" backup_failed; echo "Off-host backup failed; the previous recovery point is unchanged" >&2' ERR
snapshot=$(docker compose -f "$PT_COMPOSE_FILE" exec -T poketracker node --disable-warning=ExperimentalWarning /app/bundle/recovery.mjs snapshot)
name=$(python3 -c 'import json,re,sys; n=json.load(sys.stdin)["name"]; assert re.fullmatch(r"snapshot-\d+-[\w-]+",n); print(n)' <<<"$snapshot")
captured=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["capturedAt"])' <<<"$snapshot")
source_dir="$PT_DATA_DIR/recovery-snapshots/$name"
[ -f "$source_dir/manifest.json" ]
docker compose -f "$PT_COMPOSE_FILE" exec -T poketracker node --disable-warning=ExperimentalWarning /app/bundle/recovery.mjs verify "/data/recovery-snapshots/$name" >/dev/null
restic backup --host "$PT_BACKUP_ID" --tag poketracker "$source_dir"
python3 "$status_helper" "$status" uploaded "$captured"
# Retention deliberately groups by stable instance and tag, not the unique source directory.
restic forget --host "$PT_BACKUP_ID" --tag poketracker --group-by host,tags --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --prune
python3 - "$PT_DATA_DIR/recovery-snapshots" <<'PY'
import pathlib,re,shutil,sys
root=pathlib.Path(sys.argv[1])
snapshots=sorted((p for p in root.iterdir() if p.is_dir() and not p.is_symlink() and re.fullmatch(r'snapshot-\d+-[\w-]+',p.name)),reverse=True)
for old in snapshots[2:]: shutil.rmtree(old)
PY
