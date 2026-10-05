import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tar from 'tar';
import { HttpError, type Ctx } from './context.ts';

/**
 * Self-update protocol shared with apps/launcher/launcher.mjs:
 *   /data/app/<version>/        unpacked bundle (server.mjs, web/, manifest.json)
 *   /data/app/pending.json      written by us: { version, backup } or { rollback: true }
 *   /data/app/state.json        written by the launcher: { active, previous, last }
 * We exit with RESTART_CODE and the launcher health-gates the new version, rolling back if it fails.
 */
export const RESTART_CODE = 75;
const MAX_BUNDLE = 150 * 1024 * 1024;

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
  bundle?: string;
  checksum?: string;
  signature?: string;
}

export interface UpdateState {
  checkedAt?: string;
  latest?: ReleaseInfo;
  error?: string;
  applying?: boolean;
  progress?: string;
}

export interface LauncherState {
  active?: string;
  previous?: string;
  last?: { from?: string; to?: string; ok: boolean; at: string; message?: string; rolledBack?: boolean };
}

const appDir = (ctx: Ctx) => join(ctx.config.dataDir, 'app');

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function readUpdateState(ctx: Ctx): UpdateState {
  const row = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'update_state'");
  return row ? JSON.parse(row.value) : {};
}

function writeUpdateState(ctx: Ctx, patch: Partial<UpdateState>) {
  const next = { ...readUpdateState(ctx), ...patch };
  ctx.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('update_state', ?)", JSON.stringify(next));
  return next;
}

export function readLauncherState(ctx: Ctx): LauncherState {
  try {
    return JSON.parse(readFileSync(join(appDir(ctx), 'state.json'), 'utf8'));
  } catch {
    return {};
  }
}

export const autoUpdateEnabled = (ctx: Ctx) => ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'auto_update'")?.value === '1';

/** Why in-app updates can't run here, or undefined if they can. */
export function updateBlocker(ctx: Ctx): string | undefined {
  if (!ctx.config.supervised) return 'This server is not running under the PokéTracker launcher, so it cannot update itself. Pull the latest image instead.';
  if (!ctx.config.updatePublicKey) return 'No update signing key is configured, so downloaded updates cannot be verified.';
  return undefined;
}

async function gh(ctx: Ctx, url: string) {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `PokeTracker/${ctx.config.version}`, 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  return res.json();
}

