import { Worker } from 'node:worker_threads';
import type { Config } from './config.ts';
import { HttpError } from './context.ts';

export type RecoveryTask =
  | { action: 'snapshot'; config: Config; key: Uint8Array; temporary: boolean; name: string }
  | { action: 'validate'; source: string }
  | { action: 'restore'; source: string; destination: string }
  | { action: 'backup'; source: string; destination: string };

/** Expensive SQLite scans, compaction and filesystem flushes never run on the HTTP thread.
 * Use a separate read-only source connection and incremental SQLite backup, not a long
 * VACUUM read lock on the live database. No credentials are written to worker arguments/files.
 */
export function recoveryTask<T>(task: RecoveryTask): Promise<T> {
  const development = import.meta.url.endsWith('.ts');
  const worker = new Worker(new URL(development ? './recoveryWorker.ts' : './recovery-worker.mjs', import.meta.url), {
    workerData: task,
    ...(development ? { execArgv: ['--import', 'tsx'] } : {}),
  });
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let received = false;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error('Backup exceeded its 30 minute time limit. The app remains available; try again when storage is less busy.');
      void worker.terminate();
    }, 30 * 60_000).unref();
    worker.on('message', (message) => {
      received = true;
      if (message.ok) result = message.result as T;
      else failure = message.status ? new HttpError(message.status, message.error, message.code) : new Error(message.error);
    });
    worker.on('error', (error) => { failure = error; });
    // Wait for exit as well as the message: source connections must be closed before
    // callers release photo pins, clean staging or close their own database.
    worker.on('exit', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || !received) reject(new Error('Recovery worker stopped before completing the backup.'));
      else resolve(result);
    });
  });
}
