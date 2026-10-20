import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer, setupOwner, personalId, type TestServer } from './helpers.ts';
let s: TestServer;
beforeEach(async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response('[]'))); s = await startServer(); });
afterEach(async () => { await s.close(); vi.unstubAllGlobals(); });

describe('guarded collection edits', () => {
  it('preserves concurrent increments and applies a retried increment once', async () => {
    const c = await setupOwner(s.app); const id = await personalId(c);
    await c.put(`/api/collections/${id}/entries`, { entries: [{ cardId: 'sv1-001', variant: 'normal', quantity: 1 }] });
    const path = `/api/collections/${id}/entries/adjust`;
    const body = { cardId: 'sv1-001', variant: 'normal', delta: 1 };
    const responses = await Promise.all(['increment-a', 'increment-b'].map((key) => c.req('POST', path, body, { 'idempotency-key': key, 'if-match': '"1"' })));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await c.get(`/api/collections/${id}/state`)).json().entries[0].quantity).toBe(3);
    const replay = await c.req('POST', path, body, { 'idempotency-key': 'increment-a' });
    expect(replay.headers['x-mutation-replayed']).toBe('1');
    expect((await c.get(`/api/collections/${id}/state`)).json().entries[0].quantity).toBe(3);
    expect((await c.req('POST', path, { ...body, delta: 2 }, { 'idempotency-key': 'increment-a' })).statusCode).toBe(409);
  });
  it('rejects a stale absolute replacement and requires preconditions from old clients', async () => {
    const c = await setupOwner(s.app); const id = await personalId(c);
    const entries = [{ cardId: 'sv1-001', variant: 'normal', quantity: 1 }];
    expect((await c.put(`/api/collections/${id}/entries`, { entries })).statusCode).toBe(200);
    expect((await c.req('PUT', `/api/collections/${id}/entries`, { entries: [{ ...entries[0], quantity: 99 }] }, { 'if-match': '"0"' })).statusCode).toBe(409);
    expect((await c.req('PUT', `/api/collections/${id}/entries`, { entries }, { 'idempotency-key': '' })).statusCode).toBe(428);
    expect((await c.get(`/api/collections/${id}/state`)).json().entries[0].quantity).toBe(1);
  });
});
