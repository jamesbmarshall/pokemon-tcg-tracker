#!/usr/bin/env bash
set -euo pipefail
config=${POKETRACKER_BACKUP_CONFIG:-/etc/poketracker-backup.env}
python3 - "$config" <<'PY'
import os,stat,sys
s=os.stat(sys.argv[1])
if s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode)&0o077: raise SystemExit('Unsafe backup configuration permissions')
PY
set -a
# shellcheck source=/dev/null
source "$config"
set +a
: "${PT_DATA_DIR:?}" "${PT_BACKUP_ID:?}" "${PT_IMAGE:?Set the compatible application image digest}" "${RESTIC_PASSWORD_FILE:?}" "${RESTIC_REPOSITORY:?}"
[[ "$PT_IMAGE" =~ ^[a-zA-Z0-9./_-]+@sha256:[a-f0-9]{64}$ ]] || { echo 'PT_IMAGE must be pinned by digest' >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
status_helper="$(dirname "$0")/status.py"
trap 'python3 "$status_helper" "$PT_DATA_DIR/recovery-status.json" verification_failed' ERR
restic check --read-data
python3 "$status_helper" "$PT_DATA_DIR/recovery-status.json" checked
id=$(restic snapshots --host "$PT_BACKUP_ID" --tag poketracker --latest 1 --json | python3 -c 'import json,sys; rows=json.load(sys.stdin); assert len(rows)==1; print(rows[0]["id"])')
restic restore "$id" --target "$work" --verify
relative=$(python3 - "$work" <<'PY'
import pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
files=list(root.rglob('manifest.json'))
assert len(files)==1, 'Expected exactly one complete application snapshot'
source=files[0].parent.resolve()
assert source.is_relative_to(root)
print(source.relative_to(root))
PY
)
docker run --rm --network none --read-only --tmpfs /tmp --entrypoint node -v "$work:/restore:rw" "$PT_IMAGE" --disable-warning=ExperimentalWarning /app/bundle/recovery.mjs verify "/restore/$relative"
docker run --rm --network none --read-only --tmpfs /tmp --entrypoint node -v "$work:/restore:rw" "$PT_IMAGE" --disable-warning=ExperimentalWarning /app/bundle/recovery.mjs restore "/restore/$relative" /restore/rehearsal
python3 "$status_helper" "$PT_DATA_DIR/recovery-status.json" verified
