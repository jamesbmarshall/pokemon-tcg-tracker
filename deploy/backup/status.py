#!/usr/bin/env python3
"""Atomically merge host backup outcomes without losing concurrent verification updates."""
import datetime
import fcntl
import json
import os
import sys

path, event, *args = sys.argv[1:]
with open(path + '.lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        if os.stat(path).st_size > 65536:
            raise ValueError('Status exceeds limit')
        with open(path) as stream:
            value = json.load(stream)
        if not isinstance(value, dict):
            value = {}
    except (OSError, ValueError):
        value = {}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if event == 'uploaded':
        captured = args[0]
        datetime.datetime.fromisoformat(captured.replace('Z', '+00:00'))
        value.update(lastSuccessfulCaptureAt=captured, lastUploadedAt=now, lastError=None)
    elif event == 'backup_failed':
        value.update(lastAttemptAt=now, lastError=event)
    elif event == 'checked':
        value.update(lastCheckedAt=now)
    elif event == 'verified':
        value.update(lastCheckedAt=now, lastRestoreVerifiedAt=now, verificationError=None)
    elif event == 'verification_failed':
        value.update(lastVerificationAttemptAt=now, verificationError=event)
    else:
        raise SystemExit('Unsupported status event')
    value['version'] = 1
    temporary = path + '.tmp'
    with open(temporary, 'w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)
    parent = os.open(os.path.dirname(path), os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
