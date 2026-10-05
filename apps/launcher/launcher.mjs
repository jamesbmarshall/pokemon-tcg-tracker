#!/usr/bin/env node
// PokéTracker launcher: supervises the server, applies staged updates and rolls back bad ones.
// Plain Node, no dependencies. Baked into the container image; changes here need an image pull.
// Because old launchers must keep running new server bundles, the protocol below only grows;
// a bundle that needs newer launcher behaviour says so with manifest.minLauncher.
//
// Layout (see apps/server/src/updater.ts):
//   $BUNDLE_DIR                 bundle shipped in the image (server.mjs, web/, manifest.json)
//   $DATA_DIR/app/<version>/    bundles downloaded by in-app updates
//   $DATA_DIR/app/pending.json  { version, backup } to try a new version, or { rollback: true }
//   $DATA_DIR/app/state.json    { image, active, previous, last }: written here only
import { spawn } from 'node:child_process';
import { chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LAUNCHER_VERSION = '1.0.0';
// Must match RESTART_CODE in apps/server/src/updater.ts. 75 is EX_TEMPFAIL: "try again".
const RESTART_CODE = 75;

const DATA_DIR = process.env.DATA_DIR || '/data';
const BUNDLE_DIR = process.env.BUNDLE_DIR || '/app/bundle';
const PORT = Number(process.env.PORT || 3000);
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 90_000);
const APP_DIR = join(DATA_DIR, 'app');
const STATE = join(APP_DIR, 'state.json');
const PENDING = join(APP_DIR, 'pending.json');
const DB = join(DATA_DIR, 'poketracker.db');

