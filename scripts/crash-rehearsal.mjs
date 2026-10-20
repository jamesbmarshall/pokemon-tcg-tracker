#!/usr/bin/env node
/** Exercise actual bundled startup, SIGKILL, WAL recovery, process locking and receipt replay. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
const dir = mkdtempSync(join(tmpdir(), 'pt-crash-'));
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child; let logs = '';
function launch() {
  logs = '';
  const process = spawn(globalThis.process.execPath, [resolve('apps/server/dist/server.mjs')], { env: { ...globalThis.process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', JOBS: '0', SETUP_TOKEN: 'crash-test-setup-token', LOG_LEVEL: 'silent', TCGDEX_BASE: 'http://127.0.0.1:1/v2' }, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.on('data', bytes => { logs += bytes; }); process.stderr.on('data', bytes => { logs += bytes; });
  return process;
}
async function ready() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Child exited: ${logs}`);
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Waiting for listen. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Startup timed out: ${logs}`);
}
let cookie = '';
async function request(path, method = 'GET', body, headers = {}) {
  return fetch(`${base}${path}`, { method, headers: { 'x-poketracker': '1', 'content-type': 'application/json', cookie, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
try {
  child = launch(); await ready();
  const setup = await request('/api/setup', 'POST', { token: 'crash-test-setup-token', username: 'crashowner', password: 'synthetic crash test password' });
  assert.equal(setup.status, 200); cookie = setup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const collection = (await (await request('/api/collections')).json())[0].id;
  const path = `/api/collections/${collection}/entries/adjust`;
  const body = { cardId: 'sv1-001', variant: 'normal', delta: 1 };
  const headers = { 'idempotency-key': 'crash-acknowledged-write' };
  assert.equal((await request(path, 'POST', body, headers)).status, 200);
  child.kill('SIGKILL'); await once(child, 'exit');
  child = launch(); await ready();
  const state = await (await request(`/api/collections/${collection}/state`)).json();
  assert.equal(state.entries[0].quantity, 1);
  const replay = await request(path, 'POST', body, headers);
  assert.equal(replay.status, 200); assert.equal(replay.headers.get('x-mutation-replayed'), '1');
  assert.equal((await (await request(`/api/collections/${collection}/state`)).json()).entries[0].quantity, 1);
  const duplicate = launch(); const [code] = await once(duplicate, 'exit'); assert.equal(code, 1); assert.match(logs, /Another PokéTracker process owns this data directory/);
  console.log('PASS: acknowledged write survived SIGKILL, replay was applied once, second writer refused.');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  rmSync(dir, { recursive: true, force: true });
}
