import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireInstanceLock } from '../src/instanceLock.ts';
import { Db } from '../src/db.ts';

it('refuses a second writer and releases the lock on close', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-lock-'));
  try {
    const release = acquireInstanceLock(dir);
    expect(() => acquireInstanceLock(dir)).toThrow('Another PokéTracker process');
    release();
    acquireInstanceLock(dir)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('uses strict synchronization for both journal modes', () => {
  for (const mode of ['wal', 'delete'] as const) {
    const db = new Db(':memory:', mode);
    try { expect(db.get<{ synchronous: number }>('PRAGMA synchronous')!.synchronous).toBe(mode === 'wal' ? 2 : 3); }
    finally { db.close(); }
  }
});
