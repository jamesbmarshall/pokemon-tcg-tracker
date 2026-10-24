import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, readdirSync, renameSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import * as tar from 'tar';
import { applyPendingRestore, createPackage, listPackages, packagePath, packageStatus, retainedPackages, setPackageSync, stageRestore, unpackPackage } from '../src/backupPackages.ts';
import { Db } from '../src/db.ts';
import { savePhoto } from '../src/collections.ts';
import { runJob } from '../src/jobs.ts';
import { invite, personalId, setupOwner, startServer, type TestServer } from './helpers.ts';
let s: TestServer;
let databaseClosed = false;
beforeEach(async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response('[]'))); s = await startServer(); databaseClosed = false; });
afterEach(async () => { if (databaseClosed) rmSync(s.dir, { recursive: true, force: true }); else await s.close(); vi.unstubAllGlobals(); });

it('schedules complete packages including photos and keys, downloads only as owner and preserves legacy db downloads', async () => {
  const owner = await setupOwner(s.app); const id = await personalId(owner);
  await owner.put(`/api/collections/${id}/graded/slab`, { cardId: 'sv1-001', variant: 'normal', company: 'PSA', grade: '10' });
  const photo = savePhoto(s.ctx, id, 'slab', 'front', Buffer.from([0xff, 0xd8, 0xff, 1]));
  await runJob(s.ctx, 'backup');
  const status = (await owner.get('/api/admin/backup-packages')).json();
  expect(status.files).toHaveLength(1); expect(status.files[0].kind).toBe('daily');
  expect(readdirSync(join(s.dir, 'recovery-snapshots'))).toEqual([]);
  const pkg = packagePath(s.ctx, status.files[0].name)!;
  expect(statSync(pkg).mode & 0o777).toBe(0o600);
  const source = join(s.dir, 'extracted'); await unpackPackage(pkg, source);
  expect(readFileSync(join(source, 'photos', photo.id))).toEqual(readFileSync(join(s.dir, 'photos', photo.id)));
  expect(Buffer.from(readFileSync(join(source, 'secret.key'), 'utf8'), 'base64')).toEqual(s.ctx.sealer.recoveryKey());
  const member = await invite(owner, s.app, 'misty');
  for (const client of [member, await invite(owner, s.app, 'brock', 'admin')]) {
    expect((await client.get('/api/admin/backup-packages')).statusCode).toBe(403);
    expect((await client.post('/api/admin/backup-packages')).statusCode).toBe(403);
    expect((await client.get(`/api/admin/backup-packages/${status.files[0].name}`)).statusCode).toBe(403);
    expect((await client.post('/api/admin/backup-packages/restore', { name: status.files[0].name, confirm: 'RESTORE' })).statusCode).toBe(403);
  }
  const download = await owner.get(`/api/admin/backup-packages/${status.files[0].name}`);
  expect(download.statusCode).toBe(200); expect(download.rawPayload).toEqual(readFileSync(pkg));
  const old = (await owner.post('/api/admin/backups')).json();
  expect((await owner.get(`/api/admin/backups/${old.name}`)).statusCode).toBe(200);
  expect(packagePath(s.ctx, '../../secret.key')).toBeUndefined();
});

it('retains a union of daily, monthly and yearly periods, and every manual backup', () => {
  const files = Array.from({ length: 400 }, (_, i) => ({ name: `day-${i}`, kind: 'daily', createdAt: new Date(Date.UTC(2026, 9, 22) - i * 86400000).toISOString() }));
  files.push({ name: 'manual', kind: 'manual', createdAt: '2020-01-01' });
  const keep = retainedPackages(files);
  for (let i = 0; i < 14; i++) expect(keep.has(`day-${i}`)).toBe(true);
  expect(keep.has('day-21')).toBe(false);
  expect(keep.has('day-22')).toBe(true); // September's latest
  expect(keep.has('day-52')).toBe(true); // August's latest
  expect(keep.has('day-83')).toBe(false);
  expect(keep.has('manual')).toBe(true);
});

