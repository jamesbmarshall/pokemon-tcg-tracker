import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NETWORK_FILESYSTEMS = new Set([0x6969, 0xff534d42, 0xfe534d42, 0x01021997, 0x00c36400]);
export const NETWORK_STORAGE_WARNING = 'Network storage detected. Run only one app instance and stop it before deploying another container image. Keep independent backups: filesystem locking and recovery of the latest edits cannot be guaranteed on a network share.';

/** Detect known Linux network mounts; an unrecognised filesystem is not a durability guarantee. */
export function isNetworkStorage(dataDir: string): boolean {
  return NETWORK_FILESYSTEMS.has(statfsSync(dataDir).type >>> 0);
}

/** SMB cannot host Unix sockets. Locks here protect this host only, not other replicas. */
export function runtimeDirectory(dataDir: string): string {
  if (!isNetworkStorage(dataDir)) return dataDir;
  const key = createHash('sha256').update(realpathSync(dataDir)).digest('hex').slice(0, 16);
  const dir = join(tmpdir(), `pt-${process.getuid?.() ?? 'user'}-${key}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function storagePolicy(dataDir: string, requestedMode: 'wal' | 'delete') {
  const network = isNetworkStorage(dataDir);
  return { network, journalMode: network ? 'delete' as const : requestedMode, warning: network ? NETWORK_STORAGE_WARNING : null };
}
