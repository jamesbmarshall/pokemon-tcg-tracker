import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, invite, personalId, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

/** One set ("sv01", code "SVI") with two cards, served to both the sets list and set-cards queries. */
function stubCatalogue() {
  const svSet = { id: 'sv01', name: 'Scarlet & Violet', releaseDate: '2023-03-31', serie: { id: 'sv', name: 'Scarlet & Violet' }, cardCount: { official: 198, total: 198 }, abbreviation: { official: 'SVI' } };
  const svCards = [
    { id: 'sv01-125', localId: '125', name: 'Charizard ex' },
    { id: 'sv01-191', localId: '191', name: 'Rare Candy' },
  ];
  const priced: Record<string, unknown> = {
    'sv01-125': {
      id: 'sv01-125',
      localId: '125',
      name: 'Charizard ex',
      set: { id: 'sv01', name: 'Scarlet & Violet' },
      variants: { normal: true },
      pricing: { tcgplayer: { updated: '2026-10-01', normal: { marketPrice: 50 } } },
    },
    'sv01-191': {
      id: 'sv01-191',
      localId: '191',
      name: 'Rare Candy',
      set: { id: 'sv01', name: 'Scarlet & Violet' },
      variants: { normal: true },
      pricing: { tcgplayer: { updated: '2026-10-01', normal: { marketPrice: 0.25 } } },
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

describe('deck migration', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
    s = await startServer();
  });

  it('defaults a new list to kind list with no format', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Binder' })).json();
    expect(list.kind).toBe('list');
    expect(list.format).toBeUndefined();
    expect(list.cardQtys).toEqual({});
  });

  it('creates a deck with a format', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Charizard deck', kind: 'deck', format: 'standard' })).json();
    expect(list.kind).toBe('deck');
    expect(list.format).toBe('standard');
  });

  it('rejects a format on a plain list', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const res = await c.post(`/api/collections/${id}/lists`, { name: 'Binder', format: 'standard' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid kind or format', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    expect((await c.post(`/api/collections/${id}/lists`, { name: 'x', kind: 'bogus' })).statusCode).toBe(400);
    expect((await c.post(`/api/collections/${id}/lists`, { name: 'x', kind: 'deck', format: 'bogus' })).statusCode).toBe(400);
  });

  it('rejects a qty of 0 or 61, and accepts a valid qty', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Deck', kind: 'deck', format: 'standard' })).json();
    expect((await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`, { qty: 0 })).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`, { qty: 61 })).statusCode).toBe(400);
    expect((await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`, { qty: 4 })).statusCode).toBe(200);
  });
});

describe('PATCH /api/collections/:id/lists/:listId format', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
    s = await startServer();
  });

  it('updates the format on a deck', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Deck', kind: 'deck', format: 'standard' })).json();
    expect((await c.patch(`/api/collections/${id}/lists/${list.id}`, { format: 'expanded' })).statusCode).toBe(200);
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.lists.find((l: { id: string }) => l.id === list.id).format).toBe('expanded');
  });

  it('rejects a format on a plain list', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Binder' })).json();
    expect((await c.patch(`/api/collections/${id}/lists/${list.id}`, { format: 'standard' })).statusCode).toBe(400);
  });
});

describe('PUT /api/collections/:id/lists/:listId/cards/:cardId qty', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
    s = await startServer();
  });

  it('stores a qty, and updates (not duplicates) it on a second call', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Deck', kind: 'deck', format: 'standard' })).json();
    await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`, { qty: 2 });
    let st = (await c.get(`/api/collections/${id}/state`)).json();
    let l = st.lists.find((x: { id: string }) => x.id === list.id);
    expect(l.cards).toEqual(['sv1-001']);
    expect(l.cardQtys).toEqual({ 'sv1-001': 2 });

    await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`, { qty: 4 });
    st = (await c.get(`/api/collections/${id}/state`)).json();
    l = st.lists.find((x: { id: string }) => x.id === list.id);
    expect(l.cards).toEqual(['sv1-001']);
    expect(l.cardQtys).toEqual({ 'sv1-001': 4 });
  });

  it('defaults to qty 1 when absent, harmless on a plain list', async () => {
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const list = (await c.post(`/api/collections/${id}/lists`, { name: 'Binder' })).json();
    await c.put(`/api/collections/${id}/lists/${list.id}/cards/sv1-001`);
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    const l = st.lists.find((x: { id: string }) => x.id === list.id);
    expect(l.cardQtys).toEqual({ 'sv1-001': 1 });
  });
});

describe('POST /api/decks/resolve', () => {
  beforeEach(async () => {
    s = await startServer();
  });

  const DECK_TEXT = [
    'Pokémon: 1',
    '4 Charizard ex SVI 125',
    '',
    'Trainer: 1',
    '4 Rare Candy SVI 191',
    '',
    'Unknown: 1',
    '2 Mystery Card ZZZZ 999',
    '',
    'Total Cards: 10',
  ].join('\n');

  it('resolves known lines to full priced snapshots and reports unresolved lines', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    const res = await c.post('/api/decks/resolve', { text: DECK_TEXT });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCards).toBe(10);
    expect(body.resolved).toHaveLength(2);
    expect(body.unresolved).toHaveLength(1);
    expect(body.unresolved[0].raw).toBe('2 Mystery Card ZZZZ 999');

    const charizard = body.resolved.find((r: { card: { id: string } }) => r.card.id === 'sv01-125');
    expect(charizard.qty).toBe(4);
    expect(charizard.section).toBe('Pokémon');
    expect(charizard.card.prices.normal).toBe(50);

    const candy = body.resolved.find((r: { card: { id: string } }) => r.card.id === 'sv01-191');
    expect(candy.card.prices.normal).toBe(0.25);
  });

  it('rejects non-string or over-length text', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const c = await setupOwner(s.app);
    expect((await c.post('/api/decks/resolve', { text: 123 })).statusCode).toBe(400);
    expect((await c.post('/api/decks/resolve', { text: 'x'.repeat(20_001) })).statusCode).toBe(400);
  });

  it('requires a signed-in user', async () => {
    vi.stubGlobal('fetch', stubCatalogue());
    const anon = new Client(s.app);
    expect((await anon.post('/api/decks/resolve', { text: '4 Pikachu' })).statusCode).toBe(401);
  });
});

describe('deck legality settings', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
    s = await startServer();
  });

  it('returns defaults when unset', async () => {
    const c = await setupOwner(s.app);
    const res = await c.get('/api/decks/settings');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.regulationMarks).toEqual({ standard: ['H', 'I', 'J'], expanded: ['D', 'E', 'F', 'G', 'H', 'I', 'J'] });
    expect(body.bannedCardIds).toEqual([]);
  });

  it('lets an owner update the settings, reflected in GET', async () => {
    const c = await setupOwner(s.app);
    const put = await c.put('/api/admin/deck-settings', { regulationMarks: { standard: ['I', 'J'], expanded: ['H', 'I', 'J'] }, bannedCardIds: ['sv1-001'] });
    expect(put.statusCode).toBe(200);
    const get = (await c.get('/api/decks/settings')).json();
    expect(get.regulationMarks).toEqual({ standard: ['I', 'J'], expanded: ['H', 'I', 'J'] });
    expect(get.bannedCardIds).toEqual(['sv1-001']);
  });

  it('rejects a member from updating the settings', async () => {
    const owner = await setupOwner(s.app);
    const member = await invite(owner, s.app, 'misty', 'member');
    const res = await member.put('/api/admin/deck-settings', { bannedCardIds: ['sv1-001'] });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a bad mark format, too many marks and a bad card id', async () => {
    const c = await setupOwner(s.app);
    expect((await c.put('/api/admin/deck-settings', { regulationMarks: { standard: ['TOOLONG'], expanded: [] } })).statusCode).toBe(400);
    expect((await c.put('/api/admin/deck-settings', { regulationMarks: { standard: Array.from({ length: 21 }, (_, i) => `${i}`), expanded: [] } })).statusCode).toBe(400);
    expect((await c.put('/api/admin/deck-settings', { bannedCardIds: ['has space'] })).statusCode).toBe(400);
  });
});
