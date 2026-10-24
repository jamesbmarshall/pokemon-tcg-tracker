import { assertStorage } from './resourceLimits.ts';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync, chmodSync, openSync, closeSync, fsyncSync, realpathSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { readdir, rm } from 'node:fs/promises';
import { isMainThread } from 'node:worker_threads';
import { recoveryTask } from './recoveryTask.ts';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Ctx } from './context.ts';
import { Db } from './db.ts';
import { MIGRATIONS } from './migrations.ts';
import { newId, Sealer, validateInstanceSecrets } from './security.ts';
import { deferPhotoCleanup, type PhotoKind } from './photoStorage.ts';
import { WRITE_PROTOCOL } from './mutations.ts';

export interface RecoveryManifest {
  format: 'poketracker-instance'; version: 1; capturedAt: string;
  schemaVersion: number; writeProtocol: number; appVersion: string;
  files: { path: string; bytes: number; sha256: string }[];
}
const allowedPath = /^(?:poketracker\.db|secret\.key|recovery-config\.json|app\/write-protocol-floor\.json|(?:photos|sealed-photos)\/[\w-]{1,64})$/;
const active = new WeakSet<Ctx>();
export const snapshotRunning = (ctx: Ctx) => active.has(ctx);

export async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function syncFile(path: string) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Called only while owning the instance lock and with no recovery operation in flight.
 * Completed CLI snapshots and published backups are never removed by crash cleanup. */
export async function cleanupInterruptedRecovery(dataDir: string) {
  for (const [folder, pattern] of [
    ['recovery-snapshots', /^(?:\.incoming-snapshot-|\.package-snapshot-)\d+-[\w-]{16}$/],
    ['backup-packages', /^\.incoming-[\w-]{16}$/],
    ['backups', /^[\w.-]+\.db\.incoming-[\w-]{16}$/],
  ] as const) {
    const root = join(dataDir, folder);
    const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) if (entry.isDirectory() || entry.isFile()) {
      if (pattern.test(entry.name)) await rm(join(root, entry.name), { recursive: true, force: true });
    }
  }
}

/** Capture and validate on a worker. Keep photo garbage collection deferred on the
 * serving thread because the online backup's final point can include concurrent edits. */
