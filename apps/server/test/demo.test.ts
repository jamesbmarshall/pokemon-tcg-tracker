import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, startServer, type TestServer } from './helpers.ts';
import { DEMO_ALLOWED_MUTATIONS, DEMO_USERNAME, resetDemo, seedDemo } from '../src/demo.ts';
import { allSeedCardIds, buildSeedPlan, historyFactor, seedPrinting } from '../src/demo/seed.ts';
import { saveSnapshots } from '../src/cards.ts';
import { PRINTING_VERSION } from '@poketracker/shared/printings';
import { todayKey } from '@poketracker/shared/value';
import type { CardSnapshot } from '@poketracker/shared/types';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

afterEach(() => vi.unstubAllGlobals());

describe('demo mode off (default)', () => {
  let s: TestServer;
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 404 })));
    s = await startServer();
  });
  afterEach(async () => s.close());

  it('never seeds a demo account and 404s the demo login route', async () => {
    expect(s.ctx.db.get('SELECT id FROM users WHERE username = ?', DEMO_USERNAME)).toBeUndefined();
    const res = await new Client(s.app).post('/api/demo/login');
    expect(res.statusCode).toBe(404);
  });

  it('leaves ordinary mutating routes unaffected', async () => {
    const res = await new Client(s.app).post('/api/setup', { token: 'nope' });
    // Rejected for a bad token, not the demo guard (which is a no-op here).
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('bad_setup_token');
  });
});

describe('demo mode on', () => {
  let s: TestServer;
  const routes: { method: string; url: string }[] = [];

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 404 })));
    routes.length = 0;
    s = await startServer({ DEMO_MODE: '1' }, { onRoute: (method, url) => routes.push({ method, url }) });
    await seedDemo(s.ctx);
  });
  afterEach(async () => s.close());

  it('seeds a demo account with the full seed plan on first boot', () => {
    const user = s.ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', DEMO_USERNAME);
    expect(user).toBeTruthy();
    const plan = buildSeedPlan();
    const collection = s.ctx.db.get<{ id: string }>('SELECT id FROM collections WHERE owner_id = ?', user!.id);
    const entries = s.ctx.db.all<{ card_id: string }>('SELECT card_id FROM entries WHERE collection_id = ?', collection!.id);
    expect(entries).toHaveLength(plan.ownedIds.length);
    const wishlist = s.ctx.db.all('SELECT card_id FROM wishlist WHERE collection_id = ?', collection!.id);
    expect(wishlist).toHaveLength(plan.wishlistIds.length);
    const graded = s.ctx.db.all('SELECT id FROM graded WHERE collection_id = ?', collection!.id);
    expect(graded).toHaveLength(plan.graded.length);
    const lists = s.ctx.db.all('SELECT id FROM lists WHERE collection_id = ?', collection!.id);
    expect(lists).toHaveLength(plan.lists.length);
    // Offline, with no card data: legacy labels the card page can identify, and no invented value history.
    expect(s.ctx.db.all<{ variant: string }>('SELECT DISTINCT variant FROM entries WHERE collection_id = ?', collection!.id)).toEqual([{ variant: 'normal' }]);
    // Only today's real point is recorded (zero, since nothing is priced); nothing is backfilled.
    const history = s.ctx.db.all<{ data: string }>('SELECT data FROM value_history WHERE collection_id = ?', collection!.id);
    expect(history.map((h) => JSON.parse(h.data).valueUsd)).toEqual([0]);
  });

  it('seeding again is a no-op (idempotent)', async () => {
    const before = s.ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', DEMO_USERNAME);
    await seedDemo(s.ctx);
    const after = s.ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', DEMO_USERNAME);
    expect(after!.id).toBe(before!.id);
    expect(s.ctx.db.all('SELECT id FROM users WHERE username = ?', DEMO_USERNAME)).toHaveLength(1);
  });

  it('blocks /api/setup, so a demo instance can never grow a real owner account', async () => {
    const res = await new Client(s.app).post('/api/setup', { token: 'whatever', username: 'ash', password: 'correct horse battery', displayName: 'Ash' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('demo_read_only');
  });

  it('signs a visitor in without a password and reports demoMode on /api/setup', async () => {
    const setup = await new Client(s.app).get('/api/setup');
    expect(setup.json()).toEqual({ needed: false, demoMode: true });

    const c = new Client(s.app);
    const login = await c.post('/api/demo/login');
    expect(login.statusCode).toBe(200);
    expect(login.json().user.username).toBe(DEMO_USERNAME);

    const me = await c.get('/api/auth/me');
    expect(me.json().user.username).toBe(DEMO_USERNAME);

    const status = await c.get('/api/system/status');
    expect(status.json().demoMode).toBe(true);

    const out = await c.post('/api/auth/logout');
    expect(out.statusCode).toBe(200);
  });

  it('limits public demo sign-ins before they can create unlimited sessions', async () => {
    const c = new Client(s.app);
    for (let i = 0; i < 20; i++) expect((await c.post('/api/demo/login')).statusCode).toBe(200);
    const limited = await c.post('/api/demo/login');
    expect(limited.statusCode).toBe(429);
    expect(s.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n).toBe(20);
  });

  it('nightly reset restores a demo collection that a visitor emptied', async () => {
    const c = new Client(s.app);
    await c.post('/api/demo/login');
    const [{ id: collectionId }] = (await c.get('/api/collections')).json() as { id: string }[];

    // The guard blocks the real clear endpoint, so simulate "a visitor broke it" directly.
    s.ctx.db.run('DELETE FROM entries WHERE collection_id = ?', collectionId);
    expect(s.ctx.db.all('SELECT 1 FROM entries WHERE collection_id = ?', collectionId)).toHaveLength(0);

    await resetDemo(s.ctx);

    const user = s.ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', DEMO_USERNAME);
    const [{ id: freshCollectionId }] = s.ctx.db.all<{ id: string }>('SELECT id FROM collections WHERE owner_id = ?', user!.id);
    const entries = s.ctx.db.all('SELECT card_id FROM entries WHERE collection_id = ?', freshCollectionId);
    expect(entries.length).toBe(buildSeedPlan().ownedIds.length);
    // The session (and therefore the signed-in visitor) survives the reset.
    expect((await c.get('/api/auth/me')).json().user.username).toBe(DEMO_USERNAME);
  });

  it('rejects every registered mutating route except the demo allow-list', async () => {
    const c = new Client(s.app);
    await c.post('/api/demo/login');

    const blocked = routes.filter((r) => !SAFE.has(r.method) && !DEMO_ALLOWED_MUTATIONS.has(`${r.method} ${r.url}`));
    expect(blocked.length).toBeGreaterThan(10); // sanity check the route list was actually collected

    for (const r of blocked) {
      const url = r.url.replace(/:[^/]+/g, 'x');
      const res = await c.req(r.method, url, r.method === 'GET' || r.method === 'HEAD' ? undefined : {});
      expect(res.statusCode, `${r.method} ${r.url} should be blocked`).toBe(403);
      expect(res.json().code, `${r.method} ${r.url} should carry the demo_read_only code`).toBe('demo_read_only');
    }
  });

  it('still allows the catalogue cache routes the UI needs to render cards', async () => {
    const c = new Client(s.app);
    await c.post('/api/demo/login');
    const hydrate = await c.post('/api/cards/hydrate', { ids: [allSeedCardIds()[0]] });
    expect(hydrate.statusCode).not.toBe(403);
  });
});

