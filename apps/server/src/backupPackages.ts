import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, fsyncSync, openSync, closeSync, chmodSync } from 'node:fs';
import { copyFile, open } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import * as tar from 'tar';
import { bad, HttpError, type Ctx } from './context.ts';
import { createRecoverySnapshot, restoreRecoverySnapshot, validateRecoverySnapshot } from './recovery.ts';
import { assertStorage } from './resourceLimits.ts';
import { pruneBackups } from './jobs.ts';
import { newId } from './security.ts';

const root = (ctx: Ctx) => join(ctx.config.dataDir, 'backup-packages');
function syncPath(path: string) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
const pattern = /^poketracker-(daily|manual|before-restore)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)-[\w-]+\.tar\.gz$/;
const active = new WeakMap<Ctx, Promise<unknown>>();
export function packagePath(ctx: Ctx, name: string) {
  if (!pattern.test(name)) return undefined;
  const path = join(root(ctx), name);
  return existsSync(path) && lstatSync(path).isFile() ? path : undefined;
}
export function listPackages(ctx: Ctx) {
  if (!existsSync(root(ctx))) return [];
  return readdirSync(root(ctx)).filter(name => pattern.test(name) && lstatSync(join(root(ctx), name)).isFile()).map(name => {
    const match = pattern.exec(name)!;
    return { name, kind: match[1], createdAt: match[2].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'), size: statSync(join(root(ctx), name)).size };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** Union of 14 distinct days, 3 distinct months and 1 distinct year; manual copies remain. */
export function retainedPackages<T extends { name: string; kind: string; createdAt: string }>(files: T[]) {
  const keep = new Set(files.filter(f => f.kind !== 'daily').map(f => f.name));
  const sorted = files.filter(f => f.kind === 'daily').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const [length, count] of [[10, 14], [7, 3], [4, 1]]) {
    const periods = new Set<string>();
    for (const f of sorted) {
      const period = f.createdAt.slice(0, length);
      if (periods.has(period) || periods.size >= count) continue;
      periods.add(period); keep.add(f.name);
    }
  }
  return keep;
}
function prune(ctx: Ctx) {
  const files = listPackages(ctx); const keep = retainedPackages(files);
  for (const f of files) if (!keep.has(f.name)) rmSync(join(root(ctx), f.name));
}
function setting(ctx: Ctx, key: string) { return ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value; }
function save(ctx: Ctx, key: string, value: string) { ctx.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value); }
export function packageStatus(ctx: Ctx) {
  const job = ctx.db.get<{ last_status: string }>("SELECT last_status FROM jobs WHERE name = 'backup'");
  return { files: listPackages(ctx), running: active.has(ctx), error: setting(ctx, 'backup_package_error') || (job?.last_status === 'error' ? 'The last automatic backup failed. Try Back up now; your existing backups have been kept.' : null), automatic: ctx.config.jobs, schedule: 'Daily at 03:00 (server time)', retention: { daily: 14, monthly: 3, yearly: 1 }, canRestore: ctx.config.supervised && !!ctx.services.requestRestart,
    sync: { available: !!ctx.config.backupSyncDir, enabled: setting(ctx, 'backup_sync_enabled') === '1', copiedAt: setting(ctx, 'backup_sync_at') ?? null, error: setting(ctx, 'backup_sync_error') ?? null } };
}

/** Reclaim only automatic copies under pressure. Always retain the newest complete
 * package and every manual/before-restore package, even when this means refusing a backup. */
function preparePackageStorage(ctx: Ctx) {
  prune(ctx);
  const files = listPackages(ctx);
  // Once a complete replacement exists, keep just the newest legacy daily DB copy.
  // Pre-update rollback copies and user-created backups have their own retention.
  pruneBackups(ctx, files.length > 0 ? 1 : undefined);
  const required = statSync(ctx.db.file).size * 3;
  const removable = files.filter(f => f.kind === 'daily' && f.name !== files[0]?.name).reverse();
  for (;;) {
    try { assertStorage(ctx, required); return; }
    catch (error) {
      const next = removable.shift();
      if (!next) throw error;
      rmSync(join(root(ctx), next.name));
    }
  }
}

/** HTTP callers start work and poll status rather than waiting through an ingress timeout. */
export function startPackage(ctx: Ctx) {
  const work = createPackage(ctx);
  void work.catch(error => ctx.log.warn({ err: error }, 'Manual backup failed'));
}

export async function drainPackageWork(ctx: Ctx) { await active.get(ctx)?.catch(() => undefined); }

/** Called once at boot after the instance lock and staging cleanup. A restart is a
 * failed attempt, never a successful backup or an instruction to retry immediately. */
export function settleBackupState(ctx: Ctx) {
  const interrupted = ctx.db.get("SELECT 1 FROM jobs WHERE name = 'backup' AND last_status = 'running'");
  ctx.db.run("UPDATE jobs SET last_status = 'error', last_finished_at = ?, last_error = 'Interrupted by server restart; retry delayed' WHERE last_status = 'running'", new Date().toISOString());
  if (interrupted || setting(ctx, 'backup_package_running') === '1') {
    save(ctx, 'backup_package_error', 'The previous backup was interrupted by a server restart. Temporary files have been cleaned up; your existing backups are safe.');
  }
  save(ctx, 'backup_package_running', '0');
}
export function setPackageSync(ctx: Ctx, enabled: boolean) {
  if (enabled && !ctx.config.backupSyncDir) throw bad('Connect a synced backup folder on the server first.');
  save(ctx, 'backup_sync_enabled', enabled ? '1' : '0');
}
async function syncPackages(ctx: Ctx) {
  if (setting(ctx, 'backup_sync_enabled') !== '1') return;
  const target = ctx.config.backupSyncDir;
  if (!target) throw new Error('Backup folder is not connected');
  const destination = resolve(target); const data = resolve(ctx.config.dataDir);
  if (destination === data || destination.startsWith(data + sep) || data.startsWith(destination + sep)) throw new Error('Use a separate synced folder outside the app data directory');
  // Require the mount to exist: never silently create a directory when a mounted drive is missing.
  if (!existsSync(destination) || !lstatSync(destination).isDirectory()) throw new Error('Backup folder is unavailable');
  let instance = setting(ctx, 'backup_folder_id');
  if (!instance) { instance = newId(); save(ctx, 'backup_folder_id', instance); }
  const folder = join(destination, `poketracker-${instance}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const f of listPackages(ctx)) {
    const dest = join(folder, f.name);
    if (existsSync(dest) && lstatSync(dest).isFile() && statSync(dest).size === f.size) continue;
    const staged = join(folder, `.incoming-${newId()}`);
    try { await copyFile(join(root(ctx), f.name), staged); renameSync(staged, dest); }
    finally { rmSync(staged, { force: true }); }
  }
  const remote = readdirSync(folder).filter(name => pattern.test(name)).map(name => {
    const match = pattern.exec(name)!;
    return { name, kind: match[1], createdAt: match[2] };
  });
  const keep = retainedPackages(remote);
  for (const f of remote) if (!keep.has(f.name)) rmSync(join(folder, f.name));
  save(ctx, 'backup_sync_at', new Date().toISOString()); save(ctx, 'backup_sync_error', '');
}
export function createPackage(ctx: Ctx, kind: 'daily' | 'manual' | 'before-restore' = 'manual'): Promise<{ name: string }> {
  if (existsSync(join(ctx.config.dataDir, 'pending-restore.json'))) throw new HttpError(409, 'A restore is waiting for restart.');
  if (active.has(ctx)) throw new HttpError(409, 'A backup or restore is already running.');
  const work = (async () => {
    mkdirSync(root(ctx), { recursive: true, mode: 0o700 });
    save(ctx, 'backup_package_error', '');
    save(ctx, 'backup_package_running', '1');
    preparePackageStorage(ctx);
    const snapshot = await createRecoverySnapshot(ctx, true);
    const name = `poketracker-${kind}-${snapshot.capturedAt.replace(/[:.]/g, '-')}-${newId()}.tar.gz`;
    const staged = join(root(ctx), `.incoming-${newId()}`);
    try {
      const manifest = await validateRecoverySnapshot(snapshot.path);
      assertStorage(ctx, manifest.files.reduce((sum, f) => sum + f.bytes, 0));
      await tar.c({ gzip: true, file: staged, cwd: snapshot.path, portable: true, noMtime: true, mode: 0o600 }, ['manifest.json', ...manifest.files.map(f => f.path)]);
      chmodSync(staged, 0o600);
      const fd = await open(staged, 'r'); try { await fd.sync(); } finally { await fd.close(); }
      renameSync(staged, join(root(ctx), name)); syncPath(root(ctx)); syncPath(ctx.config.dataDir);
      prune(ctx);
    } finally { rmSync(staged, { force: true }); rmSync(snapshot.path, { recursive: true, force: true }); }
    try { await syncPackages(ctx); }
    catch { save(ctx, 'backup_sync_error', 'The backup is saved on this server, but copying to the connected folder failed. Check the folder connection and available space.'); }
    return { name };
  })().catch(error => {
    const message = error instanceof HttpError ? error.message : 'The backup could not finish. Your existing backups are safe. Try again; if it keeps failing, contact the server owner.';
    save(ctx, 'backup_package_error', message);
    throw error;
  }).finally(() => save(ctx, 'backup_package_running', '0'));
  active.set(ctx, work);
  void work.finally(() => { if (active.get(ctx) === work) active.delete(ctx); }).catch(() => {});
  return work;
}

const MAX_ARCHIVE = 10 * 1024 ** 3;
/** Extract only regular files from our manifest vocabulary. Reject links, duplicates and bombs. */
export async function unpackPackage(file: string, destination: string, ctx?: Ctx) {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const seen = new Set<string>(); let bytes = 0;
  const allowed = /^(?:manifest\.json|poketracker\.db|secret\.key|recovery-config\.json|app\/write-protocol-floor\.json|(?:photos|sealed-photos)\/[\w-]{1,64})$/;
  const unpack = new tar.Unpack({ cwd: destination, strict: true, preservePaths: false, chmod: false,
    filter: (path, entry) => {
      bytes += entry.size;
      try {
        if (!allowed.test(path) || !('type' in entry) || entry.type !== 'File' || seen.has(path) || seen.size >= 100_005 || bytes > MAX_ARCHIVE || (path === 'manifest.json' && entry.size > 16 * 1024 ** 2)) throw bad('This is not a supported complete backup package.');
        if (ctx) assertStorage(ctx, entry.size);
      } catch (error) { unpack.abort(error as Error); return false; }
      seen.add(path); return true;
    },
  });
  await pipeline(createReadStream(file), unpack);
  return validateRecoverySnapshot(destination);
}

/** Stage verified data; it is installed only on startup after the old server has closed. */
export async function stageRestore(ctx: Ctx, source: { name: string } | { stream: Readable }) {
  if (!ctx.config.supervised || !ctx.services.requestRestart) throw bad('Restoring here requires the PokéTracker launcher. Use the packaged restore command on a stopped server.');
  if (existsSync(join(ctx.config.dataDir, 'pending-restore.json'))) throw new HttpError(409, 'A restore is already waiting for restart.');
  if (active.has(ctx)) throw new HttpError(409, 'A backup or restore is already running.');
  // Preserve a complete current backup before replacing any data.
  await createPackage(ctx, 'before-restore');
  const work = (async () => {
    const id = newId(); const area = join(ctx.config.dataDir, `.restore-${id}`);
    mkdirSync(area, { mode: 0o700 });
    let published = false;
    try {
      let file: string;
      if ('name' in source) {
        const found = packagePath(ctx, source.name); if (!found) throw bad('Backup package not found.'); file = found;
      } else {
        file = join(area, 'upload.tar.gz'); let bytes = 0;
        source.stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_ARCHIVE) source.stream.destroy(bad('Backup package exceeds 10 GiB.')); else { try { assertStorage(ctx, chunk.length); } catch (e) { source.stream.destroy(e as Error); } } });
        await pipeline(source.stream, createWriteStream(file, { mode: 0o600, flags: 'wx' }));
        if ('truncated' in source.stream && source.stream.truncated) throw bad('Backup upload was incomplete.');
      }
      const extracted = join(area, 'extracted');
      const manifest = await unpackPackage(file, extracted, ctx);
      assertStorage(ctx, manifest.files.reduce((sum, f) => sum + f.bytes, 0));
      if (process.env.SECRET_KEY && !Buffer.from(process.env.SECRET_KEY, 'base64').equals(Buffer.from(readFileSync(join(extracted, 'secret.key'), 'utf8').trim(), 'base64'))) throw bad('This server uses a fixed encryption key. Ask the server owner to restore this package offline with its original key.');
      const prepared = join(area, 'prepared'); await restoreRecoverySnapshot(extracted, prepared);
      for (const folder of ['photos', 'sealed-photos']) { mkdirSync(join(prepared, folder), { recursive: true, mode: 0o700 }); syncPath(join(prepared, folder)); }
      syncPath(prepared); syncPath(area); syncPath(ctx.config.dataDir);
      const pending = join(area, 'pending.json');
      writeFileSync(pending, JSON.stringify({ id }), { mode: 0o600, flag: 'wx' }); syncPath(pending);
      renameSync(pending, join(ctx.config.dataDir, 'pending-restore.json')); published = true;
      syncPath(area); syncPath(ctx.config.dataDir);
    } catch (e) { if (!published) rmSync(area, { recursive: true, force: true }); throw e; }
  })();
  active.set(ctx, work);
  try { await work; } finally { active.delete(ctx); }
}

/** Replayable per-file moves; interrupted installs finish before opening SQLite or serving requests. */
export function applyPendingRestore(dataDir: string) {
  const marker = join(dataDir, 'pending-restore.json'); if (!existsSync(marker)) return;
  const { id } = JSON.parse(readFileSync(marker, 'utf8')) as { id: string };
  if (!/^[\w-]{16}$/.test(id)) throw new Error('Invalid pending restore');
  const area = join(dataDir, `.restore-${id}`); const prepared = join(area, 'prepared'); const previous = join(area, 'previous');
  mkdirSync(previous, { recursive: true, mode: 0o700 }); syncPath(area);
  for (const file of ['poketracker.db', 'poketracker.db-wal', 'poketracker.db-shm', 'secret.key', 'photos', 'sealed-photos', 'app/write-protocol-floor.json', 'restored-from.json']) {
    const source = join(prepared, file); const target = join(dataDir, file); const old = join(previous, file);
    mkdirSync(join(previous, file, '..'), { recursive: true, mode: 0o700 });
    mkdirSync(join(dataDir, file, '..'), { recursive: true, mode: 0o700 });
    if (existsSync(source)) {
      if (existsSync(target) && !existsSync(old)) renameSync(target, old);
      syncPath(join(previous, file, '..')); syncPath(join(dataDir, file, '..'));
      renameSync(source, target); syncPath(join(prepared, file, '..')); syncPath(join(dataDir, file, '..'));
    } else if ((file.endsWith('-wal') || file.endsWith('-shm')) && existsSync(target) && !existsSync(old)) renameSync(target, old);
  }
  syncPath(previous); syncPath(dataDir);
  rmSync(marker); syncPath(dataDir);
  // A complete before-restore package remains available; remove staging and old live files.
  rmSync(area, { recursive: true, force: true });
}
