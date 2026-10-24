/** Local regression rehearsal, not an Azure Files performance guarantee.
 * BACKUP_REHEARSAL_MB=1126 npm run test:backup-reliability matches the incident DB size.
 * Uses real SQLite data, concurrent reads/writes, package verification and a fresh restore.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { startServer, setupOwner } from '../apps/server/test/helpers.ts';
import { createPackage, packagePath, unpackPackage } from '../apps/server/src/backupPackages.ts';
import { restoreRecoverySnapshot } from '../apps/server/src/recovery.ts';
import { Db } from '../apps/server/src/db.ts';

const megabytes = Number(process.env.BACKUP_REHEARSAL_MB ?? 64);
assert(Number.isInteger(megabytes) && megabytes >= 1 && megabytes <= 4096);
const server = await startServer();
const lag = monitorEventLoopDelay({ resolution: 20 });
try {
  const owner = await setupOwner(server.app);
  server.ctx.db.exec('PRAGMA journal_mode = DELETE; CREATE TABLE backup_probe (id INTEGER PRIMARY KEY, payload BLOB);');
  server.ctx.db.tx(() => {
    for (let i = 0; i < megabytes; i++) server.ctx.db.run('INSERT INTO backup_probe VALUES (?, ?)', i, randomBytes(1024 * 1024));
  });
  let done = false;
  const started = performance.now();
  lag.enable();
  const pending = createPackage(server.ctx, 'daily').finally(() => { done = true; });
  let probes = 0;
  let maxHealthMs = 0;
  while (!done) {
    const at = performance.now();
    assert.equal((await server.app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    assert.equal((await owner.get('/api/collections')).statusCode, 200);
    if (probes < 10) server.ctx.db.run('UPDATE users SET display_name = ?', `Concurrent edit ${probes}`);
    maxHealthMs = Math.max(maxHealthMs, performance.now() - at);
    probes++;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const result = await pending;
  lag.disable();
  const file = packagePath(server.ctx, result.name)!;
  const extracted = join(server.dir, 'verify');
  await unpackPackage(file, extracted);
  const restoredTo = join(server.dir, 'restored');
  await restoreRecoverySnapshot(extracted, restoredTo);
  const restored = new Db(join(restoredTo, 'poketracker.db'));
  try {
    assert.equal(restored.get<{ n: number }>('SELECT COUNT(*) AS n FROM backup_probe')!.n, megabytes);
    assert.equal(restored.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n, 1);
  } finally { restored.close(); }
  assert(probes > 1, 'Health checks must run during the backup');
  assert(maxHealthMs < 1000, 'Local request handling exceeded the original Azure probe timeout');
  console.log(JSON.stringify({ databaseMiB: statSync(server.ctx.db.file).size / 1024 ** 2, packageMiB: statSync(file).size / 1024 ** 2, elapsedSeconds: (performance.now() - started) / 1000, probes, maxHealthAndReadMs: maxHealthMs, maxEventLoopDelayMs: lag.max / 1e6, restored: true }, null, 2));
} finally { lag.disable(); await server.close(); }
