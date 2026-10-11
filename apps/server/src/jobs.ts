/**
 * In-process job scheduler. Each job runs on a cron schedule, can be triggered from the admin
 * UI, and is caught up shortly after boot if its last success is older than staleMs, because a
 * home server is often off at the scheduled time. Status lives in the jobs table so it survives
 * restarts. Also owns database backups, which the backup job and the admin API share.
 */
import { Cron } from 'croner';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES } from '@poketracker/shared/languages';
import type { Ctx } from './context.ts';
import { readCards, recordValue, refreshCards, trackedCardIds, prunePriceHistory } from './cards.ts';
import { cachedUpstream, ensureImage, pruneHttpCache, pruneImages, refreshFx, ttlFor } from './catalog.ts';
import { deletePhotoFiles } from './collections.ts';
import { refreshSealedPrices } from './sealed.ts';
import { refreshGradedPrices } from './providers/pricecharting.ts';
import { redactSecrets } from './security.ts';
import { applyUpdate, autoUpdateBlockedFor, autoUpdateEnabled, checkForUpdate, pruneVersions, updateAvailable, updateBlocker } from './updater.ts';

interface JobDef {
  name: string;
  label: string;
  /** Cron pattern (server local time) */
  schedule: string;
  /** Run at boot if the last success is older than this. */
  staleMs: number;
  run: (ctx: Ctx) => Promise<unknown>;
}

const H = 3600_000;

