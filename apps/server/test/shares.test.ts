import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, invite, personalId, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([{ id: 'sv1', name: 'Scarlet & Violet' }]), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  s = await startServer();
});
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

async function seeded() {
  const owner = await setupOwner(s.app);
  const id = await personalId(owner);
  const at = new Date().toISOString();
  await owner.put(`/api/collections/${id}/entries`, {
    entries: [
      { cardId: 'sv1-001', variant: 'normal', quantity: 1, paid: { amount: 50, currency: 'GBP' }, notes: 'secret', addedAt: at },
      { cardId: 'sv2-001', variant: 'normal', quantity: 1, addedAt: at },
    ],
  });
  await owner.put(`/api/collections/${id}/notes/sv1-001`, { text: 'private note' });
  await owner.put(`/api/collections/${id}/wishlist/sv3-001`);
  await owner.put(`/api/collections/${id}/graded/g1`, { cardId: 'sv1-001', variant: 'normal', company: 'PSA', grade: '10', valueUsd: 500, paid: { amount: 100, currency: 'USD' } });
  return { owner, id };
}

const tokenOf = (url: string) => url.split('/s/')[1];

describe('sharing', () => {
  it('public links are redacted on the server by default', async () => {
    const { owner, id } = await seeded();
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public' })).json();
    expect(share.url).toMatch(/\/s\/[\w-]{20,}$/);
    const anon = new Client(s.app);
    const res = await anon.get(`/api/public/${tokenOf(share.url)}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toContain('noindex');
    const body = res.json();
    expect(body.role).toBe('viewer');
    expect(body.entries).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('private note');
    expect(body.entries[0].paid).toBeUndefined();
    expect(body.graded[0].paid).toBeUndefined();
    expect(body.graded[0].valueUsd).toBe(500);
  });

  it('can hide value too', async () => {
    const { owner, id } = await seeded();
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'graded', audience: 'public', hideValue: true })).json();
    const body = (await new Client(s.app).get(`/api/public/${tokenOf(share.url)}`)).json();
    expect(body.entries).toHaveLength(0);
    expect(body.graded[0].valueUsd).toBeUndefined();
    expect(body.history).toEqual([]);
  });

  it('scopes a set share to that set only', async () => {
    const { owner, id } = await seeded();
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'set', target: 'sv1', audience: 'public' })).json();
    const body = (await new Client(s.app).get(`/api/public/${tokenOf(share.url)}`)).json();
    expect(body.entries.map((e: { cardId: string }) => e.cardId)).toEqual(['sv1-001']);
    expect(body.wishlist).toEqual([]);
  });

  it('wishlist shares expose nothing else', async () => {
    const { owner, id } = await seeded();
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'wishlist', audience: 'public' })).json();
    const body = (await new Client(s.app).get(`/api/public/${tokenOf(share.url)}`)).json();
    expect(body.wishlist.map((w: { cardId: string }) => w.cardId)).toEqual(['sv3-001']);
    expect(body.entries).toEqual([]);
    expect(body.graded).toEqual([]);
  });

  it('revoked and expired links stop working', async () => {
    const { owner, id } = await seeded();
    const a = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public' })).json();
    await owner.post(`/api/shares/${a.id}/revoke`);
    expect((await new Client(s.app).get(`/api/public/${tokenOf(a.url)}`)).statusCode).toBe(404);
    const b = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public', expiresInDays: 1 })).json();
    s.ctx.db.run('UPDATE shares SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), b.id);
    expect((await new Client(s.app).get(`/api/public/${tokenOf(b.url)}`)).statusCode).toBe(404);
  });

  it('user-targeted shares require the right signed-in user', async () => {
    const { owner, id } = await seeded();
    const misty = await invite(owner, s.app, 'misty');
    const brock = await invite(owner, s.app, 'brock');
    const mistyId = (await misty.get('/api/auth/me')).json().user.id;
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'users', userIds: [mistyId] })).json();
    const t = tokenOf(share.url);
    expect((await new Client(s.app).get(`/api/public/${t}`)).statusCode).toBe(401);
    expect((await brock.get(`/api/public/${t}`)).statusCode).toBe(404);
    expect((await misty.get(`/api/public/${t}`)).statusCode).toBe(200);
    expect((await misty.get('/api/shared-with-me')).json()).toHaveLength(1);
    expect((await brock.get('/api/shared-with-me')).json()).toHaveLength(0);
  });

  it('instance shares are visible to every signed-in user', async () => {
    const { owner, id } = await seeded();
    const brock = await invite(owner, s.app, 'brock');
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'instance' })).json();
    expect((await new Client(s.app).get(`/api/public/${tokenOf(share.url)}`)).statusCode).toBe(401);
    expect((await brock.get(`/api/public/${tokenOf(share.url)}`)).statusCode).toBe(200);
  });

  it("share visitors may use the catalogue proxy but not anyone's collections", async () => {
    const { owner, id } = await seeded();
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public' })).json();
    const anon = new Client(s.app);
    expect((await anon.get('/api/tcgdex/v2/en/sets')).statusCode).toBe(401);
    await anon.get(`/api/public/${tokenOf(share.url)}`);
    expect((await anon.get('/api/tcgdex/v2/en/sets')).statusCode).toBe(200);
    expect((await anon.get(`/api/collections/${id}/state`)).statusCode).toBe(401);
  });

  it('stores only a hash of the share token', async () => {
    const { owner, id } = await seeded();
    const share = (await owner.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public' })).json();
    const row = s.ctx.db.get<{ token_hash: string; token_enc: string }>('SELECT token_hash, token_enc FROM shares')!;
    expect(row.token_hash).not.toContain(tokenOf(share.url));
    expect(row.token_enc).not.toContain(tokenOf(share.url));
  });
});

describe('catalogue proxy', () => {
  it('caches upstream responses and only allows catalogue paths', async () => {
    const owner = await setupOwner(s.app);
    const f = vi.mocked(fetch);
    const first = await owner.get('/api/tcgdex/v2/en/sets');
    expect(first.json()).toEqual([{ id: 'sv1', name: 'Scarlet & Violet' }]);
    const calls = f.mock.calls.length;
    await owner.get('/api/tcgdex/v2/en/sets');
    expect(f.mock.calls.length).toBe(calls);
    expect((await owner.get('/api/tcgdex/v2/en/../../etc/passwd')).statusCode).not.toBe(200);
    expect((await owner.get('/api/tcgdex/v2/en/admin')).statusCode).toBe(400);
  });

  it('only proxies images from known card CDNs', async () => {
    const owner = await setupOwner(s.app);
    expect((await owner.get('/api/img?u=' + encodeURIComponent('http://169.254.169.254/latest'))).statusCode).toBe(400);
    expect((await owner.get('/api/img?u=' + encodeURIComponent('https://evil.example/x.png'))).statusCode).toBe(400);
  });
});
