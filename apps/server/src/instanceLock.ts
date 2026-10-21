import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDirectory } from './storage.ts';

/** Kernel-held SQLite lock. Network mounts use a host-local lock directory. Crash/exit releases it automatically.
 * A PID file is deliberately insufficient: stale files and PID reuse are not mutual exclusion.
 */
export function acquireInstanceLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const lock = new DatabaseSync(join(runtimeDirectory(dataDir), '.instance-lock.sqlite'));
  try {
    lock.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;');
  } catch {
    lock.close();
    throw new Error('Another PokéTracker process owns this data directory, or the filesystem cannot provide an exclusive lock. Run only one server per data directory.');
  }
  return () => { lock.exec('ROLLBACK'); lock.close(); };
}
