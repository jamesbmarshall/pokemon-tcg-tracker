import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, startServer, type TestServer } from './helpers.ts';
import { DEMO_ALLOWED_MUTATIONS, DEMO_USERNAME, resetDemo, seedDemo } from '../src/demo.ts';
import { allSeedCardIds, buildSeedPlan } from '../src/demo/seed.ts';

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
    const history = s.ctx.db.all('SELECT date FROM value_history WHERE collection_id = ?', collection!.id);
    expect(history.length).toBeGreaterThan(0);
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
