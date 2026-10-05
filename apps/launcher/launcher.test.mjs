import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { compareVersions } from './launcher.mjs';

// A stand-in server bundle: serves /health with its manifest version, exits 75 on /restart.
const FAKE_SERVER = `
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const { version, broken } = JSON.parse(readFileSync(process.env.APP_MANIFEST, 'utf8'));
if (broken) process.exit(1);
const srv = createServer((req, res) => {
  if (req.url === '/restart') { res.end('ok'); setTimeout(() => process.exit(75), 50); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, version, launcher: process.env.POKETRACKER_LAUNCHER_VERSION }));
});
srv.listen(Number(process.env.PORT), '127.0.0.1');
process.on('SIGTERM', () => srv.close(() => process.exit(0)));
`;

function bundle(dir, version, extra = {}) {
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'server.mjs'), FAKE_SERVER);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version, ...extra }));
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let root, data, port, proc;
const appDir = () => join(data, 'app');
const state = () => JSON.parse(readFileSync(join(appDir(), 'state.json'), 'utf8'));
const health = async () => (await fetch(`http://127.0.0.1:${port}/health`)).json();

async function until(fn, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}
const runningVersion = (v) => until(async () => (await health()).version === v && state().active === v);
const restart = () => fetch(`http://127.0.0.1:${port}/restart`).catch(() => {});

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'pt-launcher-'));
  data = join(root, 'data');
  bundle(join(root, 'image'), '1.0.0');
  port = await freePort();
  proc = spawn(process.execPath, [join(import.meta.dirname, 'launcher.mjs')], {
    env: { ...process.env, DATA_DIR: data, BUNDLE_DIR: join(root, 'image'), PORT: String(port), HEALTH_TIMEOUT_MS: '5000' },
    stdio: 'ignore',
  });
});

after(async () => {
  if (proc.exitCode === null) {
    proc.kill('SIGTERM');
    await new Promise((r) => proc.once('exit', r));
  }
  rmSync(root, { recursive: true, force: true });
});

test('compareVersions', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
});

test('boots the image bundle and reports the launcher version', async () => {
  await runningVersion('1.0.0');
  assert.equal((await health()).launcher, '1.0.0');
  assert.equal(state().image, '1.0.0');
});

test('applies a staged update', async () => {
  bundle(join(appDir(), '1.1.0'), '1.1.0');
  writeFileSync(join(appDir(), 'pending.json'), JSON.stringify({ version: '1.1.0' }));
  await restart();
  await runningVersion('1.1.0');
  const s = state();
  assert.equal(s.previous, '1.0.0');
  assert.equal(s.last.ok, true);
});

test('rolls back a broken update and restores the database backup', async () => {
  writeFileSync(join(data, 'poketracker.db'), 'migrated-by-1.2.0');
  writeFileSync(join(data, 'backup.db'), 'before-1.2.0');
  bundle(join(appDir(), '1.2.0'), '1.2.0', { broken: true });
  writeFileSync(join(appDir(), 'pending.json'), JSON.stringify({ version: '1.2.0', backup: join(data, 'backup.db') }));
  await restart();
  await until(() => state().last?.rolledBack);
  await runningVersion('1.1.0');
  const s = state();
  assert.equal(s.last.to, '1.2.0');
  assert.equal(s.last.restoredDb, true);
  assert.equal(s.previous, '1.0.0');
  assert.equal(readFileSync(join(data, 'poketracker.db'), 'utf8'), 'before-1.2.0');
  assert.equal(existsSync(join(appDir(), '1.2.0')), false);
});

test('rolls back on request and stays there across restarts', async () => {
  writeFileSync(join(appDir(), 'pending.json'), JSON.stringify({ rollback: true }));
  await restart();
  await runningVersion('1.0.0');
  assert.equal(state().previous, '1.1.0');
  await restart();
  await new Promise((r) => setTimeout(r, 500));
  await runningVersion('1.0.0');
});

test('exits cleanly on SIGTERM', async () => {
  proc.kill('SIGTERM');
  const code = await new Promise((r) => proc.once('exit', r));
  assert.equal(code, 0);
});
