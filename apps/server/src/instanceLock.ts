import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

/** Kernel-held SQLite lock, on supported local storage. Crash/exit releases it automatically.
 * A PID file is deliberately insufficient: stale files and PID reuse are not mutual exclusion.
 */
export function acquireInstanceLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  if (process.platform === 'linux' && new Set([0x6969, 0xff534d42, 0xfe534d42, 0x01021997, 0x00c36400]).has(statfsSync(dataDir).type >>> 0)) throw new Error('Network filesystems are not supported for the SQLite data directory. Move the instance to a managed local disk before upgrading.');
  const lock = new DatabaseSync(join(dataDir, '.instance-lock.sqlite'));
  try {
    lock.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;');
  } catch {
    lock.close();
    throw new Error('Another PokéTracker process owns this data directory, or the filesystem cannot provide an exclusive lock. Use one server on supported local storage.');
  }
  return () => { lock.exec('ROLLBACK'); lock.close(); };
}
