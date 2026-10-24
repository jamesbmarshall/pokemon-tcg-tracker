import { parentPort, workerData } from 'node:worker_threads';
import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Db } from './db.ts';
import { Sealer } from './security.ts';
import { createRecoverySnapshot, restoreRecoverySnapshot, validateRecoverySnapshot } from './recovery.ts';
import type { Ctx } from './context.ts';
import type { RecoveryTask } from './recoveryTask.ts';

async function run(task: RecoveryTask) {
  if (task.action === 'validate') return validateRecoverySnapshot(task.source);
  if (task.action === 'restore') return restoreRecoverySnapshot(task.source, task.destination);
  if (task.action === 'backup') {
    mkdirSync(dirname(task.destination), { recursive: true });
    const source = new DatabaseSync(task.source, { readOnly: true });
    try {
      source.exec('PRAGMA busy_timeout = 5000');
      // Small batches release the live database's read lock between steps on SMB.
      return await backup(source, task.destination, { rate: 16 });
    } finally { source.close(); }
  }
  const db = new Db(join(task.config.dataDir, 'poketracker.db'), task.config.journalMode, true);
  try {
    const ctx: Ctx = { config: task.config, db, sealer: new Sealer(Buffer.from(task.key)), services: {}, log: console as unknown as Ctx['log'] };
    return await createRecoverySnapshot(ctx, task.temporary, task.name);
  } finally { db.close(); }
}

void run(workerData as RecoveryTask).then(
  result => parentPort!.postMessage({ ok: true, result }),
  (error: Error & { status?: number; code?: string }) => parentPort!.postMessage({ ok: false, error: error.message, status: error.status, code: error.code }),
);