export const JOBS: JobDef[] = [
  {
    name: 'fx',
    label: 'Currency rates',
    schedule: '15 6 * * *',
    staleMs: 24 * H,
    run: async (ctx) => refreshFx(ctx),
  },
  {
    name: 'sets',
    label: 'Set lists',
    schedule: '30 5 * * *',
    staleMs: 24 * H,
    run: async (ctx) => {
      const base = ctx.config.tcgdexBase.replace(/\/$/, '');
      let ok = 0;
      for (const l of LANGUAGES) {
        const path = `/${l.code}/sets`;
        try {
          // force: a scheduled refresh should hit TCGdex even if the cache is still fresh.
          await cachedUpstream(ctx, `GET ${path}`, `${base}${path}`, {}, ttlFor(path), true);
          ok++;
        } catch {
          /* one language down shouldn't fail the rest */
        }
      }
      if (!ok) throw new Error('No set lists could be refreshed');
      return { languages: ok };
    },
  },
  {
    name: 'prices',
    label: 'Card prices',
    schedule: '0 */12 * * *',
    staleMs: 12 * H,
    run: async (ctx) => {
      // Prices are per card, not per user: one deduplicated id list across every collection
      // means a card owned by ten people costs one upstream lookup, not ten.
      const ids = trackedCardIds(ctx.db);
      const refreshed = await refreshCards(ctx, ids);
      ctx.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_price_sync', ?)", new Date().toISOString());
      // PriceCharting items refresh alongside card prices (no-ops with no key configured).
      const sealed = await refreshSealedPrices(ctx);
      const graded = await refreshGradedPrices(ctx);
      // Value snapshots depend on fresh prices.
      const values = await runJob(ctx, 'values');
      return { cards: ids.length, refreshed, sealed, graded, values };
    },
  },
  {
    name: 'values',
    label: 'Daily value snapshots',
    schedule: '45 23 * * *',
    staleMs: 24 * H,
    run: async (ctx) => {
      let n = 0;
      for (const c of ctx.db.all<{ id: string }>('SELECT id FROM collections')) if (recordValue(ctx, c.id)) n++;
      return { collections: n };
    },
  },
  {
    name: 'images',
    label: 'Image cache',
    schedule: '30 3 * * *',
    staleMs: 24 * H,
    run: async (ctx) => {
      const cards = readCards(ctx.db, trackedCardIds(ctx.db));
      // Same host allow-list as the image proxy; card data comes from upstream and is not trusted.
      const urls = Array.from(cards.values(), (c) => c.image).filter((u) => /^https:\/\/(assets\.tcgdex\.net|images\.pokemontcg\.io)\//.test(u));
      let fetched = 0;
      // Four at a time: quick enough for a large collection without hammering the CDN.
      for (let i = 0; i < urls.length; i += 4) {
        const got = await Promise.all(urls.slice(i, i + 4).map((u) => ensureImage(ctx, u)));
        fetched += got.filter(Boolean).length;
      }
      return { cached: fetched, pruned: pruneImages(ctx) };
    },
  },
  {
    name: 'backup',
    label: 'Database backup',
    schedule: '0 3 * * *',
    staleMs: 24 * H,
    run: async (ctx) => {
      const file = backupNow(ctx, 'daily');
      return { file: file.split('/').pop(), pruned: pruneBackups(ctx) };
    },
  },
  {
    name: 'cleanup',
    label: 'Housekeeping',
    schedule: '20 4 * * *',
    staleMs: 24 * H,
    run: async (ctx) => {
      const t = new Date().toISOString();
      const weekAgo = new Date(Date.now() - 7 * 24 * H).toISOString();
      // Graded copies are soft-deleted so the UI can offer undo; purge them after a day.
      const old = ctx.db.all<{ collection_id: string; id: string }>('SELECT collection_id, id FROM graded WHERE deleted_at IS NOT NULL AND deleted_at < ?', new Date(Date.now() - 24 * H).toISOString());
      let photos = 0;
      ctx.db.tx(() => {
        for (const g of old) {
          const ids = ctx.db.all<{ id: string }>('SELECT id FROM graded_photos WHERE collection_id = ? AND graded_id = ?', g.collection_id, g.id).map((p) => p.id);
          ctx.db.run('DELETE FROM graded_photos WHERE collection_id = ? AND graded_id = ?', g.collection_id, g.id);
          ctx.db.run('DELETE FROM graded WHERE collection_id = ? AND id = ?', g.collection_id, g.id);
          deletePhotoFiles(ctx, ids);
          photos += ids.length;
        }
      });
      const sessions = ctx.db.run('DELETE FROM sessions WHERE expires_at < ?', t).changes;
      ctx.db.run('DELETE FROM invites WHERE expires_at < ? AND used_at IS NULL', weekAgo);
      ctx.db.run('DELETE FROM password_resets WHERE expires_at < ?', weekAgo);
      ctx.db.run('DELETE FROM audit_log WHERE at < ?', new Date(Date.now() - 400 * 24 * H).toISOString());
      return { graded: old.length, photos, sessions, httpCache: pruneHttpCache(ctx), versions: pruneVersions(ctx), priceHistory: prunePriceHistory(ctx.db, ctx.config.priceHistoryDays) };
    },
  },
  {
    name: 'update-check',
    label: 'Update check',
    schedule: '10 2 * * *',
    staleMs: 24 * H,
    run: async (ctx) => {
      const s = await checkForUpdate(ctx);
      if (s.error) throw new Error(s.error);
      const available = updateAvailable(ctx, s);
      // Auto-apply only when the owner opted in, the launcher can install it, and this exact
      // version hasn't already failed or been rolled back from.
      if (available && autoUpdateEnabled(ctx) && !updateBlocker(ctx) && !autoUpdateBlockedFor(ctx, s.latest!.version)) {
        await applyUpdate(ctx, 'auto');
        return { available, latest: s.latest?.version, applied: true };
      }
      return { available, latest: s.latest?.version };
    },
  },
];

// ---------------------------------------------------------------- backups

const backupDir = (ctx: Ctx) => join(ctx.config.dataDir, 'backups');

/** Writes a backup now. The timestamped name keeps VACUUM INTO from hitting an existing file. */
export function backupNow(ctx: Ctx, kind: 'daily' | 'manual' = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(backupDir(ctx), `poketracker-${kind}-${stamp}.db`);
  ctx.db.backupTo(file);
  return file;
}

/**
 * Lists backups newest first. The kind is inferred from the file name (the updater writes
 * pre-update-*.db), so there is no separate index to fall out of step with the folder.
 */
export function listBackups(ctx: Ctx) {
  const dir = backupDir(ctx);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[\w.-]+\.db$/.test(f))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, size: s.size, createdAt: s.mtime.toISOString(), kind: name.startsWith('pre-update') ? 'pre-update' : name.includes('-manual-') ? 'manual' : 'daily' };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest N daily backups and the newest 3 pre-update ones; manual backups are kept until deleted. */
export function pruneBackups(ctx: Ctx) {
  const all = listBackups(ctx);
  const drop = [...all.filter((b) => b.kind === 'daily').slice(ctx.config.backupsToKeep), ...all.filter((b) => b.kind === 'pre-update').slice(3)];
  for (const b of drop) rmSync(join(backupDir(ctx), b.name), { force: true });
  return drop.length;
}

/**
 * Resolves a user-supplied backup name to a file, or undefined. The strict pattern rules out
 * path separators, so download and delete can't reach outside the backups folder.
 */
export const backupPath = (ctx: Ctx, name: string) => {
  if (!/^[\w.-]+\.db$/.test(name) || name.includes('..')) return undefined;
  const file = join(backupDir(ctx), name);
  return existsSync(file) ? file : undefined;
};

