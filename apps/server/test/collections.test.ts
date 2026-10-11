import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSnapshots } from '../src/cards.ts';
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

const entry = (cardId: string, quantity = 1, extra: object = {}) => ({ cardId, variant: 'normal', quantity, addedAt: new Date().toISOString(), ...extra });

describe('collection data', () => {
  it('stores entries, wishlist, notes and graded copies and returns them in state', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    saveSnapshots(s.ctx.db, [snap('sv1-001'), snap('sv1-002')]);
    expect((await c.put(`/api/collections/${id}/entries`, { entries: [entry('sv1-001', 2, { paid: { amount: 5, currency: 'GBP' } })] })).statusCode).toBe(200);
    await c.put(`/api/collections/${id}/wishlist/sv1-002`);
    await c.put(`/api/collections/${id}/notes/sv1-001`, { text: 'Pulled at league night' });
    const g = await c.put(`/api/collections/${id}/graded/g1`, { cardId: 'sv1-001', variant: 'normal', company: 'PSA', grade: '10' });
    expect(g.statusCode).toBe(200);

    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.role).toBe('owner');
    expect(st.entries).toEqual([expect.objectContaining({ id: 'sv1-001::normal', quantity: 2, setId: 'sv1', paid: { amount: 5, currency: 'GBP' } })]);
    expect(st.wishlist.map((w: { cardId: string }) => w.cardId)).toEqual(['sv1-002']);
    expect(st.notes[0].text).toBe('Pulled at league night');
    expect(st.graded[0]).toMatchObject({ id: 'g1', company: 'PSA', grade: '10', countsTowardSet: true });
    expect(st.cards.map((x: CardSnapshot) => x.id).sort()).toEqual(['sv1-001', 'sv1-002']);
  });

  it('rejects invalid ids and quantities', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    expect((await c.put(`/api/collections/${id}/entries`, { entries: [entry('bad id/../x')] })).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/entries`, { entries: [entry('sv1-001', 0)] })).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/graded/g1`, { cardId: 'sv1-001', variant: 'normal', company: 'Nope', grade: '10' })).statusCode).toBe(400);
  });

  it('soft-deletes graded copies so they can be restored', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const copy = { cardId: 'sv1-001', variant: 'normal', company: 'BGS', grade: '9.5' };
    await c.put(`/api/collections/${id}/graded/g1`, copy);
    await c.del(`/api/collections/${id}/graded/g1`);
    expect((await c.get(`/api/collections/${id}/state`)).json().graded).toHaveLength(0);
    await c.put(`/api/collections/${id}/graded/g1`, copy);
    expect((await c.get(`/api/collections/${id}/state`)).json().graded).toHaveLength(1);
  });

  it('records a value point from server-side prices', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    saveSnapshots(s.ctx.db, [snap('sv1-001', { normal: 3 })]);
    await c.put(`/api/collections/${id}/entries`, { entries: [entry('sv1-001', 2)] });
    const { point } = (await c.post(`/api/collections/${id}/value`)).json();
    expect(point).toMatchObject({ valueUsd: 6, cards: 2, unique: 1 });
  });

  it('never lets an unpriced listing wipe stored prices', () => {
    saveSnapshots(s.ctx.db, [snap('sv1-001', { normal: 9 })]);
    saveSnapshots(s.ctx.db, [snap('sv1-001', {})]);
    const row = s.ctx.db.get<{ data: string }>('SELECT data FROM cards WHERE id = ?', 'sv1-001')!;
    expect(JSON.parse(row.data).prices).toEqual({ normal: 9 });
  });

  it('uploads graded photos only when the bytes are an image', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    await c.put(`/api/collections/${id}/graded/g1`, { cardId: 'sv1-001', variant: 'normal', company: 'PSA', grade: '10' });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const form = (buf: Buffer, type: string) => {
      const b = '----pt';
      const body = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="side"\r\n\r\nfront\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="x"\r\nContent-Type: ${type}\r\n\r\n`),
        buf,
        Buffer.from(`\r\n--${b}--\r\n`),
      ]);
      return { body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
    };
    const ok = form(png, 'image/png');
    const up = await c.req('POST', `/api/collections/${id}/graded/g1/photos`, ok.body, ok.headers);
    expect(up.statusCode).toBe(200);
    const [{ id: pid, side }] = up.json();
    expect(side).toBe('front');
    const got = await c.get(`/api/collections/${id}/photos/${pid}`);
    expect(got.headers['content-type']).toBe('image/png');
    const html = form(Buffer.from('<html><script>alert(1)</script>'), 'image/png');
    expect((await c.req('POST', `/api/collections/${id}/graded/g1/photos`, html.body, html.headers)).statusCode).toBe(400);
  });
});

describe('access control', () => {
  it("hides other users' personal collections, even from the owner", async () => {
    const owner = await setupOwner(s.app);
    const misty = await invite(owner, s.app, 'misty');
    const mistyId = await personalId(misty);
    expect((await owner.get(`/api/collections/${mistyId}/state`)).statusCode).toBe(404);
    expect((await owner.put(`/api/collections/${mistyId}/wishlist/sv1-001`)).statusCode).toBe(404);
  });

  it('gives shared-collection editors write access and viewers read-only access', async () => {
    const owner = await setupOwner(s.app);
    const misty = await invite(owner, s.app, 'misty');
    const brock = await invite(owner, s.app, 'brock');
    const mistyId = (await misty.get('/api/auth/me')).json().user.id;
    const brockId = (await brock.get('/api/auth/me')).json().user.id;
    const { id } = (await owner.post('/api/collections', { name: 'Family binder' })).json();
    await owner.put(`/api/collections/${id}/members/${mistyId}`, { role: 'editor' });
    await owner.put(`/api/collections/${id}/members/${brockId}`, { role: 'viewer' });

    expect((await misty.put(`/api/collections/${id}/entries`, { entries: [entry('sv1-001')] })).statusCode).toBe(200);
    expect((await brock.put(`/api/collections/${id}/entries`, { entries: [entry('sv1-002')] })).statusCode).toBe(403);
    expect((await brock.get(`/api/collections/${id}/state`)).json()).toMatchObject({ role: 'viewer', entries: [expect.objectContaining({ cardId: 'sv1-001' })] });
    // Members can't delete or re-share the collection.
    expect((await misty.del(`/api/collections/${id}`)).statusCode).toBe(403);
    expect((await misty.post('/api/shares', { collectionId: id, scope: 'collection', audience: 'public' })).statusCode).toBe(403);
    // Viewers can leave.
    expect((await brock.del(`/api/collections/${id}/members/${brockId}`)).statusCode).toBe(200);
    expect((await brock.get(`/api/collections/${id}/state`)).statusCode).toBe(404);
  });

  it("won't delete a personal collection", async () => {
    const c = await setupOwner(s.app);
    expect((await c.del(`/api/collections/${await personalId(c)}`)).statusCode).toBe(400);
  });
});

describe('import / export', () => {
  it('imports the current v3 export format and merges duplicate entries', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const file = {
      app: 'poketracker',
      version: 3,
      exportedAt: new Date().toISOString(),
      collection: [entry('sv1-001', 1), entry('sv1-001', 2), entry('sv1-003', 1, { condition: 'NM', paid: { amount: 1.5, currency: 'USD' } })],
      wishlist: [{ cardId: 'sv1-004', addedAt: new Date().toISOString() }],
      graded: [{ id: 'g9', cardId: 'sv1-001', variant: 'normal', company: 'CGC', grade: '9', addedAt: new Date().toISOString() }],
      notes: [{ cardId: 'sv1-003', text: 'Trade bait' }],
    };
    const res = await c.post(`/api/collections/${id}/import`, file);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ entries: 2, graded: 1, wishlist: 1, notes: 1, remapped: 0 });
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.entries.find((e: { cardId: string }) => e.cardId === 'sv1-001').quantity).toBe(3);

    const out = (await c.get(`/api/collections/${id}/export`)).json();
    expect(out).toMatchObject({ app: 'poketracker', version: 5 });
    expect(out.collection).toHaveLength(2);
    expect(out.graded[0].id).toBe('g9');
  });

  it('normalises junk the way the browser-only app did', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const res = await c.post(`/api/collections/${id}/import`, {
      collection: [
        { cardId: 'sv1-001', variant: 'normal', quantity: '3', condition: 'LP', notes: 'n', addedAt: '2024-01-01' },
        { cardId: 'sv1-002', variant: 'holofoil', quantity: 0 },
        { cardId: 'sv1-003', variant: 'normal', quantity: 2.7, paid: { amount: 'lots', currency: 'EUR' } },
        { cardId: 'sv1-004', variant: 'normal', paid: { amount: 4, currency: 'EUR' } },
        { cardId: 42, variant: 'normal' },
        null,
      ],
      wishlist: [{ cardId: 'sv1-010' }, { nope: true }],
      graded: [
        { cardId: 'sv1-001', variant: 'normal', company: 'CGC', grade: '9.5', valueUsd: -4 },
        { cardId: 'sv1-002', variant: 'normal', company: 'Nope', grade: '9' },
        { id: 'keep-id', cardId: 'sv1-003', variant: 'normal', company: 'PSA', grade: '10', countsTowardSet: false, paid: 'free' },
        null,
      ],
      notes: [{ cardId: 'sv1-001', text: ' Trade with Sam ' }, { cardId: 'x-1', text: '  ' }, { text: 'orphan' }, null],
    });
    expect(res.json()).toMatchObject({ entries: 4, graded: 2, wishlist: 1, notes: 1 });
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    const byId = Object.fromEntries(st.entries.map((e: { id: string }) => [e.id, e]));
    expect(byId['sv1-001::normal']).toMatchObject({ quantity: 3, condition: 'LP', notes: 'n', setId: 'sv1', addedAt: '2024-01-01T00:00:00.000Z' });
    expect(byId['sv1-002::holofoil'].quantity).toBe(1);
    expect(byId['sv1-003::normal'].quantity).toBe(2);
    expect(byId['sv1-003::normal'].paid).toBeUndefined();
    expect(byId['sv1-004::normal']).toMatchObject({ quantity: 1, paid: { amount: 4, currency: 'EUR' } });
    const cgc = st.graded.find((g: { company: string }) => g.company === 'CGC');
    expect(cgc).toMatchObject({ setId: 'sv1', countsTowardSet: true });
    expect(cgc.valueUsd).toBeUndefined();
    const kept = st.graded.find((g: { id: string }) => g.id === 'keep-id');
    expect(kept.countsTowardSet).toBe(false);
    expect(kept.paid).toBeUndefined();
    expect(st.notes).toEqual([expect.objectContaining({ cardId: 'sv1-001', text: 'Trade with Sam' })]);
  });

  it('accepts a bare array and notes- or wishlist-only files', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    expect((await c.post(`/api/collections/${id}/import`, [{ cardId: 'sv1-001', variant: 'normal' }])).json()).toMatchObject({ entries: 1 });
    expect((await c.post(`/api/collections/${id}/import`, { collection: [], wishlist: [{ cardId: 'sv1-009' }] })).json()).toMatchObject({ entries: 0, wishlist: 1 });
    expect((await c.post(`/api/collections/${id}/import`, { notes: [{ cardId: 'sv1-001', text: 'x' }] })).json()).toMatchObject({ notes: 1 });
  });

  it('rejects a file with nothing in it', async () => {
    const c = await setupOwner(s.app);
    expect((await c.post(`/api/collections/${await personalId(c)}/import`, { foo: 1 })).statusCode).toBe(400);
  });
});

describe('custom lists', () => {
  it('creates lists, adds and orders cards', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Trade binder' })).json();
    await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`);
    await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-002`);
    await c.patch(`/api/collections/${id}/lists/${list.id}`, { order: ['sv1-002', 'sv1-001'] });
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.lists).toEqual([expect.objectContaining({ name: 'Trade binder', cards: ['sv1-002', 'sv1-001'] })]);
  });
});

describe('set totals', () => {
  it('are counted on the server and ignore whatever the client claims', async () => {
    const cards = [1, 2, 3].map((n) => ({ id: `tt9-00${n}`, localId: String(n), name: `Card ${n}` }));
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(async (url) =>
      String(url).includes('graphql')
        ? Response.json({ data: { cards } })
        : Response.json({ id: 'tt9', name: 'Totals Test', cardCount: { total: 3, official: 3 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = await setupOwner(s.app);
    const res = await c.put('/api/set-stats/tt9', { masterTotal: 4999 });
    expect(res.statusCode).toBe(200);
    const total = res.json().masterTotal;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThan(4999);
    const id = await personalId(c);
    expect((await c.get(`/api/collections/${id}/state`)).json().setStats).toEqual([expect.objectContaining({ setId: 'tt9', masterTotal: total })]);

    // Within the cache window the stored figure is returned without asking TCGdex again. Only
    // this set's requests count: fetch is global, so a background hydrate of sv1 cards left over
    // from an earlier import test can land in this mock, which made a plain call count flaky.
    const setCalls = () => fetchMock.mock.calls.filter(([u, init]) => `${String(u)} ${String(init?.body ?? '')}`.includes('tt9')).length;
    const calls = setCalls();
    expect(calls).toBeGreaterThan(0);
    expect((await c.put('/api/set-stats/tt9', { masterTotal: 1 })).json().masterTotal).toBe(total);
    expect(setCalls()).toBe(calls);
  });

  it('rejects malformed set ids', async () => {
    const c = await setupOwner(s.app);
    expect((await c.put('/api/set-stats/' + encodeURIComponent('../../x'), {})).statusCode).toBe(400);
  });
});

describe('pricing a newly added card', () => {
  it('a hydrate request made while the background fetch is running waits for it', async () => {
    // A card id no other test touches: inFlight is module-level, so a background fetch left over
    // from an earlier test could otherwise be the one this request waits on.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/cards/sv2-077')) {
        await gate;
        return Response.json({
          id: 'sv2-077',
          localId: '77',
          name: 'Sprigatito',
          set: { id: 'sv02', name: 'Paldea Evolved' },
          variants: { normal: true },
          pricing: { tcgplayer: { updated: '2026-10-01', normal: { marketPrice: 4.5 } } },
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    // Adding the card starts a background fetch; the client asks for the priced card straight away.
    await c.put(`/api/collections/${id}/entries`, { entries: [{ cardId: 'sv2-077', variant: 'normal', quantity: 1, addedAt: new Date().toISOString() }] });
    const pending = c.post('/api/cards/hydrate', { ids: ['sv2-077'] });
    setTimeout(release, 50);
    const cards = (await pending).json();
    expect(cards).toHaveLength(1);
    expect(cards[0].prices.normal).toBe(4.5);
    // One fetch for the card, not two.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/cards/sv2-077'))).toHaveLength(1);
  });
});
