import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { storagePolicy, runtimeDirectory } from '../src/storage.ts';
import { acquireInstanceLock } from '../src/instanceLock.ts';
import { startRecoveryControl } from '../src/recoveryControl.ts';
import { diagnostics } from '../src/diagnostics.ts';
import { startServer } from './helpers.ts';

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, statfsSync: vi.fn(fs.statfsSync) };
});
afterEach(() => vi.mocked(statfsSync).mockReset());
function networkMount(dir: string, type = 0xff534d42) {
  const disk = statfsSync(dir);
  vi.mocked(statfsSync).mockReturnValue({ ...disk, type });
}

it('uses rollback journaling and a warning for SMB/NFS rather than rejecting startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-network-'));
  try {
    const disk = statfsSync(dir);
    for (const type of [0x6969, 0xff534d42, 0xfe534d42, 0x01021997, 0x00c36400]) {
      vi.mocked(statfsSync).mockReturnValue({ ...disk, type });
      expect(storagePolicy(dir, 'wal')).toMatchObject({ network: true, journalMode: 'delete', warning: expect.stringContaining('independent backups') });
    }
    vi.mocked(statfsSync).mockReturnValue({ ...disk, type: 0xef53 });
    expect(storagePolicy(dir, 'wal')).toEqual({ network: false, journalMode: 'wal', warning: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('keeps network-mount locks local while still excluding a second process on the same host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-network-'));
  networkMount(dir);
  const runtime = runtimeDirectory(dir);
  let release: (() => void) | undefined;
  try {
    expect(runtime).not.toBe(dir);
    expect(runtimeDirectory(dir)).toBe(runtime);
    release = acquireInstanceLock(dir);
    expect(() => acquireInstanceLock(dir)).toThrow('Another PokéTracker process');
    release(); release = undefined;
    acquireInstanceLock(dir)();
  } finally { release?.(); rmSync(dir, { recursive: true, force: true }); rmSync(runtime, { recursive: true, force: true }); }
});

it('serves recovery commands from a local socket and reports the network warning to the owner', async () => {
  const s = await startServer();
  networkMount(s.dir);
  const runtime = runtimeDirectory(s.dir);
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = await startRecoveryControl(s.ctx);
    const result = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(join(runtime, 'control.sock'));
      let response = '';
      socket.on('connect', () => socket.write('{"command":"status"}\n'));
      socket.on('data', (chunk) => { response += chunk; });
      socket.on('end', () => resolve(response));
      socket.on('error', reject);
    });
    expect(JSON.parse(result)).toMatchObject({ ok: true, result: { snapshotRunning: false } });
    expect(diagnostics(s.ctx).storageWarning).toContain('Network storage detected');
  } finally { await stop?.(); await s.close(); rmSync(runtime, { recursive: true, force: true }); }
});
