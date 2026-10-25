import type { Db } from '../../src/db.ts';
import { MIGRATIONS } from '../../src/migrations.ts';

export const baselineVersions = [2, 6, 10, 11] as const;
export const baselineAt = '2026-01-02T03:04:05.000Z';

/** Synthetic database checkpoints; never copy production accounts or credentials here. */
export function seedTcgBaseline(db: Db, version: typeof baselineVersions[number]) {
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (let i = 0; i < version; i++) {
    db.tx(() => {
      db.exec(MIGRATIONS[i]);
      db.run('INSERT INTO schema_migrations VALUES (?, ?)', i + 1, baselineAt);
    });
  }
  db.tx(() => {
    db.run("INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES ('owner', 'synthetic-owner', 'Owner', 'not-a-password-hash', 'owner', ?, ?)", baselineAt, baselineAt);
    db.run("INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES ('viewer', 'synthetic-viewer', 'Viewer', 'not-a-password-hash', 'member', ?, ?)", baselineAt, baselineAt);
    db.run("INSERT INTO collections (id, name, kind, owner_id, created_at) VALUES ('collection', 'Synthetic collection', 'personal', 'owner', ?)", baselineAt);
    db.run("INSERT INTO collection_members VALUES ('collection', 'viewer', 'viewer', ?)", baselineAt);
    for (const [variant, quantity, currency] of [['holofoil', 3, 'GBP'], ['stamped', 1, 'EUR']] as const) {
      db.run('INSERT INTO entries (collection_id,id,card_id,set_id,variant,quantity,condition,notes,paid,value_override,added_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        'collection', `synthetic-001::${variant}`, 'synthetic-001', 'synthetic', variant, quantity, 'LP', '日本語 — gift', JSON.stringify({ amount: 7.25, currency }), '19.5', baselineAt, baselineAt);
    }
    db.run("INSERT INTO wishlist VALUES ('collection', 'synthetic-002', ?)", baselineAt);
    db.run("INSERT INTO notes VALUES ('collection', 'synthetic-001', 'Private note', ?)", baselineAt);
    db.run('INSERT INTO graded VALUES (?,?,?,?,?)', 'collection', 'slab', 'synthetic-001', JSON.stringify({ variant: 'stamped', company: 'PSA', grade: '10', certNumber: '000123', countsTowardSet: false, valueUsd: 42 }), null);
    db.run("INSERT INTO graded VALUES ('collection', 'deleted-slab', 'synthetic-001', '{}', ?)", baselineAt);
    db.run("INSERT INTO graded_photos VALUES ('photo', 'collection', 'slab', 'front', 'image/jpeg', 6, ?)", baselineAt);
    db.run("INSERT INTO value_history VALUES ('collection', '2026-01-02', ?)", JSON.stringify({ valueUsd: 120, cards: 5 }));
    db.run("INSERT INTO lists (id,collection_id,name,description,created_at,updated_at) VALUES ('deck','collection','Synthetic deck','Keep order',?,?)", baselineAt, baselineAt);
    db.run("INSERT INTO list_cards (list_id,card_id,position,added_at) VALUES ('deck','synthetic-002',0,?)", baselineAt);
    db.run("INSERT INTO list_cards (list_id,card_id,position,added_at) VALUES ('deck','synthetic-001',1,?)", baselineAt);
    db.run("INSERT INTO price_history (card_id,variant,source,date,price,currency) VALUES ('synthetic-001','stamped','cardmarket','2026-01-02',8.75,'EUR')");
    db.run("INSERT INTO shares (id,token_hash,token_enc,owner_id,collection_id,scope,audience,hide_notes,expires_at,revoked_at,created_at) VALUES ('share','synthetic-hash','synthetic-ciphertext','owner','collection','graded','users',1,?,?,?)", '2027-01-01', baselineAt, baselineAt);
    db.run("INSERT INTO share_users VALUES ('share','viewer')");
    if (version >= 6) {
      db.run("UPDATE lists SET kind='deck', format='expanded'");
      db.run("UPDATE list_cards SET qty=4 WHERE card_id='synthetic-001'");
      db.run("INSERT INTO sealed (collection_id,id,name,product_type,quantity,status,paid,added_at) VALUES ('collection','sealed','Synthetic box','booster_box',2,'opened',?,?)", JSON.stringify({ amount: 50, currency: 'GBP' }), baselineAt);
      db.run("INSERT INTO printing_reassignments VALUES ('collection','synthetic-001','legacy','stamped','unambiguous alias',?)", baselineAt);
      db.run("INSERT INTO printing_changes (card_id,next_data,printing_version,changed_at) VALUES ('synthetic-001',?,2,?)", JSON.stringify([{ id: 'stamped', role: 'unresolved', status: 'unverified' }]), baselineAt);
    }
    if (version >= 10) {
      db.run("UPDATE collections SET revision=7");
      db.run("INSERT INTO mutation_receipts VALUES ('owner','collection','retry-key','synthetic-digest','{\"ok\":true}',7,?)", baselineAt);
      db.run("INSERT INTO imported_list_ids VALUES ('collection','source-deck','deck')");
    }
    if (version >= 11) {
      db.run("INSERT INTO tcg_records VALUES ('collection','mtg','graded','magic-slab',?,NULL)", JSON.stringify({ cardId: 'mtg:synthetic', finish: 'foil', certNumber: '000456', valueUsd: 99 }));
      db.run("INSERT INTO tcg_records VALUES ('collection','mtg','entry','deleted-entry','{}',?)", baselineAt);
      db.run("INSERT INTO tcg_photos VALUES ('magic-photo','collection','mtg','graded','magic-slab','image/jpeg',?)", baselineAt);
      db.run("INSERT INTO tcg_price_history VALUES ('mtg','mtg:synthetic','foil','scryfall','2026-01-02',2.5,'EUR')");
      db.run("INSERT INTO tcg_value_history VALUES ('collection','mtg','2026-01-02',99,1)");
    }
  });
}

// Fixed allowlist: never interpolate a table name from request or fixture input.
const preservedTables = [
  'users', 'collections', 'collection_members', 'entries', 'wishlist', 'notes', 'graded',
  'graded_photos', 'value_history', 'shares', 'share_users', 'lists', 'list_cards', 'price_history', 'sealed', 'sealed_photos',
  'printing_changes', 'printing_reassignments', 'mutation_receipts', 'imported_list_ids',
  'tcg_records', 'tcg_photos', 'tcg_price_history', 'tcg_value_history',
] as const;

/** Stable raw-row comparison supplements literal semantic assertions in the tests. */
export function preservationRows(db: Db) {
  return Object.fromEntries(preservedTables.filter((table) => db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", table)).map((table) => [table,
    db.all(`SELECT * FROM ${table}`).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]));
}
