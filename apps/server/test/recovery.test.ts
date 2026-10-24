import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { cleanupInterruptedRecovery, createRecoverySnapshot, restoreRecoverySnapshot, validateRecoverySnapshot } from '../src/recovery.ts';
import { reconcilePhotos } from '../src/photoStorage.ts';
import { savePhoto } from '../src/collections.ts';
import { setPcKey } from '../src/providers/pricecharting.ts';
import { Db } from '../src/db.ts';
import { Sealer, validateInstanceSecrets } from '../src/security.ts';
import { startServer, setupOwner, personalId, type TestServer } from './helpers.ts';
let s: TestServer;
beforeEach(async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response('[]'))); s = await startServer(); });
afterEach(async () => { await s.close(); vi.unstubAllGlobals(); });

it('restores complete collector data, photos and encrypted integration secrets into a fresh instance', async () => {
  const c = await setupOwner(s.app); const id = await personalId(c);
  await c.put(`/api/collections/${id}/graded/slab`, { cardId: 'sv1-001', variant: 'normal', company: 'PSA', grade: '10' });
  await c.post(`/api/collections/${id}/lists`, { name: 'Recovery deck', kind: 'deck', format: 'standard' });
  const photo = savePhoto(s.ctx, id, 'slab', 'front', Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
  setPcKey(s.ctx, 'synthetic-provider-key');
  const share = await c.post('/api/shares', { collectionId: id, scope: 'graded', audience: 'public' });
  expect(share.statusCode).toBe(200);
  const snapshot = await createRecoverySnapshot(s.ctx);
  expect((await validateRecoverySnapshot(snapshot.path)).files.some((f) => f.path === `photos/${photo.id}`)).toBe(true);
  const target = join(s.dir, 'restored');
  await restoreRecoverySnapshot(snapshot.path, target);
  const db = new Db(join(target, 'poketracker.db'));
  try {
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM lists')!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mutation_receipts')!.n).toBeGreaterThan(0);
    const sealer = new Sealer(Buffer.from(readFileSync(join(target, 'secret.key'), 'utf8'), 'base64'));
    expect(() => validateInstanceSecrets(db, sealer)).not.toThrow();
    expect(sealer.open(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'pricecharting_key'")!.value)).toBe('synthetic-provider-key');
    expect(readFileSync(join(target, 'photos', photo.id))).toEqual(readFileSync(join(s.dir, 'photos', photo.id)));
  } finally { db.close(); }
  await expect(restoreRecoverySnapshot(snapshot.path, target)).rejects.toThrow('new or empty destination');
});

it('pins captured photos while concurrent deletion and reconciliation occur', async () => {
  const c = await setupOwner(s.app); const id = await personalId(c);
  await c.put(`/api/collections/${id}/graded/slab`, { cardId: 'sv1-001', variant: 'normal', company: 'PSA', grade: '10' });
  const photo = savePhoto(s.ctx, id, 'slab', 'front', Buffer.from([0xff, 0xd8, 0xff, 1]));
  const pending = createRecoverySnapshot(s.ctx);
  s.ctx.db.run('DELETE FROM graded_photos WHERE id = ?', photo.id);
  reconcilePhotos(s.ctx, 0);
  expect(existsSync(join(s.dir, 'photos', photo.id))).toBe(true);
  const snapshot = await pending;
  await expect(validateRecoverySnapshot(snapshot.path)).resolves.toMatchObject({ version: 1 });
  reconcilePhotos(s.ctx, 0);
  expect(existsSync(join(s.dir, 'photos', photo.id))).toBe(false);
});

it('rejects corrupt bytes and path traversal before creating a restore destination', async () => {
  await setupOwner(s.app);
  const snapshot = await createRecoverySnapshot(s.ctx);
  const target = join(s.dir, 'must-not-exist');
  writeFileSync(join(snapshot.path, 'secret.key'), 'corrupt');
  await expect(restoreRecoverySnapshot(snapshot.path, target)).rejects.toThrow('failed validation');
  expect(existsSync(target)).toBe(false);
  const manifest = JSON.parse(readFileSync(join(snapshot.path, 'manifest.json'), 'utf8'));
  manifest.files[0].path = '../outside';
  writeFileSync(join(snapshot.path, 'manifest.json'), JSON.stringify(manifest));
  await expect(validateRecoverySnapshot(snapshot.path)).rejects.toThrow('file path');
  rmSync(snapshot.path, { recursive: true, force: true });
});

it('keeps HTTP health checks responsive while the backup worker waits on SQLite locks', async () => {
  await setupOwner(s.app);
  s.ctx.db.exec('PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;');
  let finished = false;
  const pending = createRecoverySnapshot(s.ctx).finally(() => { finished = true; });
  let probes = 0;
  try {
    const deadline = Date.now() + 700;
    while (Date.now() < deadline) {
      expect((await s.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      probes++;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(finished).toBe(false);
    expect(probes).toBeGreaterThan(10);
  } finally { s.ctx.db.exec('ROLLBACK'); }
  const snapshot = await pending;
  await expect(validateRecoverySnapshot(snapshot.path)).resolves.toMatchObject({ version: 1 });
});

it('reclaims killed snapshot/package staging without deleting completed recovery points or following links', async () => {
  const root = join(s.dir, 'recovery-snapshots'); mkdirSync(root);
  const incomplete = join(root, '.incoming-snapshot-123-abcdefghijklmnop'); mkdirSync(incomplete);
  const temporary = join(root, '.package-snapshot-123-abcdefghijklmnop'); mkdirSync(temporary);
  const complete = join(root, 'snapshot-123-abcdefghijklmnop'); mkdirSync(complete);
  const preserved = join(s.dir, 'preserved'); mkdirSync(preserved); writeFileSync(join(preserved, 'keep'), 'keep');
  symlinkSync(preserved, join(root, '.incoming-snapshot-456-abcdefghijklmnop'));
  const packages = join(s.dir, 'backup-packages'); mkdirSync(packages);
  writeFileSync(join(packages, '.incoming-abcdefghijklmnop'), 'partial archive');
  writeFileSync(join(packages, 'manual.tar.gz'), 'published archive');
  await cleanupInterruptedRecovery(s.dir);
  expect(existsSync(incomplete)).toBe(false);
  expect(existsSync(temporary)).toBe(false);
  expect(existsSync(complete)).toBe(true);
  expect(existsSync(join(preserved, 'keep'))).toBe(true);
  expect(existsSync(join(packages, '.incoming-abcdefghijklmnop'))).toBe(false);
  expect(existsSync(join(packages, 'manual.tar.gz'))).toBe(true);
});
