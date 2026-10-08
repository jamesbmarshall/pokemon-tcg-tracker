import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

/** One set ("sv01", code "SVI") with three cards, served to both the sets list and set-cards queries. */
function stubCatalogue() {
  const svSet = { id: 'sv01', name: 'Scarlet & Violet', releaseDate: '2023-03-31', serie: { id: 'sv', name: 'Scarlet & Violet' }, cardCount: { official: 198, total: 198 }, abbreviation: { official: 'SVI' } };
  const svCards = [
    { id: 'sv01-045', localId: '045', name: 'Sprigatito' },
    { id: 'sv01-123', localId: '123', name: 'Charmander' },
  ];
  const priced: Record<string, unknown> = {
    'sv01-045': {
      id: 'sv01-045',
      localId: '045',
      name: 'Sprigatito',
      set: { id: 'sv01', name: 'Scarlet & Violet' },
      variants: { normal: true },
      pricing: { tcgplayer: { updated: '2026-10-01', normal: { marketPrice: 1.5 } } },
    },
    'sv01-123': {
      id: 'sv01-123',
      localId: '123',
      name: 'Charmander',
      set: { id: 'sv01', name: 'Scarlet & Violet' },
      variants: { normal: true },
      pricing: { tcgplayer: { updated: '2026-10-01', normal: { marketPrice: 2.5 } } },
    },
  };
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/graphql')) {
      const body = JSON.parse(String(init?.body ?? '{}')).query as string;
      if (body.includes('sets')) return Response.json({ data: { sets: [svSet] } });
      if (body.includes('cards(filters')) return Response.json({ data: { cards: svCards } });
      return Response.json({ data: {} });
    }
    if (/\/sets\/sv01$/.test(u)) return Response.json(svSet);
    const match = /\/cards\/([a-z0-9-]+)$/.exec(u);
    if (match && priced[match[1]]) return Response.json(priced[match[1]]);
    return Response.json([]);
  });
}

describe('GET /api/cards/lookup', () => {
  beforeEach(async () => {
    s = await startServer();
  });

  it('finds a card by exact set code + number, fully priced', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    const res = await c.get('/api/cards/lookup?set=SVI&number=123');
    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('sv01-123');
    expect(candidates[0].prices.normal).toBe(2.5);
  });

  it('finds a card by number + printed total when no set code was read', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    const res = await c.get('/api/cards/lookup?number=45&total=198');
    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('sv01-045');
  });

  it('tolerates leading-zero differences between requested and printed numbers', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    // Card is stored as "045"; request the unpadded form.
    const res = await c.get('/api/cards/lookup?set=SVI&number=45');
    expect(res.json().candidates[0].id).toBe('sv01-045');

    // And the reverse: card stored unpadded-looking on the response, request padded.
    const res2 = await c.get('/api/cards/lookup?set=SVI&number=0123');
    expect(res2.json().candidates[0].id).toBe('sv01-123');
  });

  it('returns no candidates (not a 400) for an unknown or garbled set code', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    const res = await c.get('/api/cards/lookup?set=ZZZZ&number=123');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ candidates: [] });
  });

  it('rejects malformed or missing collector numbers', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    expect((await c.get('/api/cards/lookup?set=SVI')).statusCode).toBe(400);
    expect((await c.get('/api/cards/lookup?set=SVI&number=' + encodeURIComponent('12 3'))).statusCode).toBe(400);
    expect((await c.get('/api/cards/lookup?set=SVI&number=' + encodeURIComponent('12/3'))).statusCode).toBe(400);
  });

  it('requires a signed-in user', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const anon = new Client(s.app);
    expect((await anon.get('/api/cards/lookup?set=SVI&number=123')).statusCode).toBe(401);
  });
});
