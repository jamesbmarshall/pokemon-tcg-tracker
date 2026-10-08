import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invite, setupOwner, startServer, type TestServer } from './helpers.ts';
import { pcConfigured, pcGradedPrice, pcSealedPrice, pcSearch, pcProduct } from '../src/providers/pricecharting.ts';

let s: TestServer;
beforeEach(async () => {
  s = await startServer();
});
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

describe('PriceCharting provider', () => {
  it('makes no network requests at all with no key configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(pcConfigured(s.ctx)).toBe(false);
    expect(await pcSearch(s.ctx, 'charizard')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('searches products, converting pennies to dollars and capping results at 25', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ products: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, 'product-name': `Box ${i}`, 'console-name': 'Scarlet & Violet', 'loose-price': 2999 })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    await owner.put('/api/admin/integrations/pricecharting', { key: 'x'.repeat(40) });
    expect(pcConfigured(s.ctx)).toBe(true);
    const results = await pcSearch(s.ctx, 'booster box');
    expect(results).toHaveLength(25);
    expect(results[0]).toMatchObject({ id: 'p0', name: 'Box 0', consoleName: 'Scarlet & Violet' });
    expect(pcSealedPrice(results[0])).toBeCloseTo(29.99);
    // The key itself must never appear in the URL the cache or fetch remembers as a key; fetch
    // was still called with it (that's required to authenticate), but only cachedUpstream sees it.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('t=' + 'x'.repeat(40));
  });

  it('fetches a single product by id', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'p1', 'product-name': 'ETB', 'loose-price': 4500 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    await owner.put('/api/admin/integrations/pricecharting', { key: 'y'.repeat(40) });
    const product = await pcProduct(s.ctx, 'p1');
    expect(product.name).toBe('ETB');
    expect(pcSealedPrice(product)).toBe(45);
  });

  it('maps grading company + grade to the right PriceCharting field', () => {
    const product = (raw: Record<string, number>) => ({ id: 'p1', name: 'Card', raw });
    expect(pcGradedPrice(product({ 'grade-10-price': 10000 }), 'PSA', '10')).toBe(100);
    expect(pcGradedPrice(product({ 'bgs-10-price': 20000 }), 'BGS', '10')).toBe(200);
    expect(pcGradedPrice(product({ 'condition-18-price': 30000 }), 'CGC', '10')).toBe(300);
    expect(pcGradedPrice(product({ 'condition-17-price': 15000 }), 'CGC', '9.5')).toBe(150);
    expect(pcGradedPrice(product({ 'condition-18-price': 9000 }), 'SGC', '10')).toBe(90);
    // Falls through to the generic graded-price when no specific field matches.
    expect(pcGradedPrice(product({ 'graded-price': 5000 }), 'PSA', '7')).toBe(50);
    // Nothing at all: undefined, never a thrown error or a zero masquerading as a real price.
    expect(pcGradedPrice(product({}), 'PSA', '10')).toBeUndefined();
  });

  it('rate-limits upstream calls', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    await owner.put('/api/admin/integrations/pricecharting', { key: 'z'.repeat(40) });
    // The limiter's budget is shared (keyed globally, not per test), so earlier tests in this
    // file may have already spent some of it. Keep calling, with a distinct query each time so
    // nothing is served from cache, until it trips; it must do so well within the 60/minute budget.
    let tripped = false;
    for (let i = 0; i < 70 && !tripped; i++) {
      try {
        await pcSearch(s.ctx, `rate-limit-q${i}`);
      } catch (err) {
        expect((err as Error).message).toMatch(/too many/i);
        tripped = true;
      }
    }
    expect(tripped).toBe(true);
  });

  it('never returns the key to the client, only a configured flag', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    const setRes = await owner.put('/api/admin/integrations/pricecharting', { key: 'secret-key-value-1234567890' });
    expect(setRes.json()).toEqual({ configured: true });
    const got = await owner.get('/api/admin/integrations');
    expect(got.json()).toEqual({ pricecharting: { configured: true } });
    expect(JSON.stringify(got.json())).not.toContain('secret-key-value');
    const member = await owner.get('/api/integrations');
    expect(member.json()).toEqual({ pricecharting: { configured: true } });
    // Raw settings row is encrypted at rest, not the plaintext key.
    const row = s.ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'pricecharting_key'");
    expect(row!.value).not.toContain('secret-key-value');
  });

  it('only an owner or admin may set, clear or test the key', async () => {
    const owner = await setupOwner(s.app);
    const member = await invite(owner, s.app, 'misty');
    expect((await member.put('/api/admin/integrations/pricecharting', { key: 'x'.repeat(40) })).statusCode).toBe(403);
    expect((await member.del('/api/admin/integrations/pricecharting')).statusCode).toBe(403);
    expect((await member.post('/api/admin/integrations/pricecharting/test')).statusCode).toBe(403);
    expect((await member.get('/api/admin/integrations')).statusCode).toBe(403);
    // But any signed-in member can see the public "is it configured" flag.
    expect((await member.get('/api/integrations')).statusCode).toBe(200);
  });

  it('clearing the key removes it from settings and future searches issue no requests', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    await owner.put('/api/admin/integrations/pricecharting', { key: 'x'.repeat(40) });
    expect(pcConfigured(s.ctx)).toBe(true);
    const cleared = await owner.del('/api/admin/integrations/pricecharting');
    expect(cleared.json()).toEqual({ configured: false });
    expect(pcConfigured(s.ctx)).toBe(false);
    fetchSpy.mockClear();
    expect(await pcSearch(s.ctx, 'anything')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('audits key changes and test-connection attempts', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const owner = await setupOwner(s.app);
    await owner.put('/api/admin/integrations/pricecharting', { key: 'x'.repeat(40) });
    await owner.post('/api/admin/integrations/pricecharting/test');
    await owner.del('/api/admin/integrations/pricecharting');
    const rows = s.ctx.db.all<{ action: string }>('SELECT action FROM audit_log ORDER BY id');
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('integration.pricecharting_set');
    expect(actions).toContain('integration.pricecharting_tested');
    expect(actions).toContain('integration.pricecharting_cleared');
  });

  it('never leaks the API key when an upstream request fails: not in logs, not in the error sent to the client', async () => {
    const key = 'super-secret-pc-key-0123456789';
    // A fetch error whose message echoes the failing URL (some runtimes do this), so the key
    // would appear twice over if either the url field or the error message were left unredacted.
    const fetchSpy = vi.fn(async () => {
      throw new Error(`fetch failed: GET https://www.pricecharting.com/api/products?q=charizard&t=${key} unreachable`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const owner = await setupOwner(s.app);
    await owner.put('/api/admin/integrations/pricecharting', { key });
    const res = await owner.post('/api/admin/integrations/pricecharting/test');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).not.toContain(key);
    expect(JSON.stringify(res.json())).not.toContain(key);
    for (const call of warnSpy.mock.calls) expect(JSON.stringify(call)).not.toContain(key);
    warnSpy.mockRestore();
  });

  it('redacts a key-shaped error message before storing it as a job last_error', async () => {
    const { JOBS, runJob } = await import('../src/jobs.ts');
    const key = 'another-secret-key-value-99999';
    JOBS.push({
      name: 'test-leaky-job',
      label: 'Leaky test job',
      schedule: '0 0 31 2 *', // never fires on its own; only run() here
      staleMs: 0,
      run: async () => {
        throw new Error(`upstream call failed: https://www.pricecharting.com/api/product?id=1&t=${key}`);
      },
    });
    await expect(runJob(s.ctx, 'test-leaky-job')).rejects.toThrow();
    const row = s.ctx.db.get<{ last_error: string }>("SELECT last_error FROM jobs WHERE name = 'test-leaky-job'");
    expect(row!.last_error).not.toContain(key);
    expect(row!.last_error).toContain('t=REDACTED');
  });
});
