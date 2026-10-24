import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readdirSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPackage, packageStatus, settleBackupState } from '../src/backupPackages.ts';
import { STORAGE_RESERVE } from '../src/resourceLimits.ts';
import { setupOwner, startServer, type TestServer } from './helpers.ts';

vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, statfsSync: vi.fn(fs.statfsSync) };
});
let s: TestServer;
beforeEach(async () => { s = await startServer(); await setupOwner(s.app); });
afterEach(async () => { vi.mocked(statfsSync).mockRestore(); await s.close(); });
const name = (day: string, kind = 'daily') => `poketracker-${kind}-2026-10-${day}T03-00-00-000Z-abcdefghijklmnop.tar.gz`;

it('reclaims older automatic packages before admission while preserving manual and newest recovery points', async () => {
  const root = join(s.dir, 'backup-packages'); mkdirSync(root);
  for (const file of [name('21'), name('22'), name('23'), name('20', 'manual')]) writeFileSync(join(root, file), Buffer.alloc(2 * 1024 ** 2));
  const disk = statfsSync(s.dir);
  const required = statSync(s.ctx.db.file).size * 3;
  vi.mocked(statfsSync).mockImplementation(() => ({ ...disk, bsize: 1, bavail: STORAGE_RESERVE + required - 1 + (4 - readdirSync(root).filter(f => f.endsWith('.tar.gz')).length) * 2 * 1024 ** 2 }));
  await createPackage(s.ctx);
  expect(existsSync(join(root, name('21')))).toBe(false);
  expect(existsSync(join(root, name('23')))).toBe(true);
  expect(existsSync(join(root, name('20', 'manual')))).toBe(true);
});

it('fails safely when only protected copies remain, and exposes the asynchronous error', async () => {
  const root = join(s.dir, 'backup-packages'); mkdirSync(root);
  for (const file of [name('23'), name('20', 'manual')]) writeFileSync(join(root, file), 'protected');
  const disk = statfsSync(s.dir);
  vi.mocked(statfsSync).mockReturnValue({ ...disk, bsize: 1, bavail: STORAGE_RESERVE });
  await expect(createPackage(s.ctx)).rejects.toThrow(/Storage is too full/);
  expect(readdirSync(root).sort()).toEqual([name('23'), name('20', 'manual')].sort());
  expect(packageStatus(s.ctx).error).toMatch(/Storage is too full/);
});

it('marks interrupted jobs and manual backups as failed at boot without retrying them', () => {
  s.ctx.db.run("INSERT INTO jobs (name, last_status, last_started_at) VALUES ('backup', 'running', ?)", new Date().toISOString());
  s.ctx.db.run("INSERT INTO settings (key, value) VALUES ('backup_package_running', '1')");
  settleBackupState(s.ctx);
  expect(s.ctx.db.get<{ last_status: string }>("SELECT last_status FROM jobs WHERE name = 'backup'")!.last_status).toBe('error');
  expect(packageStatus(s.ctx).running).toBe(false);
  expect(packageStatus(s.ctx).error).toMatch(/interrupted by a server restart/);
});