// Same JSON-lines shape as the server's pino logs, so container log viewers parse both alike.
const log = (msg, extra) => process.stdout.write(`${JSON.stringify({ level: 30, time: Date.now(), name: 'launcher', msg, ...extra })}\n`);
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
// Write-then-rename so a crash or power cut never leaves a half-written state file.
const writeJson = (file, value) => {
  mkdirSync(APP_DIR, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${file}.tmp`, file);
};

/** Kept identical to compareVersions in apps/server/src/updater.ts so both agree on "newer". */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).replace(/^v/, '').split('-', 2);
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

const imageVersion = () => readJson(join(BUNDLE_DIR, 'manifest.json'))?.version;

/**
 * Chowns a tree, skipping anything already owned correctly and never following symlinks.
 * Skipping keeps restarts fast on large image caches; not following symlinks stops a link
 * planted in /data from making root chown files elsewhere on the system.
 */
function chownTree(path, uid, gid) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return;
  if (st.uid !== uid || st.gid !== gid) chownSync(path, uid, gid);
  if (st.isDirectory()) for (const name of readdirSync(path)) chownTree(join(path, name), uid, gid);
}

/**
 * Whether a data folder with this owner/mode can be written by uid:gid once we drop root.
 * Exported for tests.
 */
export function writableBy({ uid, gid, mode }, target) {
  if (uid === target.uid) return (mode & 0o200) !== 0;
  if (gid === target.gid) return (mode & 0o020) !== 0;
  return (mode & 0o002) !== 0;
}

/**
 * NAS hosts (Unraid, Synology) usually bind-mount a host folder for /data, and Docker creates
 * a missing folder owned by root. So when started as root we hand the data folder to PUID:PGID
 * (default 1000:1000, the image's "node" user) and then drop to that user for good. The server
 * never runs as root. If the folder can't be handed over (e.g. some network shares refuse
 * chown) and isn't otherwise writable by that user, we stay root rather than fail to start, and
 * say so in the log.
 */
function dropPrivileges() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const target = { uid: Number(process.env.PUID || 1000), gid: Number(process.env.PGID || 1000) };
  if (target.uid === 0) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    chownTree(DATA_DIR, target.uid, target.gid);
  } catch (err) {
    log(`could not change owner of ${DATA_DIR} to ${target.uid}:${target.gid} (${err.code ?? err.message})`, { level: 40 });
  }
  if (!writableBy(statSync(DATA_DIR), target)) {
    log(`${DATA_DIR} is not writable by ${target.uid}:${target.gid}; continuing as root`, { level: 40 });
    return;
  }
  // Groups first, then gid, then uid: once uid is dropped we no longer have the right to change
  // the others. setgroups clears root's supplementary groups so none of them leak through.
  process.setgroups([target.gid]);
  process.setgid(target.gid);
  process.setuid(target.uid);
}

/** Where a version's files live, or undefined if we don't have it. */
function dirFor(version) {
  if (!version) return undefined;
  if (version === imageVersion()) return BUNDLE_DIR;
  const dir = join(APP_DIR, version);
  return existsSync(join(dir, 'server.mjs')) ? dir : undefined;
}

/**
 * The version to run when nothing is pending. A newly pulled image wins if it is newer than the
 * active version; otherwise stick with the active one (which may be an intentional rollback).
 * state.image remembers which image we last saw, so a newer image is adopted only once: if it
 * fails and we roll back, the same image isn't retried on every restart.
 */
function steadyVersion(state) {
  const img = imageVersion();
  if (!state.active || !dirFor(state.active)) return img;
  if (img && img !== state.image && compareVersions(img, state.active) > 0) return img;
  return state.active;
}

let child;
let stopping = false;

function start(version) {
  const dir = dirFor(version);
  log('starting server', { version, dir });
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(dir, 'server.mjs')], {
    // Inherit stdio so server logs go straight to the container log.
    stdio: 'inherit',
    env: {
      ...process.env,
      DATA_DIR,
      PORT: String(PORT),
      // Point the server at this version's own web build and manifest, not the image's.
      WEB_DIR: join(dir, 'web'),
      APP_MANIFEST: join(dir, 'manifest.json'),
      POKETRACKER_LAUNCHER: '1',
      POKETRACKER_LAUNCHER_VERSION: LAUNCHER_VERSION,
    },
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited };
}

/**
 * Polls /health until it reports `version`, the process exits, or the timeout passes.
 * Matching the version matters: it proves the new code is the one answering, not some
 * other process that happens to hold the port. The timeout has to cover slow migrations.
 */
async function healthy(version, exited) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let done = false;
  exited.then(() => (done = true));
  while (Date.now() < deadline && !done) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok && (await res.json()).version === version) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** SIGTERM for a clean DB close, then SIGKILL if the server hangs. */
async function stop(proc, exited) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  const t = setTimeout(() => proc.kill('SIGKILL'), 15_000);
  await exited;
  clearTimeout(t);
}

/**
 * Puts the pre-update backup back after a failed update, undoing any migrations the new
 * version ran. Only safe while the server is stopped. The -wal and -shm files go first: they
 * belong to the database being replaced, and SQLite would otherwise replay them over the backup.
 */
function restoreDb(backup) {
  if (!backup || !existsSync(backup)) return false;
  for (const f of [`${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
  copyFileSync(backup, DB);
  return true;
}

async function main() {
  dropPrivileges();
  // Fail fast with an actionable message; otherwise the server would crash-loop on its first write.
  try {
    mkdirSync(APP_DIR, { recursive: true });
    writeFileSync(join(APP_DIR, '.write-test'), '');
    rmSync(join(APP_DIR, '.write-test'));
  } catch (err) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
    log(`cannot write to ${DATA_DIR}: ${err.code ?? err.message}. Make the data folder writable by user ${uid}, or set PUID/PGID to the folder's owner.`, { level: 50 });
    process.exit(1);
  }
  for (const sig of ['SIGTERM', 'SIGINT']) {
    // Forward to the server and let its exit end the loop below, so the DB closes cleanly.
    process.on(sig, () => {
      stopping = true;
      if (child && child.exitCode === null) child.kill(sig);
      else process.exit(0);
    });
  }

  // Timestamps of recent unexpected exits, for back-off and crash-loop rollback.
  const crashes = [];
  for (;;) {
    const state = readJson(STATE) ?? {};
    const pending = readJson(PENDING);
    // Consume the request before acting on it so it is tried exactly once. If the trial goes
    // wrong in a way we don't catch, the next start falls back to the steady version.
    rmSync(PENDING, { force: true });

    let target = steadyVersion(state);
    // Set when this start is a change of version and must pass the health gate.
    let trial;
    if (pending?.rollback && state.previous && dirFor(state.previous)) {
      target = state.previous;
      trial = { kind: 'rollback', from: state.active ?? imageVersion() };
    } else if (pending?.version && dirFor(pending.version)) {
      target = pending.version;
      trial = { kind: 'update', from: state.active ?? imageVersion(), backup: pending.backup };
    } else if (state.active && target !== state.active) {
      // A newer image was pulled; adopt it.
      trial = { kind: 'image', from: state.active };
    }
    if (!target || !dirFor(target)) {
      log('no runnable server bundle found', { bundleDir: BUNDLE_DIR });
      process.exit(1);
    }

    const { child: proc, exited } = start(target);
    if (trial) {
      if (await healthy(target, exited)) {
        writeJson(STATE, {
          image: imageVersion(),
          active: target,
          previous: trial.from && trial.from !== target ? trial.from : state.previous,
          last: { from: trial.from, to: target, ok: true, at: new Date().toISOString(), kind: trial.kind },
        });
        log('server is healthy', { version: target, kind: trial.kind });
      } else {
        log('new version failed its health check; rolling back', { version: target, from: trial.from });
        await stop(proc, exited);
        // Only updates come with a backup. A failed image or rollback trial leaves the DB as is,
        // which is safe only because migrations are additive.
        const restored = trial.kind === 'update' ? restoreDb(trial.backup) : false;
        writeJson(STATE, {
          image: imageVersion(),
          active: trial.from,
          previous: state.previous,
          last: { from: trial.from, to: target, ok: false, rolledBack: true, restoredDb: restored, at: new Date().toISOString(), kind: trial.kind, message: `Version ${target} did not start` },
        });
        // The failed download is deleted so it can't be picked again; image bundles can't be.
        if (trial.kind === 'update') rmSync(join(APP_DIR, target), { recursive: true, force: true });
        continue;
      }
    } else if (!state.active || state.image !== imageVersion()) {
      // First boot, or a different image that isn't newer than the active version: record it
      // without a trial so steadyVersion won't treat it as new next time.
      writeJson(STATE, { ...state, image: imageVersion(), active: target });
    }

    const { code, signal } = await exited;
    if (stopping) process.exit(code ?? 0);
    if (code === RESTART_CODE) {
      // Deliberate restart after staging an update or rollback: the loop re-reads pending.json.
      log('server requested a restart');
      crashes.length = 0;
      continue;
    }
    // Unexpected exit: back off, and give up on a version that keeps crashing right after an update.
    // A version can pass its health check and still crash later (a scheduled job, say), so three
    // crashes in five minutes within half an hour of an update count as a failed update.
    const t = Date.now();
    crashes.push(t);
    while (crashes.length && crashes[0] < t - 5 * 60_000) crashes.shift();
    log('server exited unexpectedly', { code, signal, recentCrashes: crashes.length });
    const s = readJson(STATE) ?? {};
    const recentUpdate = s.last?.ok && s.last.kind === 'update' && Date.parse(s.last.at) > t - 30 * 60_000;
    if (crashes.length >= 3 && recentUpdate && s.previous && dirFor(s.previous)) {
      log('rolling back after repeated crashes', { from: s.active, to: s.previous });
      writeJson(PENDING, { rollback: true });
      crashes.length = 0;
      continue;
    }
    // Exponential back-off (1s, 2s, 4s ... capped at 30s) so a broken install doesn't spin the CPU.
    await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** (crashes.length - 1))));
  }
}

// Only run when executed directly, so tests can import the exported helpers.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log('launcher crashed', { err: String(err?.stack ?? err) });
    process.exit(1);
  });
}
