import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('off-host failures preserve the last recovery point and never prune', () => {
  const root = mkdtempSync(join(tmpdir(), 'pt-backup-job-'));
  try {
    const bin = join(root, 'bin'); mkdirSync(bin);
    const name = 'snapshot-1234567890000-synthetic';
    const source = join(root, 'recovery-snapshots', name); mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'manifest.json'), '{}');
    const status = join(root, 'recovery-status.json');
    writeFileSync(status, JSON.stringify({ lastSuccessfulCaptureAt: '2026-01-01T00:00:00Z' }));
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\ncase "$*" in *snapshot) echo \'{"name":"'+name+'","capturedAt":"2026-01-02T00:00:00Z"}\';; *) exit 0;; esac\n', { mode: 0o700 });
    writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(bin, 'restic'), '#!/bin/sh\necho "$*" >> "$PT_TEST_LOG"\n[ "$1" != backup ] || exit 1\n', { mode: 0o700 });
    const config = join(root, 'backup.env');
    writeFileSync(config, `PT_DATA_DIR='${root}'\nPT_COMPOSE_FILE='${root}/compose.yml'\nPT_BACKUP_ID=test\nRESTIC_REPOSITORY=azure:synthetic:/test\nRESTIC_PASSWORD_FILE='${root}/password'\nPT_LOCK_FILE='${root}/lock'\n`, { mode: 0o600 });
    const result = spawnSync('bash', [resolve('deploy/backup/backup.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, POKETRACKER_BACKUP_CONFIG: config, PT_TEST_LOG: join(root, 'calls') } });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    const recorded = JSON.parse(readFileSync(status, 'utf8'));
    assert.equal(recorded.lastSuccessfulCaptureAt, '2026-01-01T00:00:00Z');
    assert.equal(recorded.lastError, 'backup_failed');
    assert.ok(!readFileSync(join(root, 'calls'), 'utf8').includes('forget'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verification errors never advance the successful restore-verification timestamp', () => {
  const root = mkdtempSync(join(tmpdir(), 'pt-backup-status-'));
  try {
    const file = join(root, 'status.json');
    const run = (event, ...args) => {
      const result = spawnSync('python3', [resolve('deploy/backup/status.py'), file, event, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    run('verified'); const before = JSON.parse(readFileSync(file, 'utf8'));
    run('verification_failed'); const after = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(after.lastRestoreVerifiedAt, before.lastRestoreVerifiedAt);
    assert.equal(after.verificationError, 'verification_failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
