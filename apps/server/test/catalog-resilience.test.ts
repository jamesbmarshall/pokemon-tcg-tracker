import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
beforeEach(async () => {
  s = await startServer();
});
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('catalogue resilience (HTTP-level)', () => {
  it('retries a network error and succeeds once the upstream recovers', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError('fetch failed');
      return json({ id: 'sv1-1', name: 'Pikachu' });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    const res = await owner.get('/api/tcgdex/v2/en/cards/sv1-1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'sv1-1', name: 'Pikachu' });
    expect(calls).toBe(3);
  });

  it('retries a 5xx response and succeeds once the upstream recovers', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      if (calls < 2) return new Response('boom', { status: 503 });
      return json({ id: 'sv1-2', name: 'Charmander' });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    const res = await owner.get('/api/tcgdex/v2/en/cards/sv1-2');
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(2);
  });

  it('respects Retry-After on a 429 before retrying, and still succeeds', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
      return json({ id: 'sv1-3', name: 'Squirtle' });
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = await setupOwner(s.app);
    const p = owner.get('/api/tcgdex/v2/en/cards/sv1-3');
    // The retry is scheduled ~1s out (the Retry-After value); draining fake timers lets it fire
    // without the test waiting on a real wall-clock second.
    await vi.advanceTimersByTimeAsync(1_100);
    const res = await p;
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(2);
  });

  it('never retries a plain 404 and caches the definitive miss', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    const res = await owner.get('/api/tcgdex/v2/en/cards/sv1-missing');
    expect(res.statusCode).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // A second request is served straight from the cached 404 without calling upstream again.
    const res2 = await owner.get('/api/tcgdex/v2/en/cards/sv1-missing');
    expect(res2.statusCode).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('serves stale cached data once the breaker opens, flagging it with x-cache: stale', async () => {
    const owner = await setupOwner(s.app);
    // First, a healthy fetch populates the cache.
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'sv1-4', name: 'Bulbasaur' })));
    const good = await owner.get('/api/tcgdex/v2/en/cards/sv1-4');
    expect(good.statusCode).toBe(200);
    expect(good.headers['x-cache']).toBe('fresh');

    // Force the cached entry to look expired, then take the upstream down entirely.
    s.ctx.db.run("UPDATE http_cache SET fetched_at = 0 WHERE key = 'GET /en/cards/sv1-4'");
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const p = owner.get('/api/tcgdex/v2/en/cards/sv1-4');
    await vi.advanceTimersByTimeAsync(10_000);
    const stale = await p;
    expect(stale.statusCode).toBe(200);
    expect(stale.headers['x-cache']).toBe('stale');
    expect(stale.json()).toEqual({ id: 'sv1-4', name: 'Bulbasaur' });

    // Five consecutive outright failures (this one plus four more) open the breaker; while open,
    // the admin health panel and the member-visible status flag both reflect it.
    for (let i = 0; i < 4; i++) {
      s.ctx.db.run("UPDATE http_cache SET fetched_at = 0 WHERE key = 'GET /en/cards/sv1-4'");
      const q = owner.get('/api/tcgdex/v2/en/cards/sv1-4');
      await vi.advanceTimersByTimeAsync(10_000);
      await q;
    }
    const status = await owner.get('/api/system/status');
    expect(status.json().catalogDegraded).toBe(true);
    const health = await owner.get('/api/admin/providers');
    expect(health.json().tcgdex.state).toBe('open');
    expect(health.json().tcgdex.staleServedCount).toBeGreaterThanOrEqual(5);
  });

  it('errors with 502 when there is no cached copy to fall back on and the upstream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = await setupOwner(s.app);
    const p = owner.get('/api/tcgdex/v2/en/cards/sv1-never-cached');
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await p;
    expect(res.statusCode).toBe(502);
  });

  it('/api/admin/providers is admin-only', async () => {
    const owner = await setupOwner(s.app);
    const { link } = (await owner.post('/api/admin/invites', { role: 'member' })).json();
    const token = link.split('/invite/')[1];
    const member = new Client(s.app);
    await member.post(`/api/invites/${token}/accept`, { username: 'misty', password: 'correct horse battery' });
    expect((await member.get('/api/admin/providers')).statusCode).toBe(403);
    expect((await owner.get('/api/admin/providers')).statusCode).toBe(200);
  });

  it('never leaks the PriceCharting API key into the /api/admin/providers health panel', async () => {
    const key = 'health-panel-secret-key-abcdef';
    const owner = await setupOwner(s.app);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await owner.put('/api/admin/integrations/pricecharting', { key });
    // A fetch failure whose message echoes the failing URL, same as the dedicated redaction
    // test in pricecharting.test.ts, but this time exercised through the breaker's own
    // RetryableError wrapping and its persisted `lastError` health field. Real timers: a POST
    // through app.inject needs more event-loop ticks than fake timers reliably advance through.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`fetch failed: GET https://www.pricecharting.com/api/products?q=charizard&t=${key}`);
      }),
    );
    const res = await owner.post('/api/admin/integrations/pricecharting/test');
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.json())).not.toContain(key);

    const health = await owner.get('/api/admin/providers');
    expect(health.statusCode).toBe(200);
    const body = health.json();
    expect(body.pricecharting.lastError).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(key);
  });
});
