import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { baselineAt, baselineVersions, preservationRows, seedTcgBaseline } from './fixtures/tcg-baseline.ts';

describe('historical TCG database preservation baseline', () => {
  it.each(baselineVersions)('preserves schema-%i collector data through upgrade, backup and reopen', async (version) => {
    const dir = mkdtempSync(join(tmpdir(), 'tcg-baseline-'));
    const db = new Db(join(dir, 'source.db'));
    try {
      seedTcgBaseline(db, version);
      const before = preservationRows(db);
      expect(db.migrate()).toBe(MIGRATIONS.length - version);
      expect(preservationRows(db)).toMatchObject(before);
      // Independent expectations catch a fixture or projection that accidentally loses data.
      expect(db.all('SELECT id,variant,quantity,paid,value_override,notes FROM entries ORDER BY id')).toEqual([
        { id: 'synthetic-001::holofoil', variant: 'holofoil', quantity: 3, paid: '{"amount":7.25,"currency":"GBP"}', value_override: '19.5', notes: '日本語 — gift' },
        { id: 'synthetic-001::stamped', variant: 'stamped', quantity: 1, paid: '{"amount":7.25,"currency":"EUR"}', value_override: '19.5', notes: '日本語 — gift' },
      ]);
      expect(db.all('SELECT card_id,qty FROM list_cards ORDER BY position')).toEqual([
        { card_id: 'synthetic-002', qty: 1 }, { card_id: 'synthetic-001', qty: version >= 6 ? 4 : 1 },
      ]);
      expect(db.get('SELECT game,game_language,revoked_at,hide_notes FROM shares')).toEqual({ game: 'pokemon', game_language: 'en', revoked_at: baselineAt, hide_notes: 1 });
      expect(db.get('SELECT revision FROM collections')).toEqual({ revision: version >= 10 ? 7 : 0 });
      expect(db.get('SELECT source,price,currency,printing_version FROM price_history')).toEqual({ source: 'cardmarket', price: 8.75, currency: 'EUR', printing_version: 0 });
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      expect(db.get('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
      expect(db.migrate()).toBe(0);
      const upgraded = preservationRows(db);
      const backup = join(dir, 'backup.db');
      await db.backupTo(backup);
      const restored = new Db(backup);
      try {
        expect(restored.schemaVersion).toBe(MIGRATIONS.length);
        expect(restored.migrate()).toBe(0);
        expect(preservationRows(restored)).toEqual(upgraded);
        expect(restored.all('PRAGMA foreign_key_check')).toEqual([]);
      } finally { restored.close(); }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects quantity, evidence, photo-reference and receipt corruption independently of row counts', () => {
    const db = new Db(':memory:');
    try {
      seedTcgBaseline(db, 11);
      const before = preservationRows(db);
      for (const sql of [
        'UPDATE entries SET quantity=quantity+1',
        "UPDATE printing_changes SET next_data='[]'",
        "UPDATE graded_photos SET graded_id='wrong-slab'",
        "UPDATE mutation_receipts SET revision=revision+1",
      ]) {
        db.exec('BEGIN');
        try {
          db.exec(sql);
          expect(preservationRows(db)).not.toEqual(before);
        } finally { db.exec('ROLLBACK'); }
      }
      expect(preservationRows(db)).toEqual(before);
    } finally { db.close(); }
  });
});
