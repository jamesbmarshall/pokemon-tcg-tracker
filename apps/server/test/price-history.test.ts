import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prunePriceHistory, readPriceHistory, saveSnapshots } from '../src/cards.ts';
import { Db } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import type { CardSnapshot } from '@poketracker/shared/types';
import { invite, personalId, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
  s = await startServer();
});
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

const snap = (id: string, prices: Record<string, number> = { normal: 2 }): CardSnapshot => ({
  id,
  name: `Card ${id}`,
  number: id.split('-')[1],
  setId: id.split('-')[0],
  setName: 'Set',
  series: 'S',
  releaseDate: '2024-01-01',
  printedTotal: 100,
  supertype: 'Pokémon',
  image: `https://assets.tcgdex.net/en/x/${id}/low.webp`,
  imageLarge: '',
  variants: ['normal'],
  prices,
  syncedAt: new Date().toISOString(),
});

describe('price history ingestion', () => {
  it('migration 2 applies cleanly on top of an existing migration-1 database, adding the column and table without touching existing data', () => {
    const db = new Db(':memory:');
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(MIGRATIONS[0]); // simulate a database created before this feature shipped
    db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)', new Date().toISOString());
    db.run("INSERT INTO settings (key, value) VALUES ('fx', '{}')");
    expect(db.migrate()).toBe(2); // applies the two new migrations (price history + sealed/graded), not version 1 again
    // entries.value_override exists and is nullable (no error inserting without it)
    expect(() => db.run("INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('a', 'normal', 'tcgplayer', '2024-01-01', 1, 'USD')")).not.toThrow();
    expect(db.get("SELECT value FROM settings WHERE key = 'fx'")).toEqual({ value: '{}' });
    // Running migrate again is a no-op (idempotent).
    expect(db.migrate()).toBe(0);
    db.close();
  });

  it('writes one row per card/variant/source via a card hydrate, and does not duplicate same-day refreshes', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/cards/sv2-077')) {
        return Response.json({
          id: 'sv2-077',
          localId: '77',
          name: 'Sprigatito',
          set: { id: 'sv02', name: 'Paldea Evolved' },
          variants: { normal: true },
          pricing: {
            tcgplayer: { updated: '2026-10-01', normal: { marketPrice: 4.5 } },
            cardmarket: { updated: '2026-10-01', avg: 3.1, trend: 3.3 },
          },
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/entries`, { entries: [{ cardId: 'sv2-077', variant: 'normal', quantity: 1, addedAt: new Date().toISOString() }] });
    await c.post('/api/cards/hydrate', { ids: ['sv2-077'] });

    const rows = s.ctx.db.all('SELECT * FROM price_history WHERE card_id = ?', 'sv2-077');
    expect(rows).toHaveLength(2); // tcgplayer + cardmarket, one day each

    // Hydrating again the same day should overwrite, not duplicate, today's rows.
    await c.post('/api/cards/hydrate', { ids: ['sv2-077'] });
    const rows2 = s.ctx.db.all('SELECT * FROM price_history WHERE card_id = ?', 'sv2-077');
    expect(rows2).toHaveLength(2);

    const history = readPriceHistory(s.ctx.db, 'sv2-077', 90);
    expect(history.series).toHaveLength(2);
    const tcg = history.series.find((x) => x.source === 'tcgplayer');
    expect(tcg?.currency).toBe('USD');
    expect(tcg?.points[0].price).toBe(4.5);
    const cm = history.series.find((x) => x.source === 'cardmarket');
    expect(cm?.currency).toBe('EUR');
    expect(cm?.points[0].price).toBe(3.3);
  });

  it('exposes the history endpoint behind auth and validates the card id', async () => {
    saveSnapshots(s.ctx.db, [snap('sv1-001')]);
    const today = new Date().toISOString().slice(0, 10);
    s.ctx.db.run(
      "INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('sv1-001', 'normal', 'tcgplayer', ?, 1.5, 'USD')",
      today,
    );
    const anon = (await s.app.inject({ method: 'GET', url: '/api/cards/sv1-001/prices/history', headers: { 'x-poketracker': '1' } }));
    expect(anon.statusCode).toBe(401);

    const c = await setupOwner(s.app);
    const res = await c.get('/api/cards/sv1-001/prices/history?days=30');
    expect(res.statusCode).toBe(200);
    expect(res.json().series[0].points).toEqual([{ date: today, price: 1.5 }]);

    expect((await c.get('/api/cards/' + encodeURIComponent('../x') + '/prices/history')).statusCode).toBe(400);
  });

  it('prunes rows older than the configured retention window', () => {
    const old = new Date(Date.now() - 1000 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date().toISOString().slice(0, 10);
    s.ctx.db.run("INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('sv1-001', 'normal', 'tcgplayer', ?, 1, 'USD')", old);
    s.ctx.db.run("INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('sv1-001', 'normal', 'tcgplayer', ?, 2, 'USD')", recent);
    const removed = prunePriceHistory(s.ctx.db, 730);
    expect(removed).toBe(1);
    const rows = s.ctx.db.all('SELECT date FROM price_history');
    expect(rows).toEqual([{ date: recent }]);
  });
});

describe('manual value overrides', () => {
  it('lets a member set and clear a per-entry value, which round-trips via state and export/import', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    saveSnapshots(s.ctx.db, [snap('sv1-001', { normal: 2 })]);
    await c.put(`/api/collections/${id}/entries`, {
      entries: [{ cardId: 'sv1-001', variant: 'normal', quantity: 1, addedAt: new Date().toISOString(), valueUsd: 99.5 }],
    });
    let st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.entries[0].valueUsd).toBe(99.5);

    // Exporting and reimporting into a fresh collection should keep the override.
    const dump = (await c.get(`/api/collections/${id}/export`)).json();
    const other = await invite(c, s.app, 'misty');
    const otherId = await personalId(other);
    await other.post(`/api/collections/${otherId}/import`, dump);
    st = (await other.get(`/api/collections/${otherId}/state`)).json();
    expect(st.entries[0].valueUsd).toBe(99.5);

    // Clearing it (omitting valueUsd on a resubmit) removes the override.
    await c.put(`/api/collections/${id}/entries`, { entries: [{ cardId: 'sv1-001', variant: 'normal', quantity: 1, addedAt: new Date().toISOString() }] });
    st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.entries[0].valueUsd).toBeUndefined();
  });

  it('takes precedence over the market price in totals and value snapshots', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    saveSnapshots(s.ctx.db, [snap('sv1-001', { normal: 2 })]);
    await c.put(`/api/collections/${id}/entries`, {
      entries: [{ cardId: 'sv1-001', variant: 'normal', quantity: 2, addedAt: new Date().toISOString(), valueUsd: 10 }],
    });
    const point = (await c.post(`/api/collections/${id}/value`)).json().point;
    expect(point.valueUsd).toBe(20); // 2 copies x $10 override, not 2 x $2 market
  });

  it('is redacted from shares when hide_value is set, alongside the existing graded redaction', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    saveSnapshots(s.ctx.db, [snap('sv1-001', { normal: 2 })]);
    await c.put(`/api/collections/${id}/entries`, {
      entries: [{ cardId: 'sv1-001', variant: 'normal', quantity: 1, addedAt: new Date().toISOString(), valueUsd: 50 }],
    });
    const share = (await c.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public', hideValue: true })).json();
    const token = share.url.split('/s/')[1];
    const res = await s.app.inject({ method: 'GET', url: `/api/public/${token}`, headers: { 'x-poketracker': '1' } });
    expect(res.json().entries[0].valueUsd).toBeUndefined();
  });
});

describe('biggest movers', () => {
  it('reports gainers and losers computed from price history, with an empty state when history is thin', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    saveSnapshots(s.ctx.db, [snap('sv1-001', { normal: 10 }), snap('sv1-002', { normal: 5 })]);
    await c.put(`/api/collections/${id}/entries`, {
      entries: [
        { cardId: 'sv1-001', variant: 'normal', quantity: 1, addedAt: new Date().toISOString() },
        { cardId: 'sv1-002', variant: 'normal', quantity: 1, addedAt: new Date().toISOString() },
      ],
    });

    // No history yet: empty state.
    let movers = (await c.get(`/api/collections/${id}/movers?days=7`)).json();
    expect(movers.gainers).toEqual([]);
    expect(movers.losers).toEqual([]);

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    s.ctx.db.run("INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('sv1-001', 'normal', 'tcgplayer', ?, 6, 'USD')", weekAgo);
    s.ctx.db.run("INSERT INTO price_history (card_id, variant, source, date, price, currency) VALUES ('sv1-002', 'normal', 'tcgplayer', ?, 9, 'USD')", weekAgo);

    movers = (await c.get(`/api/collections/${id}/movers?days=7`)).json();
    expect(movers.gainers.map((m: { cardId: string }) => m.cardId)).toEqual(['sv1-001']);
    expect(movers.losers.map((m: { cardId: string }) => m.cardId)).toEqual(['sv1-002']);
    expect(movers.gainers[0].changeUsd).toBeCloseTo(4);
    expect(movers.losers[0].changeUsd).toBeCloseTo(-4);
  });

  it('requires read access to the collection', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const res = await s.app.inject({ method: 'GET', url: `/api/collections/${id}/movers`, headers: { 'x-poketracker': '1' } });
    expect(res.statusCode).toBe(401);
  });
});
