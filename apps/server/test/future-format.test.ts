import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db.ts';
import { assertWriteProtocol, WRITE_PROTOCOL } from '../src/mutations.ts';
it('refuses unknown future schemas and write protocols without lowering their floor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-future-')); const db = new Db(join(dir, 'test.db'));
  try {
    db.migrate(); db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (100000, '2026-01-01')");
    expect(() => db.migrate()).toThrow('newer application schema');
    expect(db.schemaVersion).toBe(100000);
    mkdirSync(join(dir, 'app')); const file = join(dir, 'app/write-protocol-floor.json');
    writeFileSync(file, JSON.stringify({ protocol: WRITE_PROTOCOL + 1 }));
    expect(() => assertWriteProtocol(dir)).toThrow('newer write protocol');
    writeFileSync(file, 'corrupt'); expect(() => assertWriteProtocol(dir)).toThrow('Invalid write-protocol floor');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
