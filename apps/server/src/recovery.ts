import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync, chmodSync, openSync, closeSync, fsyncSync, realpathSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Ctx } from './context.ts';
import { Db } from './db.ts';
import { MIGRATIONS } from './migrations.ts';
import { newId, Sealer, validateInstanceSecrets } from './security.ts';
import { pinPhotos, type PhotoKind } from './photoStorage.ts';
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

/** VACUUM and reference capture are synchronous, so no JS mutation can interleave there.
 * Immutable files remain pinned during asynchronous copying; ordinary use then resumes.
 */
export async function createRecoverySnapshot(ctx: Ctx) {
  if (active.has(ctx) || ctx.services.isStopping?.()) throw new Error('Recovery snapshot unavailable: another snapshot or shutdown is in progress');
  active.add(ctx);
  const root = join(ctx.config.dataDir, 'recovery-snapshots');
  const name = `snapshot-${Date.now()}-${newId()}`;
  const staged = join(root, `.incoming-${name}`);
  const destination = join(root, name);
  let release = () => {};
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(staged, { mode: 0o700 });
    const photos = [
      ...ctx.db.all<{ id: string }>('SELECT id FROM graded_photos').map((p) => ({ kind: 'photos' as PhotoKind, id: p.id })),
      ...ctx.db.all<{ id: string }>('SELECT id FROM sealed_photos').map((p) => ({ kind: 'sealed-photos' as PhotoKind, id: p.id })),
    ];
    release = pinPhotos(ctx, photos);
    const capturedAt = new Date().toISOString();
    ctx.db.backupTo(join(staged, 'poketracker.db'));
    const copy = new Db(join(staged, 'poketracker.db'), 'delete');
    try { copy.exec('DELETE FROM http_cache; DELETE FROM images; VACUUM;'); }
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
    const manifest: RecoveryManifest = { format: 'poketracker-instance', version: 1, capturedAt, schemaVersion: ctx.db.schemaVersion, writeProtocol: WRITE_PROTOCOL, appVersion: ctx.config.version, files: [] };
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
  } finally { release(); active.delete(ctx); }
}

export async function validateRecoverySnapshot(source: string): Promise<RecoveryManifest> {
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
  } finally { raw.close(); }
  return manifest;
}

/** Offline restore never replaces an existing instance. Activate the verified directory only
 * after this completes; the running server owns its own process lock at startup.
 */
export async function restoreRecoverySnapshot(source: string, destination: string) {
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
