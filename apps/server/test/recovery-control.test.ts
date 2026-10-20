import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { startRecoveryControl } from '../src/recoveryControl.ts';
import { startServer, type TestServer } from './helpers.ts';
let s: TestServer; let stop: (() => Promise<void>) | undefined;
beforeEach(async () => { s = await startServer(); stop = await startRecoveryControl(s.ctx); });
afterEach(async () => { await stop?.(); await s.close(); });
function request(command: string) {
  return new Promise<Record<string, unknown>>((accept, reject) => {
    const socket = createConnection(join(s.dir, 'control.sock'));
    let input = '';
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.on('data', (chunk) => { input += chunk.toString(); });
    socket.on('end', () => { try { accept(JSON.parse(input)); } catch (e) { reject(e); } });
  });
}
it('exposes only fixed host commands on a private local socket', async () => {
  expect(statSync(join(s.dir, 'control.sock')).mode & 0o777).toBe(0o600);
  expect(await request('status')).toMatchObject({ ok: true, result: { snapshotRunning: false } });
  expect(await request('arbitrary-shell-command')).toMatchObject({ ok: false });
  expect(await request('snapshot')).toMatchObject({ ok: true, result: { files: 4 } });
});