export async function createRecoverySnapshot(ctx: Ctx, temporary = false, name = `snapshot-${Date.now()}-${newId()}`): Promise<{ path: string; name: string; capturedAt: string; files: number }> {
  if (active.has(ctx) || ctx.services.isStopping?.()) throw new Error('Recovery snapshot unavailable: another snapshot or shutdown is in progress');
  active.add(ctx);
  if (isMainThread) {
    const release = deferPhotoCleanup(ctx);
    try {
      return await recoveryTask({ action: 'snapshot', config: ctx.config, key: ctx.sealer.recoveryKey(), temporary, name });
    } catch (error) {
      await rm(join(ctx.config.dataDir, 'recovery-snapshots', `.incoming-${name}`), { recursive: true, force: true });
      if (temporary) await rm(join(ctx.config.dataDir, 'recovery-snapshots', `.package-${name}`), { recursive: true, force: true });
      throw error;
    } finally { release(); active.delete(ctx); }
  }
  const root = join(ctx.config.dataDir, 'recovery-snapshots');
  const staged = join(root, `.incoming-${name}`);
  const destination = join(root, temporary ? `.package-${name}` : name);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(staged, { mode: 0o700 });
    assertStorage(ctx, lstatSync(ctx.db.file).size * 3);
    await ctx.db.backupTo(join(staged, 'poketracker.db'));
    const capturedAt = new Date().toISOString();
    const copy = new Db(join(staged, 'poketracker.db'), 'delete');
    let photos: { kind: PhotoKind; id: string }[];
    let schemaVersion: number;
    try {
      schemaVersion = copy.schemaVersion;
      photos = [
        ...copy.all<{ id: string }>('SELECT id FROM graded_photos').map(p => ({ kind: 'photos' as const, id: p.id })),
        ...copy.all<{ id: string }>('SELECT id FROM tcg_photos').map(p => ({ kind: 'photos' as const, id: p.id })),
        ...copy.all<{ id: string }>('SELECT id FROM sealed_photos').map(p => ({ kind: 'sealed-photos' as const, id: p.id })),
      ];
      if (photos.some(p => !/^[\w-]{1,64}$/.test(p.id))) throw new Error('Invalid photo ID in database; recovery snapshot aborted');
      assertStorage(ctx, lstatSync(ctx.db.file).size * 2 + photos.reduce((sum, p) => sum + lstatSync(join(ctx.config.dataDir, p.kind, p.id)).size, 0));
      copy.exec('DELETE FROM http_cache; DELETE FROM images; VACUUM;');
    }
    finally { copy.close(); }
    writeFileSync(join(staged, 'secret.key'), ctx.sealer.recoveryKey().toString('base64'), { mode: 0o600 });
    writeFileSync(join(staged, 'recovery-config.json'), JSON.stringify({ PUBLIC_URL: ctx.config.publicUrl, SQLITE_JOURNAL_MODE: ctx.config.journalMode, PRICE_HISTORY_DAYS: ctx.config.priceHistoryDays, BACKUPS_TO_KEEP: ctx.config.backupsToKeep, IMAGE_CACHE_MB: ctx.config.imageCacheMb, keySource: 'secret.key' }), { mode: 0o600 });
    mkdirSync(join(staged, 'app'), { mode: 0o700 });
    writeFileSync(join(staged, 'app/write-protocol-floor.json'), JSON.stringify({ protocol: WRITE_PROTOCOL }), { mode: 0o600 });
    const paths = ['poketracker.db', 'secret.key', 'recovery-config.json', 'app/write-protocol-floor.json'];
    for (const photo of photos) {
      const path = `${photo.kind}/${photo.id}`;
      mkdirSync(join(staged, photo.kind), { recursive: true, mode: 0o700 });
      const source = join(ctx.config.dataDir, path);
      if (!lstatSync(source).isFile() || !realpathSync(source).startsWith(realpathSync(ctx.config.dataDir) + sep)) throw new Error(`Unsafe photo file: ${path}`);
      await copyFile(source, join(staged, path));
      paths.push(path);
    }
    const manifest: RecoveryManifest = { format: 'poketracker-instance', version: 1, capturedAt, schemaVersion, writeProtocol: WRITE_PROTOCOL, appVersion: ctx.config.version, files: [] };
    for (const path of paths) {
      const file = join(staged, path); chmodSync(file, 0o600); syncFile(file);
      manifest.files.push({ path, bytes: lstatSync(file).size, sha256: await fileDigest(file) });
    }
    writeFileSync(join(staged, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    syncFile(join(staged, 'manifest.json'));
    await validateRecoverySnapshot(staged);
    for (const dir of new Set(paths.map((path) => dirname(join(staged, path))))) syncFile(dir);
    syncFile(staged); renameSync(staged, destination); syncFile(root);
    return { path: destination, name, capturedAt, files: manifest.files.length };
  } catch (error) {
    rmSync(staged, { recursive: true, force: true }); throw error;
  } finally { active.delete(ctx); }
}

export async function validateRecoverySnapshot(source: string): Promise<RecoveryManifest> {
  if (isMainThread) return recoveryTask({ action: 'validate', source });
  const root = realpathSync(source);
  const manifestPath = join(root, 'manifest.json');
  const stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid recovery manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RecoveryManifest;
  if (manifest.format !== 'poketracker-instance' || manifest.version !== 1 || !Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1 || manifest.schemaVersion > MIGRATIONS.length || !Number.isSafeInteger(manifest.writeProtocol) || manifest.writeProtocol < 0 || manifest.writeProtocol > WRITE_PROTOCOL || !Number.isFinite(Date.parse(manifest.capturedAt)) || !Array.isArray(manifest.files) || manifest.files.length > 100_000) throw new Error('Unsupported or invalid recovery format/schema/write protocol');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !allowedPath.test(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid or duplicate recovery file path');
    seen.add(file.path);
    const path = join(root, file.path);
    const info = lstatSync(path);
    if (!info.isFile() || !realpathSync(path).startsWith(root + sep) || info.size !== file.bytes || await fileDigest(path) !== file.sha256) throw new Error(`Recovery file failed validation: ${file.path}`);
  }
  for (const required of ['poketracker.db', 'secret.key', 'recovery-config.json', 'app/write-protocol-floor.json']) if (!seen.has(required)) throw new Error(`Recovery file missing: ${required}`);
  const raw = new DatabaseSync(join(root, 'poketracker.db'), { readOnly: true });
  try {
    if (raw.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || raw.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Recovery database integrity failed');
    const schema = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
    if (schema !== manifest.schemaVersion) throw new Error('Recovery schema does not match its manifest');
    const key = Buffer.from(readFileSync(join(root, 'secret.key'), 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('Recovery key is invalid');
    validateInstanceSecrets({ all: <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[] }, new Sealer(key));
    for (const [kind, table] of [['photos', 'graded_photos'], ['sealed-photos', 'sealed_photos']] as const) {
      for (const photo of raw.prepare(`SELECT id FROM ${table}`).all()) if (!seen.has(`${kind}/${photo.id}`)) throw new Error('Recovery snapshot is missing referenced photos');
    }
    if (raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tcg_photos'").get()) {
      for (const photo of raw.prepare('SELECT id FROM tcg_photos').all()) if (!seen.has(`photos/${photo.id}`)) throw new Error('Recovery snapshot is missing game photos');
    }
  } finally { raw.close(); }
  return manifest;
}

/** Offline restore never replaces an existing instance. Activate the verified directory only
 * after this completes; the running server owns its own process lock at startup.
 */
export async function restoreRecoverySnapshot(source: string, destination: string): Promise<{ restoredTo: string; capturedAt: string }> {
  if (isMainThread) return recoveryTask({ action: 'restore', source, destination });
  const target = resolve(destination);
  if (existsSync(target) && readdirSync(target).length) throw new Error('Restore requires a new or empty destination; stop and preserve the existing instance');
  const manifest = await validateRecoverySnapshot(source);
  mkdirSync(dirname(target), { recursive: true });
  const staged = `${target}.restoring-${newId()}`;
  mkdirSync(staged, { mode: 0o700 });
  try {
    for (const file of manifest.files) {
      const path = join(staged, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      await copyFile(join(source, file.path), path); chmodSync(path, 0o600); syncFile(path);
    }
    writeFileSync(join(staged, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    await validateRecoverySnapshot(staged);
    renameSync(join(staged, 'manifest.json'), join(staged, 'restored-from.json'));
    // Fresh sessions are required after restoring a host; idempotency receipts are retained.
    const db = new Db(join(staged, 'poketracker.db'), 'delete');
    try { db.migrate(); db.run('DELETE FROM sessions'); } finally { db.close(); }
    if (existsSync(target)) { if (readdirSync(target).length) throw new Error('Restore destination changed during validation'); rmdirSync(target); }
    for (const dir of new Set(manifest.files.map((file) => dirname(join(staged, file.path))))) syncFile(dir);
    syncFile(join(staged, 'poketracker.db'));
    syncFile(staged); renameSync(staged, target); syncFile(dirname(target));
    return { restoredTo: target, capturedAt: manifest.capturedAt };
  } catch (error) { rmSync(staged, { recursive: true, force: true }); throw error; }
}