describe('demo seed with card data', () => {
  let s: TestServer;
  // Base Set Charizard and Pikachu as the catalogue describes them: each card's core printing sits
  // after a premium one, so the seed must pick by role, not position.
  const snapshot = (id: string, printings: { id: string; role: 'core' | 'additional' | 'unresolved'; price: number }[]): CardSnapshot => ({
    id, name: `Card ${id}`, number: id.split('-')[1], setId: id.split('-')[0], setName: 'Base', series: 'Base', releaseDate: '1999-01-09', printedTotal: 102,
    supertype: 'Pokémon', image: '', imageLarge: '', syncedAt: new Date().toISOString(), printingVersion: PRINTING_VERSION,
    variants: printings.map((p) => p.id),
    printings: printings.map((p) => ({ id: p.id, label: p.id, role: p.role })) as CardSnapshot['printings'],
    prices: Object.fromEntries(printings.map((p) => [p.id, p.price])),
  });

  beforeEach(async () => {
    // Every upstream fetch fails, so the seed works from the stored card data alone.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 404 })));
    s = await startServer({ DEMO_MODE: '1' });
    saveSnapshots(s.ctx.db, [
      snapshot('base1-4', [{ id: 'holo1st', role: 'additional', price: 9000 }, { id: 'holo', role: 'core', price: 400 }]),
      snapshot('base1-58', [{ id: 'normal1st', role: 'additional', price: 60 }, { id: 'normalUnlimited', role: 'core', price: 2 }]),
    ]);
    await seedDemo(s.ctx);
  });
  afterEach(async () => s.close());

  const collectionId = () => {
    const user = s.ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', DEMO_USERNAME)!;
    return s.ctx.db.get<{ id: string }>('SELECT id FROM collections WHERE owner_id = ?', user.id)!.id;
  };

  it('files each copy under its core printing, for raw copies and slabs alike', () => {
    const id = collectionId();
    expect(s.ctx.db.get('SELECT variant FROM entries WHERE collection_id = ? AND card_id = ?', id, 'base1-58')).toEqual({ variant: 'normalUnlimited' });
    const slab = s.ctx.db.get<{ data: string }>('SELECT data FROM graded WHERE collection_id = ? AND card_id = ?', id, 'base1-4')!;
    expect(JSON.parse(slab.data).variant).toBe('holo');
  });

  it('seeds a value history that ends at the real total, with no jump on the last day', () => {
    const rows = s.ctx.db.all<{ date: string; data: string }>('SELECT date, data FROM value_history WHERE collection_id = ? ORDER BY date', collectionId());
    const points = rows.map((r) => JSON.parse(r.data) as { valueUsd: number });
    expect(rows).toHaveLength(61);
    expect(rows.at(-1)!.date).toBe(todayKey());
    // Charizard raw and slabbed at its core price ($400 each) plus Pikachu ($2), never the 1st
    // Edition prices; every other seed card is unpriced.
    expect(points.at(-1)!.valueUsd).toBe(802);
    expect(points.at(-2)!.valueUsd).toBeCloseTo(802 * historyFactor(1, 60), 2);
    for (const p of points) expect(p.valueUsd / 802).toBeGreaterThan(0.6);
  });
});

describe('seedPrinting', () => {
  it('prefers a core printing, then any printing, then a legacy variant', () => {
    expect(seedPrinting({ printings: [{ id: 'a', role: 'additional' }, { id: 'b', role: 'core' }] })).toBe('b');
    expect(seedPrinting({ printings: [{ id: 'a', role: 'unresolved' }] })).toBe('a');
    expect(seedPrinting({ variants: ['holofoil'] })).toBe('holofoil');
    expect(seedPrinting(undefined)).toBe('normal');
  });

  it('shapes history to equal today exactly', () => {
    expect(historyFactor(0, 60)).toBe(1);
    expect(historyFactor(60, 60)).toBeLessThan(1);
  });
});