export async function checkForUpdate(ctx: Ctx): Promise<UpdateState> {
  try {
    const rel = (await gh(ctx, `https://api.github.com/repos/${ctx.config.githubRepo}/releases/latest`)) as {
      tag_name: string;
      name: string;
      body: string;
      html_url: string;
      published_at: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const version = rel.tag_name.replace(/^v/, '');
    const asset = (suffix: string) => rel.assets.find((a) => a.name === `poketracker-${version}${suffix}`)?.browser_download_url;
    const latest: ReleaseInfo = {
      version,
      name: rel.name || rel.tag_name,
      notes: (rel.body ?? '').slice(0, 20_000),
      url: rel.html_url,
      publishedAt: rel.published_at,
      bundle: asset('.tar.gz'),
      checksum: asset('.tar.gz.sha256'),
      signature: asset('.tar.gz.sig'),
    };
    return writeUpdateState(ctx, { checkedAt: new Date().toISOString(), latest, error: undefined });
  } catch (err) {
    return writeUpdateState(ctx, { checkedAt: new Date().toISOString(), error: (err as Error).message });
  }
}

export const updateAvailable = (ctx: Ctx, s = readUpdateState(ctx)) => !!s.latest && compareVersions(s.latest.version, ctx.config.version) > 0;

async function download(url: string, max: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new Error('Download too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('Download too large');
  return buf;
}

/** Verifies a bundle against its published sha256 and our baked-in Ed25519 key. Throws on mismatch. */
export function verifyBundle(publicKeyPem: string, bundle: Buffer, checksumText: string, signatureB64: string) {
  const digest = createHash('sha256').update(bundle).digest('hex');
  const expected = checksumText.trim().split(/\s+/)[0].toLowerCase();
  if (digest !== expected) throw new Error('Checksum mismatch: the download is corrupt or has been tampered with');
  const ok = verify(null, bundle, createPublicKey(publicKeyPem), Buffer.from(signatureB64.trim(), 'base64'));
  if (!ok) throw new Error('Signature check failed: this release was not signed by the PokéTracker release key');
  return digest;
}

let applying = false;

export async function applyUpdate(ctx: Ctx, reason = 'manual'): Promise<{ version: string }> {
  const blocker = updateBlocker(ctx);
  if (blocker) throw new HttpError(409, blocker, 'update_unavailable');
  if (applying) throw new HttpError(409, 'An update is already in progress', 'update_busy');
  const state = readUpdateState(ctx);
  const rel = state.latest;
  if (!rel || !updateAvailable(ctx, state)) throw new HttpError(409, "You're already on the latest version", 'up_to_date');
  if (!rel.bundle || !rel.checksum || !rel.signature) throw new HttpError(409, 'This release has no installable bundle', 'no_bundle');

  applying = true;
  const progress = (p: string) => writeUpdateState(ctx, { applying: true, progress: p, error: undefined });
  try {
    progress('Downloading');
    const [bundle, checksum, signature] = await Promise.all([download(rel.bundle, MAX_BUNDLE), download(rel.checksum, 1024), download(rel.signature, 4096)]);
    progress('Verifying');
    verifyBundle(ctx.config.updatePublicKey, bundle, checksum.toString('utf8'), signature.toString('utf8'));

    progress('Unpacking');
    const root = appDir(ctx);
    const tmp = join(root, `.incoming-${rel.version}`);
    const dest = join(root, rel.version);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const file = join(root, `.incoming-${rel.version}.tar.gz`);
    writeFileSync(file, bundle);
    await tar.x({ file, cwd: tmp, strict: true, preservePaths: false });
    rmSync(file, { force: true });
    const manifest = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf8')) as { version: string; minLauncher?: string };
    if (manifest.version !== rel.version) throw new Error('Bundle version does not match the release');
    if (!existsSync(join(tmp, 'server.mjs'))) throw new Error('Bundle is missing the server');
    if (manifest.minLauncher && compareVersions(ctx.config.launcherVersion || '0.0.0', manifest.minLauncher) < 0) {
      rmSync(tmp, { recursive: true, force: true });
      throw new HttpError(409, `Version ${rel.version} needs a newer container image. Redeploy or pull the latest image to update.`, 'launcher_too_old');
    }
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmp, dest);

    progress('Backing up');
    const backup = join(ctx.config.dataDir, 'backups', `pre-update-${ctx.config.version}-to-${rel.version}-${Date.now()}.db`);
    ctx.db.backupTo(backup);

    progress('Restarting');
    writeFileSync(join(root, 'pending.json'), JSON.stringify({ version: rel.version, from: ctx.config.version, backup, reason, at: new Date().toISOString() }));
    ctx.db.run(
      'INSERT INTO audit_log (at, user_id, action, target, ip, detail) VALUES (?, NULL, ?, ?, NULL, ?)',
      new Date().toISOString(),
      'system.update_applied',
      rel.version,
      JSON.stringify({ from: ctx.config.version, reason }),
    );
    ctx.services.requestRestart?.(RESTART_CODE);
    return { version: rel.version };
  } catch (err) {
    writeUpdateState(ctx, { applying: false, progress: undefined, error: (err as Error).message });
    throw err instanceof HttpError ? err : new HttpError(502, (err as Error).message, 'update_failed');
  } finally {
    applying = false;
  }
}

export function requestRollback(ctx: Ctx) {
  const blocker = updateBlocker(ctx);
  if (blocker) throw new HttpError(409, blocker, 'update_unavailable');
  const ls = readLauncherState(ctx);
  if (!ls.previous) throw new HttpError(409, 'There is no previous version to roll back to', 'no_previous');
  writeFileSync(join(appDir(ctx), 'pending.json'), JSON.stringify({ rollback: true, from: ctx.config.version, at: new Date().toISOString() }));
  ctx.services.requestRestart?.(RESTART_CODE);
  return { version: ls.previous };
}

/** Clears update progress left behind by the process that restarted into us. */
export function settleUpdateState(ctx: Ctx) {
  const s = readUpdateState(ctx);
  if (s.applying) writeUpdateState(ctx, { applying: false, progress: undefined });
}

/** Removes unpacked versions other than the active and previous one. */
export function pruneVersions(ctx: Ctx) {
  const root = appDir(ctx);
  if (!existsSync(root)) return 0;
  const ls = readLauncherState(ctx);
  const keep = new Set([ls.active, ls.previous, ctx.config.version].filter(Boolean));
  let n = 0;
  for (const name of readdirSync(root)) {
    if (/^\d+\.\d+\.\d+/.test(name) && !keep.has(name)) {
      rmSync(join(root, name), { recursive: true, force: true });
      n++;
    }
  }
  return n;
}
