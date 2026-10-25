/** Offline U01 rehearsal. Creates disposable databases; never opens an installation's data. */
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { startServer, setupOwner, personalId } from '../apps/server/test/helpers.ts';
import { saveSnapshots } from '../apps/server/src/cards.ts';
import { saveGameCards } from '../apps/server/src/tcg/provider.ts';
import { fromScryfall } from '../packages/shared/src/tcg/scryfall.ts';
import { collectionState } from '../apps/server/src/collections.ts';
import { gameState } from '../apps/server/src/tcg/state.ts';
import { Db } from '../apps/server/src/db.ts';
import { PRINTING_VERSION } from '../packages/shared/src/printings.ts';
import type { SQLInputValue } from 'node:sqlite';

const size = Number(process.argv[2] ?? 1000);
assert([1000, 10000, 20000].includes(size), 'Choose 1000, 10000 or 20000 records per game');
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('Baseline is offline'); };
const server = await startServer();
let queries = 0;
const all = server.ctx.db.all.bind(server.ctx.db);
const get = server.ctx.db.get.bind(server.ctx.db);
const run = server.ctx.db.run.bind(server.ctx.db);
server.ctx.db.all = <T>(sql: string, ...params: SQLInputValue[]) => { queries++; return all<T>(sql, ...params); };
server.ctx.db.get = <T>(sql: string, ...params: SQLInputValue[]) => { queries++; return get<T>(sql, ...params); };
server.ctx.db.run = (sql: string, ...params: SQLInputValue[]) => { queries++; return run(sql, ...params); };
try {
  const owner = await setupOwner(server.app);
  const id = await personalId(owner);
  const at = '2026-01-02T03:04:05.000Z';
  server.ctx.db.tx(() => {
    // Batch seeding avoids measuring test-data generation as application state latency.
    for (let i = 0; i < size; i++) {
      const pokemonId = `synthetic-${i}`;
      saveSnapshots(server.ctx.db, [{
        id: pokemonId, name: `Synthetic ${i}`, number: String(i), setId: 'synthetic',
        setName: 'Synthetic', series: 'Test', releaseDate: '2026-01-01', printedTotal: size,
        supertype: 'Pokémon', image: '', imageLarge: '', variants: ['normal'], prices: { normal: 2 }, syncedAt: at,
        printingVersion: PRINTING_VERSION,
      }]);
      server.ctx.db.run('INSERT INTO entries (collection_id,id,card_id,set_id,variant,quantity,paid,added_at) VALUES (?,?,?,?,?,?,?,?)', id, `${pokemonId}::normal`, pokemonId, 'synthetic', 'normal', 2, '{"amount":1,"currency":"GBP"}', at);
      const magic = fromScryfall({ id: `synthetic-${i}`, oracle_id: `identity-${i}`, name: `Synthetic ${i}`, lang: 'en', set: 'tst', set_name: 'Synthetic', collector_number: String(i), games: ['paper'], finishes: ['nonfoil'], prices: { usd: '2' } }, at);
      saveGameCards(server.ctx, [magic]);
      const holding = { id: `${magic.id}::nonfoil`, cardId: magic.id, finish: 'nonfoil', quantity: 2, addedAt: at };
      server.ctx.db.run('INSERT INTO tcg_records VALUES (?,?,?,?,?,NULL)', id, 'mtg', 'entry', holding.id, JSON.stringify(holding));
    }
  });

  function sampleState(game: 'pokemon' | 'mtg') {
    const samples: number[] = [];
    const querySamples: number[] = [];
    for (let i = 0; i < 6; i++) {
      const began = performance.now();
      const beganQueries = queries;
      const state = game === 'pokemon' ? collectionState(server.ctx, id) : gameState(server.ctx, id, game);
      assert.equal(state.entries.length, size);
      assert.equal(state.cards.length, size);
      if (i) {
        samples.push(performance.now() - began); // One explicit warmup.
        querySamples.push(queries - beganQueries);
      }
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[2], maxMs: samples[4], samples: 5, querySamples };
  }
  const setupNetworkRequests = networkRequests;
  networkRequests = 0;
  const reads = { pokemon: sampleState('pokemon'), mtg: sampleState('mtg') };
  const imports: Record<string, { elapsedMs: number; queries: number; networkAttempts: number }> = {};
  for (const game of ['pokemon', 'mtg'] as const) {
    const prefix = `/api/collections/${id}${game === 'mtg' ? '/games/mtg' : ''}`;
    const exported = await owner.get(`${prefix}/export`);
    assert.equal(exported.statusCode, 200);
    const destination = (await owner.post('/api/collections', { name: `Restore ${game}` })).json().id;
    assert.equal(typeof destination, 'string');
    const began = performance.now();
    const beganQueries = queries;
    const beganNetwork = networkRequests;
    const imported = await owner.post(`/api/collections/${destination}${game === 'mtg' ? '/games/mtg' : ''}/import`, exported.json());
    assert.equal(imported.statusCode, 200, imported.body);
    imports[game] = { elapsedMs: performance.now() - began, queries: queries - beganQueries, networkAttempts: networkRequests - beganNetwork };
    const restored = game === 'mtg' ? gameState(server.ctx, destination, game) : collectionState(server.ctx, destination);
    assert.equal(restored.entries.length, size);
    assert.equal(restored.entries.reduce((sum, entry) => sum + entry.quantity, 0), size * 2);
  }
  const beganBackup = performance.now();
  const backup = join(server.dir, 'baseline-backup.db');
  await server.ctx.db.backupTo(backup);
  const backupMs = performance.now() - beganBackup;
  const restoredDb = new Db(backup);
  try {
    assert.equal(restoredDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM entries WHERE collection_id=?', id)!.n, size);
    assert.equal(restoredDb.get<{ n: number }>("SELECT COUNT(*) AS n FROM tcg_records WHERE collection_id=? AND game='mtg'", id)!.n, size);
    assert.deepEqual(restoredDb.all('PRAGMA foreign_key_check'), []);
  } finally { restoredDb.close(); }
  // Report attempts instead of hiding existing fallback behavior. All requests are blocked.
  console.log(JSON.stringify({ recordsPerGame: size, node: process.version, platform: process.platform, arch: process.arch, reads, imports, backupMs, backupBytes: statSync(backup).size, processHighWaterRssKiB: process.resourceUsage().maxRSS, setupNetworkRequests, networkRequests, verified: true }, null, 2));
} finally {
  // This standalone process stays offline through shutdown and deferred hydration.
  await server.close();
}
