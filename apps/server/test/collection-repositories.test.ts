import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Db } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { Sealer } from '../src/security.ts';
import type { Ctx } from '../src/context.ts';
import { collectionState } from '../src/collections.ts';
import { gameState } from '../src/tcg/state.ts';
import { collectionRepository, readCollection } from '../src/tcg/repositories/collection.ts';
import { baselineAt, preservationRows, seedTcgBaseline } from './fixtures/tcg-baseline.ts';
import { PRINTING_VERSION } from '@poketracker/shared/printings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Db;
let ctx: Ctx;
const slab = Object.freeze({ id: 'slab', cardId: 'synthetic-001', setId: 'synthetic', variant: 'stamped', company: 'Other', companyName: 'Local grader', grade: '10', label: 'Gem', certNumber: '000123', subgrades: { centering: 9.5 }, countsTowardSet: false, valueUsd: 42, paid: { amount: 30, currency: 'EUR' }, notes: 'Private slab', pcProductId: 'pc-1', pcPrice: 50, pcUpdatedAt: baselineAt, addedAt: baselineAt, updatedAt: baselineAt });
const genericEntry = Object.freeze({ id: 'bare-id::normal', cardId: 'bare-id', finish: 'normal', quantity: 4, valueUsd: 19.5, paid: { amount: 7.25, currency: 'GBP' }, notes: '日本語 — gift', addedAt: baselineAt, updatedAt: baselineAt, legacyExtension: 'retain me' });
beforeEach(() => {
  db = new Db(':memory:');
  seedTcgBaseline(db, 11);
  db.migrate();
  ctx = { db, config: loadConfig({ DATA_DIR: '/tmp/repository-fixture', JOBS: '0' }), sealer: new Sealer(Buffer.alloc(32, 7)), log: console as unknown as Ctx['log'], services: {} };
  db.run('UPDATE graded SET data = ? WHERE id = ?', JSON.stringify(slab), 'slab');
  db.run('UPDATE value_history SET data = ?', JSON.stringify({ date: '2026-01-02', valueUsd: 120, cards: 5, unique: 1, costUsd: 31, costedValueUsd: 78 }));
  db.run("INSERT INTO tcg_records VALUES ('collection','mtg','entry',?,?,NULL)", genericEntry.id, JSON.stringify(genericEntry));
  db.run("UPDATE tcg_records SET data = ? WHERE id = 'magic-slab'", JSON.stringify({ id: 'magic-slab', cardId: 'bare-id', finish: 'normal', company: 'PSA', grade: '10', countsTowardSet: false, certNumber: '000456', valueUsd: 42, paid: { amount: 30, currency: 'EUR' }, addedAt: baselineAt }));
  db.run("INSERT INTO tcg_records VALUES ('collection','mtg','sealed','opened',?,NULL)", JSON.stringify({ id: 'opened', name: 'Opened box', productType: 'booster_box', quantity: 2, status: 'opened', valueUsd: 999, addedAt: baselineAt, openedAt: baselineAt }));
  db.run("INSERT INTO tcg_records VALUES ('collection','mtg','wishlist','bare-wish',?,NULL)", JSON.stringify({ id: 'bare-wish' }));
  db.run("INSERT INTO tcg_records VALUES ('collection','mtg','note','bare-id',?,NULL)", JSON.stringify({ id: 'bare-id', text: 'Private note', updatedAt: baselineAt }));
  db.run("INSERT INTO tcg_records VALUES ('collection','mtg','list','generic-deck',?,NULL)", JSON.stringify({ id: 'generic-deck', game: 'mtg', name: 'Deck', description: 'Keep order', kind: 'deck', format: 'modern', items: [{ cardId: 'bare-wish', quantity: 1, zone: 'maybeboard' }, { cardId: 'bare-id', quantity: 4, zone: 'main' }], addedAt: baselineAt }));
  db.run("UPDATE tcg_value_history SET value_usd = 120, cards = 5");
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Repositories must not fetch'); }));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Both existing storage formats must satisfy this same read-only, scoped contract.
describe.each(['pokemon', 'mtg'])('%s collection repository contract', (game) => {
  it('preserves native state and computes the existing valuation without writes or hydration', () => {
    const before = preservationRows(db);
    const expected = game === 'pokemon' ? collectionState(ctx, 'collection') : gameState(ctx, 'collection', game, 'viewer');
    db.exec('PRAGMA query_only = ON');
    const result = readCollection(ctx, 'viewer', 'collection', game);
    expect(result.state).toEqual(expected);
    expect(result).toMatchObject({ game, collectionId: 'collection', role: 'viewer', revision: 7, valuation: { valueUsd: 120, cards: 5 } });
    expect(result.state.entries.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(4);
    expect(result.state.graded).toHaveLength(1);
    expect(result.state.sealed[0].status).toBe('opened');
    expect(result.state.notes[0].text).toBe('Private note');
    expect(result.state.history[0]).toMatchObject({ date: '2026-01-02', valueUsd: 120, cards: 5 });
    expect(result.state.entries[0]).toMatchObject({ paid: { amount: 7.25, currency: 'GBP' }, notes: '日本語 — gift', addedAt: baselineAt });
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0]).toMatchObject({ kind: 'graded', mime: 'image/jpeg', addedAt: baselineAt });
    expect(collectionRepository(ctx, 'collection', game).history()).toEqual(result.state.history);
    expect(preservationRows(db)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    expect(db.raw.isTransaction).toBe(false);
  });
  it('does not authorize an outsider or a missing collection and releases the snapshot on error', () => {
    for (const [user, collection] of [['outsider', 'collection'], ['owner', 'missing']])
      expect(() => readCollection(ctx, user, collection, game)).toThrow('Collection not found');
    expect(db.raw.isTransaction).toBe(false);
    expect(readCollection(ctx, 'owner', 'collection', game).role).toBe('owner');
    db.run("DELETE FROM collection_members WHERE user_id = 'viewer'");
    expect(() => readCollection(ctx, 'viewer', 'collection', game)).toThrow('Collection not found');
  });
  it('returns detached results, never mutating cached or persisted collector metadata', () => {
    const first = readCollection(ctx, 'owner', 'collection', game);
    first.state.entries[0].quantity = 999;
    first.state.entries[0].paid!.amount = 999;
    first.photos[0].mime = 'changed';
    const again = readCollection(ctx, 'owner', 'collection', game);
    expect(again.state.entries.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(4);
    expect(again.state.entries[0].paid!.amount).toBe(7.25);
    expect(again.photos[0].mime).toBe('image/jpeg');
  });
  it('isolates collections and excludes orphan or deleted-parent photos', () => {
    db.run("INSERT INTO collections (id,name,kind,owner_id,created_at) VALUES ('other','Other','shared','owner',?)", baselineAt);
    if (game === 'pokemon') {
      db.run("INSERT INTO graded_photos VALUES ('orphan','collection','missing','back','image/png',1,?)", baselineAt);
      db.run("INSERT INTO graded_photos VALUES ('deleted','collection','deleted-slab','back','image/png',1,?)", baselineAt);
      db.run("INSERT INTO graded_photos VALUES ('foreign','other','slab','back','image/png',1,?)", baselineAt);
    } else {
      expect(() => db.run("INSERT INTO tcg_photos VALUES ('orphan','collection','mtg','graded','missing','image/png',?)", baselineAt)).toThrow('FOREIGN KEY');
      db.run("INSERT INTO tcg_records VALUES ('collection','mtg','graded','deleted-slab','{}',?)", baselineAt);
      db.run("INSERT INTO tcg_photos VALUES ('deleted','collection','mtg','graded','deleted-slab','image/png',?)", baselineAt);
      db.run("INSERT INTO tcg_records VALUES ('other','mtg','graded','magic-slab','{}',?)", baselineAt);
      db.run("INSERT INTO tcg_photos VALUES ('foreign','other','mtg','graded','magic-slab','image/png',?)", baselineAt);
      db.run("INSERT INTO tcg_records VALUES ('collection','pokemon','graded','magic-slab','{}',NULL)");
      db.run("INSERT INTO tcg_photos VALUES ('wrong-game','collection','pokemon','graded','magic-slab','image/png',?)", baselineAt);
    }
    expect(readCollection(ctx, 'owner', 'collection', game).photos).toHaveLength(1);
    const empty = readCollection(ctx, 'owner', 'other', game);
    expect(empty.state.entries).toEqual([]);
    expect(empty.state.history).toEqual([]);
    expect(empty.photos).toEqual([]);
    expect(empty.valuation).toMatchObject({ valueUsd: 0, cards: 0 });
  });
  it('reads 20,000 cached cards with bounded queries and preserves zero overrides', () => {
    db.run('DELETE FROM entries');
    db.run('DELETE FROM graded');
    db.run('DELETE FROM tcg_records');
    db.run('DELETE FROM lists');
    db.run('DELETE FROM wishlist');
    db.run('DELETE FROM notes');
    db.tx(() => {
      for (let i = 0; i < 20000; i++) {
        const id = `legacy-${i}`;
        if (game === 'pokemon') {
          const snapshot = { id, name: 'Card', number: String(i), setId: 'legacy', setName: 'Legacy', series: '', releaseDate: '', printedTotal: 20000, supertype: 'Pokémon', image: '', imageLarge: '', variants: ['normal'], printingVersion: PRINTING_VERSION, prices: { normal: 2 }, syncedAt: baselineAt };
          db.run('INSERT INTO cards (id,set_id,data,synced_at) VALUES (?,?,?,?)', id, 'legacy', JSON.stringify(snapshot), baselineAt);
          db.run('INSERT INTO entries (collection_id,id,card_id,set_id,variant,quantity,value_override,added_at) VALUES (?,?,?,?,?,?,?,?)', 'collection', `${id}::normal`, id, 'legacy', 'normal', 1, i % 2 ? null : '0', baselineAt);
        } else {
          const card = { game, id, providerId: id, identity: id, name: 'Card', setId: 'legacy', setName: 'Legacy', setCode: 'LEG', number: String(i), language: 'en', rarity: '', artist: '', image: '', faces: [], finishes: ['normal'], treatments: [], extra: false, paper: true, prices: { normal: [{ amount: 2, currency: 'USD', source: 'fixture', at: baselineAt }] }, fetchedAt: baselineAt, details: { kind: 'mtg' } };
          db.run('INSERT INTO tcg_cards VALUES (?,?,?,?,?)', game, id, 'legacy', JSON.stringify(card), 1);
          db.run('INSERT INTO tcg_records VALUES (?,?,?,?,?,NULL)', 'collection', game, 'entry', `${id}::normal`, JSON.stringify({ id: `${id}::normal`, cardId: id, finish: 'normal', quantity: 1, ...(i % 2 ? {} : { valueUsd: 0 }), addedAt: baselineAt }));
        }
      }
    });
    const all = vi.spyOn(db, 'all'), get = vi.spyOn(db, 'get');
    db.exec('PRAGMA query_only = ON');
    const started = performance.now();
    const result = readCollection(ctx, 'owner', 'collection', game);
    const elapsed = performance.now() - started;
    expect(result.state.cards).toHaveLength(20000);
    expect(result.state.entries).toHaveLength(20000);
    expect(result.valuation).toMatchObject({ cards: 20000, valueUsd: 20000 });
    expect(all.mock.calls.length + get.mock.calls.length).toBeLessThanOrEqual(80);
    // Generous CI guard; query count is the deterministic scaling requirement.
    expect(elapsed).toBeLessThan(3000);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('retains Pokémon-only fields and generic extensions without forcing lossy DTO conversion', () => {
  const pokemon = readCollection(ctx, 'owner', 'collection', 'pokemon');
  expect(pokemon.state.graded[0]).toEqual(slab);
  expect(pokemon.state.history[0]).toEqual({ date: '2026-01-02', valueUsd: 120, cards: 5, unique: 1, costUsd: 31, costedValueUsd: 78 });
  expect(pokemon.photos[0]).toEqual({ id: 'photo', kind: 'graded', recordId: 'slab', side: 'front', mime: 'image/jpeg', size: 6, addedAt: baselineAt });
  if (pokemon.storage !== 'pokemon') throw new Error('Expected Pokémon storage');
  expect(pokemon.state.lists[0]).toMatchObject({ cards: ['synthetic-002', 'synthetic-001'], cardQtys: { 'synthetic-002': 1, 'synthetic-001': 4 }, createdAt: baselineAt, updatedAt: baselineAt });
  const generic = readCollection(ctx, 'owner', 'collection', 'mtg');
  expect(generic.state.entries).toEqual([genericEntry]);
  expect(generic.photos[0]).not.toHaveProperty('size');
  expect(() => readCollection(ctx, 'owner', 'collection', 'unregistered')).toThrow('Game not found');
});

it('joins a caller transaction without committing its pending changes', () => {
  expect(() => db.tx(() => {
    db.run("UPDATE collections SET revision = 8 WHERE id = 'collection'");
    expect(readCollection(ctx, 'owner', 'collection', 'pokemon').revision).toBe(8);
    expect(db.raw.isTransaction).toBe(true);
    throw new Error('Caller rollback');
  })).toThrow('Caller rollback');
  expect(readCollection(ctx, 'owner', 'collection', 'pokemon').revision).toBe(7);
});

it('keeps authorization, revision and holdings in one snapshot across a concurrent commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repository-snapshot-'));
  const reader = new Db(join(dir, 'state.db'));
  let writer: Db | undefined;
  try {
    seedTcgBaseline(reader, 11);
    reader.migrate();
    reader.run('UPDATE graded SET data = ? WHERE id = ?', JSON.stringify(slab), 'slab');
    writer = new Db(join(dir, 'state.db'));
    const original = reader.all.bind(reader);
    let changed = false;
    vi.spyOn(reader, 'all').mockImplementation((sql, ...params) => {
      if (!changed) {
        changed = true;
        writer!.tx(() => {
          writer!.run("UPDATE entries SET quantity = quantity + 100 WHERE variant = 'holofoil'");
          writer!.run("UPDATE collections SET revision = 8 WHERE id = 'collection'");
        });
      }
      return original(sql, ...params);
    });
    const first = readCollection({ ...ctx, db: reader }, 'owner', 'collection', 'pokemon');
    expect(first.revision).toBe(7);
    expect(first.state.entries.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(4);
    const next = readCollection({ ...ctx, db: reader }, 'owner', 'collection', 'pokemon');
    expect(next.revision).toBe(8);
    expect(next.state.entries.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(104);
  } finally { writer?.close(); reader.close(); rmSync(dir, { recursive: true, force: true }); }
});
