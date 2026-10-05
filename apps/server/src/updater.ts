import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tar from 'tar';
import { HttpError, type Ctx } from './context.ts';

/**
 * Self-updater: checks GitHub Releases, then downloads, verifies and stages a new bundle for
 * the launcher to start. This process never replaces its own files; it writes pending.json and
 * exits, and the launcher (which has the only copy of state.json) does the swap and rollback.
 *
 * Self-update protocol shared with apps/launcher/launcher.mjs:
 *   /data/app/<version>/        unpacked bundle (server.mjs, web/, manifest.json)
 *   /data/app/pending.json      written by us: { version, backup } or { rollback: true }
 *   /data/app/state.json        written by the launcher: { active, previous, last }
 * We exit with RESTART_CODE and the launcher health-gates the new version, rolling back if it fails.
 */
export const RESTART_CODE = 75;
/** Generous for server.mjs plus the web build; stops a hostile feed from filling the disk. */
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
  last?: { from?: string; to?: string; ok: boolean; at: string; message?: string; rolledBack?: boolean; restoredDb?: boolean; kind?: 'update' | 'rollback' | 'image' };
}

/**
 * Auto-update must not undo the owner's decision or retry a known-bad release every night:
 * skip a version the owner rolled back from, or one that failed its health check.
 */
export function autoUpdateBlockedFor(ctx: Ctx, version: string): boolean {
  const last = readLauncherState(ctx).last;
  if (!last) return false;
  if (last.kind === 'rollback' && last.ok && last.from === version) return true;
  if (!last.ok && last.to === version) return true;
  return false;
}

const appDir = (ctx: Ctx) => join(ctx.config.dataDir, 'app');

/**
 * Semver-ish comparison, kept identical to the launcher's copy so both agree on "newer".
 * Pre-release tags compare as plain strings, and a release outranks its pre-releases.
 */
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

/** Last check result and apply progress. Kept in the DB so the UI can poll it across a restart. */
export function readUpdateState(ctx: Ctx): UpdateState {
  const row = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'update_state'");
  return row ? JSON.parse(row.value) : {};
}

function writeUpdateState(ctx: Ctx, patch: Partial<UpdateState>) {
  const next = { ...readUpdateState(ctx), ...patch };
  ctx.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('update_state', ?)", JSON.stringify(next));
  return next;
}

/** The launcher's view of versions. Read-only here; an empty object if the file is absent. */
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

/**
 * Asks GitHub for the latest release and records it. Never throws: the error is stored so the
 * UI and the update-check job can report it. Only asset names that match the tag are picked up,
 * so a stray upload on the release can't be mistaken for the bundle.
 */
export async function checkForUpdate(ctx: Ctx): Promise<UpdateState> {
  try {
    const rel = (await gh(ctx, `${ctx.config.githubApi}/repos/${ctx.config.githubRepo}/releases/latest`)) as {
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

/** Downloads into memory with a size cap, checked against the header first and the body after. */
async function download(url: string, max: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new Error('Download too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('Download too large');
  return buf;
}

/**
 * Verifies a bundle against its published sha256 and our baked-in Ed25519 key. Throws on mismatch.
 *
 * The checksum only catches corruption, since it comes from the same release as the bundle.
 * The signature is what proves authenticity: the private key never leaves CI, so a compromised
 * GitHub account or release feed can't ship code to installs. This must run before the archive
 * is extracted or parsed, so nothing from an unverified file touches disk as code.
 */
export function verifyBundle(publicKeyPem: string, bundle: Buffer, checksumText: string, signatureB64: string) {
  const digest = createHash('sha256').update(bundle).digest('hex');
  // Accepts sha256sum format: "<hex>  <file name>".
  const expected = checksumText.trim().split(/\s+/)[0].toLowerCase();
  if (digest !== expected) throw new Error('Checksum mismatch: the download is corrupt or has been tampered with');
  // Ed25519 hashes internally, so the algorithm argument is null.
  const ok = verify(null, bundle, createPublicKey(publicKeyPem), Buffer.from(signatureB64.trim(), 'base64'));
  if (!ok) throw new Error('Signature check failed: this release was not signed by the PokéTracker release key');
  return digest;
}

/** In-process guard against a double click and the nightly job applying at the same time. */
let applying = false;

/**
 * Downloads, verifies and stages the latest release, backs up the DB, then asks to restart.
 * The order is deliberate:
 *   1. verify before unpacking, so unsigned bytes are never extracted;
 *   2. unpack into a hidden temp folder and rename into place, so the launcher never sees a
 *      half-written version folder;
 *   3. check manifest.minLauncher, because a bundle that relies on newer launcher behaviour
 *      can only arrive with a new image;
 *   4. back up last, as close to the restart as possible, so the backup the launcher restores
 *      on failure includes everything written up to the update;
 *   5. write pending.json only once everything else succeeded, since it is the commit point.
 */
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
    // strict turns tar warnings into errors. preservePaths: false strips leading "/" and skips
    // ".." entries, so a crafted archive can't write outside tmp (path traversal).
    // The signature already vouches for the archive; this is defence in depth.
    await tar.x({ file, cwd: tmp, strict: true, preservePaths: false });
    rmSync(file, { force: true });
    const manifest = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf8')) as { version: string; minLauncher?: string };
    // The signed manifest must agree with the release tag, so a validly signed old bundle
    // can't be replayed under a newer tag.
    if (manifest.version !== rel.version) throw new Error('Bundle version does not match the release');
    if (!existsSync(join(tmp, 'server.mjs'))) throw new Error('Bundle is missing the server');
    if (manifest.minLauncher && compareVersions(ctx.config.launcherVersion || '0.0.0', manifest.minLauncher) < 0) {
      rmSync(tmp, { recursive: true, force: true });
      throw new HttpError(409, `Version ${rel.version} needs a newer container image. Redeploy or pull the latest image to update.`, 'launcher_too_old');
    }
    // Clears a leftover folder from an earlier failed attempt at this version.
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmp, dest);

    progress('Backing up');
    const backup = join(ctx.config.dataDir, 'backups', `pre-update-${ctx.config.version}-to-${rel.version}-${Date.now()}.db`);
    ctx.db.backupTo(backup);

    progress('Restarting');
    // The launcher restores `backup` if the new version fails its health check.
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

/**
 * Asks the launcher to go back to the previous version. The DB is not restored here: older
 * code runs against the current schema, which is why migrations must be additive.
 */
export function requestRollback(ctx: Ctx) {
  const blocker = updateBlocker(ctx);
  if (blocker) throw new HttpError(409, blocker, 'update_unavailable');
  const ls = readLauncherState(ctx);
  if (!ls.previous) throw new HttpError(409, 'There is no previous version to roll back to', 'no_previous');
  writeFileSync(join(appDir(ctx), 'pending.json'), JSON.stringify({ rollback: true, from: ctx.config.version, at: new Date().toISOString() }));
  ctx.services.requestRestart?.(RESTART_CODE);
  return { version: ls.previous };
}

/**
 * Clears update progress left behind by the process that restarted into us. Without this the
 * UI would show "Restarting" forever, since the old process exits before it can clear it.
 */
export function settleUpdateState(ctx: Ctx) {
  const s = readUpdateState(ctx);
  if (s.applying) writeUpdateState(ctx, { applying: false, progress: undefined });
}

/**
 * Removes unpacked versions other than the active and previous one. Previous is kept so a
 * rollback works offline; our own version is kept in case state.json is missing or stale.
 */
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
