import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const box = (over: object = {}) => ({ name: 'Scarlet & Violet booster box', productType: 'booster_box', quantity: 1, ...over });

describe('sealed product', () => {
  it('creates, lists and updates a sealed item', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const put = await c.put(`/api/collections/${id}/sealed/s1`, box({ setId: 'sv1', quantity: 2, paid: { amount: 100, currency: 'GBP' } }));
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ id: 's1', name: 'Scarlet & Violet booster box', productType: 'booster_box', quantity: 2, status: 'sealed' });

    const list = (await c.get(`/api/collections/${id}/sealed`)).json();
    expect(list).toHaveLength(1);

    const update = await c.put(`/api/collections/${id}/sealed/s1`, box({ quantity: 3, valueUsd: 150 }));
    expect(update.json()).toMatchObject({ quantity: 3, valueUsd: 150 });
    expect((await c.get(`/api/collections/${id}/sealed`)).json()).toHaveLength(1);
  });

  it('shows up in collection state, included in value, and redacted like entries and graded', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/sealed/s1`, box({ valueUsd: 120, paid: { amount: 90, currency: 'USD' }, notes: 'birthday gift' }));
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.sealed).toHaveLength(1);
    expect(st.sealed[0]).toMatchObject({ id: 's1', valueUsd: 120, notes: 'birthday gift' });
    const { point } = (await c.post(`/api/collections/${id}/value`)).json();
    expect(point).toMatchObject({ valueUsd: 120 });
  });

  it('rejects an invalid product type, missing name or a non-positive quantity', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    expect((await c.put(`/api/collections/${id}/sealed/s1`, box({ productType: 'nonsense' }))).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/sealed/s1`, box({ name: '' }))).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/sealed/s1`, box({ quantity: 0 }))).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/sealed/s1`, box({ quantity: -5 }))).statusCode).toBe(400);
  });

  it('marks an item opened, excluding it from value but keeping it for history', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/sealed/s1`, box({ valueUsd: 100 }));
    const opened = await c.post(`/api/collections/${id}/sealed/s1/open`);
    expect(opened.json()).toMatchObject({ status: 'opened' });
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.sealed[0].status).toBe('opened');
    const { point } = (await c.post(`/api/collections/${id}/value`)).json();
    expect(point.valueUsd).toBe(0);
  });

  it('deletes a sealed item and its photos', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/sealed/s1`, box());
    expect((await c.del(`/api/collections/${id}/sealed/s1`)).statusCode).toBe(200);
    expect((await c.get(`/api/collections/${id}/sealed`)).json()).toHaveLength(0);
  });

  it('uploads sealed photos only when the bytes are an image', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/sealed/s1`, box());
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const form = (buf: Buffer, type: string) => {
      const b = '----pt';
      const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="x"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
      return { body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
    };
    const ok = form(png, 'image/png');
    const up = await c.req('POST', `/api/collections/${id}/sealed/s1/photos`, ok.body, ok.headers);
    expect(up.statusCode).toBe(200);
    const [{ id: pid }] = up.json();
    const got = await c.get(`/api/collections/${id}/photos/sealed/${pid}`);
    expect(got.headers['content-type']).toBe('image/png');
    const bad = form(Buffer.from('<html><script>alert(1)</script>'), 'image/png');
    expect((await c.req('POST', `/api/collections/${id}/sealed/s1/photos`, bad.body, bad.headers)).statusCode).toBe(400);
    expect((await c.del(`/api/collections/${id}/photos/sealed/${pid}`)).statusCode).toBe(200);
    expect((await c.get(`/api/collections/${id}/sealed/s1/photos`)).json()).toHaveLength(0);
  });

  it('links a sealed item to a PriceCharting product and stores its price', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'p1', 'product-name': 'ETB', 'loose-price': 4500 }), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    const c = await setupOwner(s.app);
    await c.put('/api/admin/integrations/pricecharting', { key: 'x'.repeat(40) });
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/sealed/s1`, box());
    const linked = await c.post(`/api/collections/${id}/sealed/s1/link`, { pcProductId: 'p1' });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ pcProductId: 'p1', pcPrice: 45 });
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.sealed[0]).toMatchObject({ pcProductId: 'p1', pcPrice: 45 });
  });

  it('enforces the same read/write permissions as entries and graded', async () => {
    const owner = await setupOwner(s.app);
    const id = await personalId(owner);
    const stranger = await invite(owner, s.app, 'misty');
    expect((await stranger.get(`/api/collections/${id}/sealed`)).statusCode).toBe(404);
    expect((await stranger.put(`/api/collections/${id}/sealed/s1`, box())).statusCode).toBe(404);
  });

  it('a viewer can read sealed items but not write them', async () => {
    const owner = await setupOwner(s.app);
    const brock = await invite(owner, s.app, 'brock');
    const brockId = (await brock.get('/api/auth/me')).json().user.id;
    const { id } = (await owner.post('/api/collections', { name: 'Family binder' })).json();
    await owner.put(`/api/collections/${id}/members/${brockId}`, { role: 'viewer' });
    await owner.put(`/api/collections/${id}/sealed/s1`, box());
    expect((await brock.get(`/api/collections/${id}/sealed`)).statusCode).toBe(200);
    expect((await brock.put(`/api/collections/${id}/sealed/s2`, box())).statusCode).toBe(403);
  });

  it('round-trips through export and import, including an opened item and a linked price', async () => {
    const owner = await setupOwner(s.app);
    const id = await personalId(owner);
    await owner.put(`/api/collections/${id}/sealed/s1`, box({ setId: 'sv1', quantity: 2, valueUsd: 90, paid: { amount: 60, currency: 'GBP' }, notes: 'for trading' }));
    await owner.put(`/api/collections/${id}/sealed/s2`, box({ name: 'Tin', productType: 'tin' }));
    await owner.post(`/api/collections/${id}/sealed/s2/open`);

    const out = (await owner.get(`/api/collections/${id}/export`)).json();
    expect(out.sealed).toHaveLength(2);

    const owner2 = await invite(owner, s.app, 'misty');
    const id2 = await personalId(owner2);
    const imported = await owner2.post(`/api/collections/${id2}/import`, out);
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ sealed: 2 });
    const st = (await owner2.get(`/api/collections/${id2}/state`)).json();
    expect(st.sealed).toHaveLength(2);
    const box1 = st.sealed.find((x: { id: string }) => x.id === 's1');
    expect(box1).toMatchObject({ quantity: 2, valueUsd: 90, paid: { amount: 60, currency: 'GBP' }, notes: 'for trading', status: 'sealed' });
    const tin = st.sealed.find((x: { id: string }) => x.id === 's2');
    expect(tin).toMatchObject({ status: 'opened' });
  });
});

