import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';

it('migration 7 retains inventory, graded photos and price history while invalidating totals', () => {
  const db = new Db(':memory:');
  try {
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (let i = 0; i < 6; i++) {
      db.exec(MIGRATIONS[i]);
      db.run('INSERT INTO schema_migrations VALUES (?, ?)', i + 1, '2026-10-14');
    }
    db.run("INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES ('u', 'ash', 'Ash', 'x', 'owner', 'today', 'today')");
    db.run("INSERT INTO collections (id, name, kind, owner_id, created_at) VALUES ('c', 'Collection', 'personal', 'u', 'today')");
    db.run("INSERT INTO entries (collection_id, id, card_id, set_id, variant, quantity, condition, notes, paid, added_at) VALUES ('c', 'x-1::holofoil', 'x-1', 'x', 'holofoil', 3, 'LP', 'Gift', '{\"amount\":7}', 'today')");
    db.run("INSERT INTO graded (collection_id, id, card_id, data) VALUES ('c', 'g', 'x-1', '{\"variant\":\"holofoil\",\"certNumber\":\"123\"}')");
    db.run("INSERT INTO graded_photos (id, collection_id, graded_id, side, mime, size, added_at) VALUES ('photo', 'c', 'g', 'front', 'image/jpeg', 100, 'today')");
    db.run("INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('x-1', 'holofoil', 'cardmarket', 'today', 5, 'EUR')");
    db.run("INSERT INTO cards (id, set_id, data, priced, synced_at) VALUES ('x-1', 'x', '{\"prices\":{\"holofoil\":5}}', 1, 'today')");
    db.run("INSERT INTO set_stats (set_id, master_total, synced_at) VALUES ('x', 10, 'today')");
    const preserved = ['entries', 'graded', 'graded_photos', 'price_history'];
    const before = preserved.map((table) => db.all(`SELECT * FROM ${table}`));
    expect(db.migrate()).toBe(1);
    expect(preserved.map((table) => db.all(`SELECT * FROM ${table}`))).toEqual(before);
    expect(db.get('SELECT data, synced_at FROM cards')).toMatchObject({ data: '{"prices":{"holofoil":5}}', synced_at: '1970-01-01T00:00:00.000Z' });
    expect(db.all('SELECT * FROM set_stats')).toEqual([]);
    expect(db.migrate()).toBe(0);
  } finally { db.close(); }
});

describe('migration 3 (sealed product + shares rebuild)', () => {
  it('rebuilds shares to allow the sealed scope while preserving every existing row and its foreign keys', () => {
    const db = new Db(':memory:');
    // Build a database at migration-2 level (before this feature), with real rows in shares,
    // share_users and the tables shares.collection_id/owner_id reference.
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(MIGRATIONS[0]);
    db.exec(MIGRATIONS[1]);
    db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)', new Date().toISOString());
    db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)', new Date().toISOString());

    const at = new Date().toISOString();
    db.run("INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES ('u1', 'ash', 'Ash', 'x', 'owner', ?, ?)", at, at);
    db.run("INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES ('u2', 'misty', 'Misty', 'x', 'member', ?, ?)", at, at);
    db.run("INSERT INTO collections (id, name, kind, owner_id, created_at) VALUES ('c1', 'Ash', 'personal', 'u1', ?)", at);
    db.run(
      `INSERT INTO shares (id, token_hash, token_enc, owner_id, collection_id, scope, target, audience, title, hide_paid, hide_value, hide_notes, created_at, views)
       VALUES ('s1', 'hash1', 'enc1', 'u1', 'c1', 'graded', NULL, 'public', 'My slabs', 1, 0, 1, ?, 3)`,
      at,
    );
    db.run("INSERT INTO share_users (share_id, user_id) VALUES ('s1', 'u2')");

    // Migration 3 applies cleanly (and migration 4, the price_history rebuild, and migration 5,
    // decks, which was appended after this feature when the two chains were integrated)...
    expect(db.migrate()).toBe(MIGRATIONS.length - 2);

    // ...and every column of the pre-existing share survived the rebuild verbatim.
    const row = db.get<Record<string, unknown>>('SELECT * FROM shares WHERE id = ?', 's1')!;
    expect(row).toMatchObject({
      id: 's1',
      token_hash: 'hash1',
      token_enc: 'enc1',
      owner_id: 'u1',
      collection_id: 'c1',
      scope: 'graded',
      audience: 'public',
      title: 'My slabs',
      hide_paid: 1,
      hide_value: 0,
      hide_notes: 1,
      views: 3,
    });

    // share_users kept its link to the rebuilt table (the FK still resolves by name).
    expect(db.all('SELECT * FROM share_users WHERE share_id = ?', 's1')).toHaveLength(1);
    // Deleting the share still cascades, proving the foreign key is live, not just the column.
    db.run('DELETE FROM shares WHERE id = ?', 's1');
    expect(db.all('SELECT * FROM share_users WHERE share_id = ?', 's1')).toHaveLength(0);

    // The new scope value is now accepted...
    expect(() =>
      db.run(
        `INSERT INTO shares (id, token_hash, token_enc, owner_id, collection_id, scope, audience, created_at)
         VALUES ('s2', 'hash2', 'enc2', 'u1', 'c1', 'sealed', 'public', ?)`,
        at,
      ),
    ).not.toThrow();
    // ...but nonsense scopes still are not.
    expect(() =>
      db.run(
        `INSERT INTO shares (id, token_hash, token_enc, owner_id, collection_id, scope, audience, created_at)
         VALUES ('s3', 'hash3', 'enc3', 'u1', 'c1', 'nonsense', 'public', ?)`,
        at,
      ),
    ).toThrow();

    // sealed and sealed_photos exist with their expected constraints.
    expect(() =>
      db.run(
        `INSERT INTO sealed (collection_id, id, name, product_type, quantity, status, added_at) VALUES ('c1', 'sl1', 'ETB', 'etb', 1, 'sealed', ?)`,
        at,
      ),
    ).not.toThrow();
    expect(() =>
      db.run(`INSERT INTO sealed (collection_id, id, name, product_type, quantity, status, added_at) VALUES ('c1', 'sl2', 'ETB', 'nonsense', 1, 'sealed', ?)`, at),
    ).toThrow();
    expect(() =>
      db.run(`INSERT INTO sealed (collection_id, id, name, product_type, quantity, status, added_at) VALUES ('c1', 'sl3', 'ETB', 'etb', 0, 'sealed', ?)`, at),
    ).toThrow();
    expect(() => db.run("INSERT INTO sealed_photos (id, collection_id, sealed_id, mime, size, added_at) VALUES ('p1', 'c1', 'sl1', 'image/png', 10, ?)", at)).not.toThrow();

    // Running migrate again is a no-op.
    expect(db.migrate()).toBe(0);
    db.close();
  });
});