// ---------------------------------------------------------------- scheduler

/** One entry per job while it runs: the per-job lock, held in memory as we are one process. */
const running = new Map<string, Promise<unknown>>();

interface JobRow {
  name: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_result: string | null;
}

/**
 * Runs a job now. Concurrent calls for the same job share the running promise, so a cron tick,
 * a boot catch-up and an admin click can't run the same job twice at once. Different jobs may
 * overlap. Rejects with the job's error after recording it.
 */
export function runJob(ctx: Ctx, name: string): Promise<unknown> {
  const def = JOBS.find((j) => j.name === name);
  if (!def) return Promise.reject(new Error(`Unknown job ${name}`));
  const existing = running.get(name);
  if (existing) return existing;
  const p = (async () => {
    ctx.db.run(
      "INSERT INTO jobs (name, last_started_at, last_status) VALUES (?, ?, 'running') ON CONFLICT(name) DO UPDATE SET last_started_at = excluded.last_started_at, last_status = 'running'",
      name,
      new Date().toISOString(),
    );
    try {
      const result = await def.run(ctx);
      ctx.db.run("UPDATE jobs SET last_finished_at = ?, last_status = 'ok', last_error = NULL, last_result = ? WHERE name = ?", new Date().toISOString(), JSON.stringify(result ?? null), name);
      ctx.log.info({ job: name, result }, 'job finished');
      return result;
    } catch (err) {
      // Capped so a huge upstream error body can't bloat the jobs table, and redacted so a
      // leaked provider API key (e.g. from a fetch error echoing its request URL) never lands
      // in a place admins can read back.
      ctx.db.run(
        "UPDATE jobs SET last_finished_at = ?, last_status = 'error', last_error = ? WHERE name = ?",
        new Date().toISOString(),
        redactSecrets(String((err as Error).message ?? err)).slice(0, 500),
        name,
      );
      ctx.log.warn({ job: name, err }, 'job failed');
      throw err;
    } finally {
      running.delete(name);
    }
  })();
  running.set(name, p);
  return p;
}

/** Job list for the admin UI, merging the static definitions with persisted run history. */
export function jobStatus(ctx: Ctx) {
  const rows = new Map(ctx.db.all<JobRow>('SELECT * FROM jobs').map((r) => [r.name, r]));
  return JOBS.map((j) => {
    const r = rows.get(j.name);
    const next = new Cron(j.schedule, { paused: true }).nextRun();
    return {
      name: j.name,
      label: j.label,
      schedule: j.schedule,
      running: running.has(j.name),
      lastStartedAt: r?.last_started_at ?? null,
      lastFinishedAt: r?.last_finished_at ?? null,
      // 'running' in the table with no live promise means the process stopped mid-run.
      lastStatus: r?.last_status === 'running' && !running.has(j.name) ? 'interrupted' : (r?.last_status ?? null),
      lastError: r?.last_error ?? null,
      lastResult: r?.last_result ? JSON.parse(r.last_result) : null,
      nextRunAt: next?.toISOString() ?? null,
    };
  });
}

/** Starts the cron timers and the boot catch-up. Returns a function that stops both. */
export function startScheduler(ctx: Ctx) {
  mkdirSync(backupDir(ctx), { recursive: true });
  // protect: skip a tick if the previous one is still going. catch: a throwing job must not
  // kill its timer. runJob already records failures, so the error is dropped here.
  const crons = JOBS.map((j) => new Cron(j.schedule, { protect: true, catch: true }, async () => {
      await runJob(ctx, j.name).catch(() => undefined);
    }),
  );

  // Catch up on anything overdue, one at a time, shortly after boot.
  // The order is deliberate: fx before prices (values use rates), prices before images (which
  // read the refreshed card data). 'values' is absent because prices runs it.
  const timer = setTimeout(async () => {
    const rows = new Map(ctx.db.all<JobRow>("SELECT * FROM jobs WHERE last_status = 'ok'").map((r) => [r.name, r]));
    for (const j of ['fx', 'sets', 'prices', 'update-check', 'images', 'backup', 'cleanup']) {
      const def = JOBS.find((d) => d.name === j)!;
      const last = rows.get(j)?.last_finished_at;
      if (!last || Date.now() - Date.parse(last) > def.staleMs) await runJob(ctx, j).catch(() => undefined);
    }
  }, 5_000);
  timer.unref();

  return () => {
    clearTimeout(timer);
    crons.forEach((c) => c.stop());
  };
}
