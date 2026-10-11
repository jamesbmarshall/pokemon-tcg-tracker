/**
 * Admin and status routes: job control, storage figures, backups and in-app updates.
 * Members only see the small status endpoint. Admins can run jobs. Backups and updates are
 * owner-only, because a backup holds every user's data and an update runs new code.
 */
import type { FastifyInstance } from 'fastify';
import { createReadStream, rmSync, statSync } from 'node:fs';
import { audit, bad, HttpError, notFound, requireRole, requireUser, type Ctx } from './context.ts';
import { backupNow, backupPath, jobStatus, JOBS, listBackups, runJob } from './jobs.ts';
import { imageCacheStats } from './catalog.ts';
import { allProviderHealth, isHealthy } from './providers/resilience.ts';
import { pcConfigured } from './providers/pricecharting.ts';
import {
  applyUpdate,
  autoUpdateEnabled,
  checkForUpdate,
  readLauncherState,
  readUpdateState,
  requestRollback,
  updateAvailable,
  updateBlocker,
} from './updater.ts';

export function systemRoutes(app: FastifyInstance, ctx: Ctx) {
  /**
   * Small status for every signed-in user: version and when prices last refreshed.
   * `catalogDegraded` is a non-sensitive flag (no error detail) so the web app can show a
   * "card data may be out of date" banner without needing admin access.
   */
  app.get('/api/system/status', async (req) => {
    const u = requireUser(req);
    const lastPriceSync = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'last_price_sync'")?.value ?? null;
    const fx = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'fx'");
    const base = { version: ctx.config.version, lastPriceSync, fxAt: fx ? (JSON.parse(fx.value) as { at: number }).at : null, catalogDegraded: !isHealthy('tcgdex') };
    // Members can't act on updates, so don't show them a nag they can't resolve.
    if (u.role === 'member') return base;
    return { ...base, updateAvailable: updateAvailable(ctx), latest: readUpdateState(ctx).latest?.version ?? null };
  });

  /** Per-provider health for the admin "providers" panel: breaker state, recent errors, stale-serve counts. */
  app.get('/api/admin/providers', async (req) => {
    requireRole(req, 'owner', 'admin');
    const byName = new Map(allProviderHealth().map((h) => [h.name, h]));
    const blank = (name: string) => ({ name, state: 'closed' as const, consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastError: null, staleServedCount: 0, openedAt: null });
    return {
      tcgdex: byName.get('tcgdex') ?? blank('tcgdex'),
      pricecharting: { ...(byName.get('pricecharting') ?? blank('pricecharting')), configured: pcConfigured(ctx) },
    };
  });

  // ------------------------------------------------------------ jobs (admins)

  app.get('/api/admin/jobs', async (req) => {
    requireRole(req, 'owner', 'admin');
    return jobStatus(ctx);
  });

  app.post('/api/admin/jobs/:name/run', async (req) => {
    requireRole(req, 'owner', 'admin');
    const { name } = req.params as { name: string };
    if (!JOBS.some((j) => j.name === name)) throw notFound('Unknown job');
    // Updates go through the update endpoints so they stay owner-only. The update-check job
    // can auto-apply an update, so an admin must not be able to trigger it.
    if (name === 'update-check' && req.user!.role !== 'owner') throw bad('Only the owner can check for updates');
    audit(ctx, req, 'job.run', name);
    const job = runJob(ctx, name);
    // ?wait=1 lets the UI show the outcome of quick jobs such as a price refresh.
    if ((req.query as { wait?: string }).wait === '1') {
      try {
        return { started: true, result: await job };
      } catch (err) {
        throw new HttpError(502, (err as Error).message, 'job_failed');
      }
    }
    // Fire and forget: the outcome lands in the jobs table, and the catch stops an
    // unhandled rejection from taking the process down.
    void job.catch(() => undefined);
    return { started: true };
  });

  app.get('/api/admin/storage', async (req) => {
    requireRole(req, 'owner', 'admin');
    let db = 0;
    try {
      db = statSync(`${ctx.config.dataDir}/poketracker.db`).size;
    } catch {
      /* in-memory test db */
    }
    return { dbBytes: db, images: imageCacheStats(ctx), backups: listBackups(ctx).length };
  });

  // ------------------------------------------------------------ backups (owner)

  app.get('/api/admin/backups', async (req) => {
    requireRole(req, 'owner');
    return listBackups(ctx);
  });

  app.post('/api/admin/backups', async (req) => {
    requireRole(req, 'owner');
    const file = backupNow(ctx, 'manual');
    audit(ctx, req, 'backup.created', file.split('/').pop());
    return { name: file.split('/').pop() };
  });

  app.get('/api/admin/backups/:name', async (req, reply) => {
    requireRole(req, 'owner');
    const { name } = req.params as { name: string };
    // backupPath validates the name, so it is safe to echo into content-disposition.
    const file = backupPath(ctx, name);
    if (!file) throw notFound('Backup not found');
    audit(ctx, req, 'backup.downloaded', name);
    reply.header('content-disposition', `attachment; filename="${name}"`).header('content-length', statSync(file).size).type('application/vnd.sqlite3');
    return reply.send(createReadStream(file));
  });

  app.delete('/api/admin/backups/:name', async (req) => {
    requireRole(req, 'owner');
    const { name } = req.params as { name: string };
    const file = backupPath(ctx, name);
    if (!file) throw notFound('Backup not found');
    rmSync(file, { force: true });
    audit(ctx, req, 'backup.deleted', name);
    return { ok: true };
  });

  // ------------------------------------------------------------ updates (owner)

  // Every update endpoint returns this shape so the settings page can re-render from any reply.
  const updateInfo = () => {
    const s = readUpdateState(ctx);
    return {
      current: ctx.config.version,
      launcherVersion: ctx.config.launcherVersion || null,
      canUpdate: !updateBlocker(ctx),
      blocker: updateBlocker(ctx) ?? null,
      autoUpdate: autoUpdateEnabled(ctx),
      available: updateAvailable(ctx, s),
      latest: s.latest ?? null,
      checkedAt: s.checkedAt ?? null,
      error: s.error ?? null,
      applying: !!s.applying,
      progress: s.progress ?? null,
      launcher: readLauncherState(ctx),
    };
  };

  app.get('/api/system/update', async (req) => {
    requireRole(req, 'owner');
    return updateInfo();
  });

  app.post('/api/system/update/check', async (req) => {
    requireRole(req, 'owner');
    await checkForUpdate(ctx);
    return updateInfo();
  });

  app.post('/api/system/update/apply', async (req) => {
    requireRole(req, 'owner');
    // Audited before applying, so the request is on record even if the process exits mid-way.
    audit(ctx, req, 'system.update_requested');
    const r = await applyUpdate(ctx);
    return { restarting: true, version: r.version };
  });

  app.post('/api/system/update/rollback', async (req) => {
    requireRole(req, 'owner');
    audit(ctx, req, 'system.rollback_requested');
    return { restarting: true, ...requestRollback(ctx) };
  });

  app.put('/api/system/settings', async (req) => {
    requireRole(req, 'owner');
    const b = (req.body ?? {}) as { autoUpdate?: unknown };
    if (typeof b.autoUpdate === 'boolean') {
      ctx.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_update', ?)", b.autoUpdate ? '1' : '0');
      audit(ctx, req, 'system.settings', undefined, { autoUpdate: b.autoUpdate });
    }
    return updateInfo();
  });
}
