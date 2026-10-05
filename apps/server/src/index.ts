import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { loadInstanceKey, Sealer } from './security.ts';
import type { Ctx } from './context.ts';
import { buildApp } from './app.ts';
import { ensureSetupToken } from './auth.ts';
import { initCatalog } from './cards.ts';
import { jobStatus, runJob, startScheduler } from './jobs.ts';
import { settleUpdateState } from './updater.ts';

async function main() {
  const config = loadConfig();
  const db = new Db(join(config.dataDir, 'poketracker.db'), config.journalMode);
  const applied = db.migrate();
  const sealer = new Sealer(loadInstanceKey(join(config.dataDir, 'secret.key'), process.env.SECRET_KEY));

  let exitCode = 0;
  let stopJobs = () => {};
  const ctx: Ctx = { config, db, sealer, log: console as unknown as Ctx['log'], services: {} };
  const app = await buildApp(ctx);
  initCatalog(ctx);
  settleUpdateState(ctx);

  const shutdown = async (code = 0) => {
    exitCode = code;
    stopJobs();
    try {
      await app.close();
    } finally {
      db.close();
      process.exit(exitCode);
    }
  };
  ctx.services = {
    runJob: (name) => runJob(ctx, name),
    jobStatus: () => jobStatus(ctx),
    // Let the HTTP response flush before exiting; the launcher restarts us.
    requestRestart: (code = 75) => setTimeout(() => void shutdown(code), 500).unref(),
  };
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ version: config.version, schema: db.schemaVersion, migrationsApplied: applied, dataDir: config.dataDir, supervised: config.supervised }, 'PokéTracker started');

  const token = ensureSetupToken(ctx);
  if (token) {
    const where = config.publicUrl || `http://localhost:${config.port}`;
    const banner = [
      '',
      '==================================================================',
      '  PokéTracker first-run setup',
      `  Open ${where}/setup and enter this setup token:`,
      '',
      `      ${token}`,
      '',
      '  It is valid until the owner account is created and changes on',
      '  every restart. Set SETUP_TOKEN to choose your own instead.',
      '==================================================================',
      '',
    ].join('\n');
    // Plain stdout so it stands out in container log viewers.
    process.stdout.write(banner + '\n');
  }

  if (config.jobs) stopJobs = startScheduler(ctx);
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