it('copies packages to the connected folder and reports a disconnected destination without losing the local backup', async () => {
  await setupOwner(s.app);
  const drive = join(s.dir, '..', `pt-sync-${Date.now()}`); mkdirSync(drive);
  s.ctx.config.backupSyncDir = drive; setPackageSync(s.ctx, true);
  try {
    const pkg = await createPackage(s.ctx);
    const folder = readdirSync(drive)[0];
    expect(readFileSync(join(drive, folder, pkg.name))).toEqual(readFileSync(packagePath(s.ctx, pkg.name)!));
    expect(packageStatus(s.ctx).sync.copiedAt).toBeTruthy();
    s.ctx.config.backupSyncDir = join(drive, 'missing');
    await createPackage(s.ctx);
    expect(packageStatus(s.ctx).sync.error).toMatch(/copying.*failed/);
    expect(listPackages(s.ctx)).toHaveLength(2);
    expect(existsSync(s.ctx.config.backupSyncDir)).toBe(false);
  } finally { rmSync(drive, { recursive: true, force: true }); }
});

it('rejects symlinks and corrupt archives without touching live data or leaving a restore marker', async () => {
  await setupOwner(s.app); s.ctx.config.supervised = true; s.ctx.services.requestRestart = vi.fn();
  const bad = join(s.dir, 'bad'); mkdirSync(bad); symlinkSync('/etc/passwd', join(bad, 'secret.key'));
  const file = join(s.dir, 'bad.tar.gz'); await tar.c({ cwd: bad, gzip: true, file }, ['secret.key']);
  await expect(unpackPackage(file, join(s.dir, 'unpacked'))).rejects.toThrow();
  expect(existsSync(join(s.dir, 'unpacked', 'secret.key'))).toBe(false);
  await expect(stageRestore(s.ctx, { stream: Readable.from('corrupt') })).rejects.toThrow();
  expect(existsSync(join(s.dir, 'pending-restore.json'))).toBe(false);
  expect(s.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n).toBe(1);
});

it('stages a complete restore, blocks writes and resumes an interrupted installation before opening the restored db', async () => {
  const owner = await setupOwner(s.app);
  s.ctx.config.supervised = true; s.ctx.services.requestRestart = vi.fn();
  const { name } = await createPackage(s.ctx);
  s.ctx.db.run("UPDATE users SET display_name = 'Changed'");
  await stageRestore(s.ctx, { name });
  expect(listPackages(s.ctx).some(f => f.kind === 'before-restore')).toBe(true);
  expect((await owner.post('/api/admin/backup-packages')).statusCode).toBe(503);
  await s.app.close(); s.ctx.db.close(); databaseClosed = true;
  const { id } = JSON.parse(readFileSync(join(s.dir, 'pending-restore.json'), 'utf8'));
  const area = join(s.dir, `.restore-${id}`); mkdirSync(join(area, 'previous'));
  renameSync(join(s.dir, 'poketracker.db'), join(area, 'previous', 'poketracker.db'));
  applyPendingRestore(s.dir); applyPendingRestore(s.dir);
  const restored = new Db(join(s.dir, 'poketracker.db'));
  expect(restored.get<{ display_name: string }>('SELECT display_name FROM users')!.display_name).toBe('Ash');
  expect(restored.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n).toBe(0);
  expect(existsSync(join(s.dir, 'pending-restore.json'))).toBe(false);
  restored.close();
});

it('accepts a complete multipart upload through the owner route and requests restart after responding', async () => {
  const owner = await setupOwner(s.app); s.ctx.config.supervised = true;
  s.ctx.services.requestRestart = vi.fn();
  const { name } = await createPackage(s.ctx);
  const boundary = 'backup-upload-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="package"; filename="backup.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`),
    readFileSync(packagePath(s.ctx, name)!), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const result = await owner.req('POST', '/api/admin/backup-packages/restore', payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json()).toEqual({ restarting: true });
  expect(s.ctx.services.requestRestart).toHaveBeenCalledOnce();
  expect(existsSync(join(s.dir, 'pending-restore.json'))).toBe(true);
});

it('reports failed automatic backups without publishing an incomplete package', async () => {
  await setupOwner(s.app);
  s.ctx.db.run("INSERT INTO jobs (name, last_status) VALUES ('backup', 'error')");
  expect(packageStatus(s.ctx).error).toMatch(/last automatic backup failed/);
  expect(listPackages(s.ctx)).toEqual([]);
});

it('accepts a manual backup immediately and exposes the completed background result', async () => {
  const owner = await setupOwner(s.app);
  const response = await owner.post('/api/admin/backup-packages');
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ running: true });
  expect(packageStatus(s.ctx).running).toBe(true);
  await vi.waitFor(() => expect(packageStatus(s.ctx).running).toBe(false), { timeout: 10_000 });
  expect(packageStatus(s.ctx).error).toBeNull();
  expect(listPackages(s.ctx)).toHaveLength(1);
});
