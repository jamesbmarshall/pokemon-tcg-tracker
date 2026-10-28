import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardVariants, configureCatalog, getCardDetails, getSet, getSetCards, getSets, getSetCardsBrief, searchCards, SEARCH_OBSERVATION_TTL, type RawCard } from './catalog';
import { fromPokemon } from './tcg/pokemon';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('set catalogue', () => {
  it('loads sets without requesting the REST-only abbreviation field', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(query.includes('abbreviation')
        ? { errors: [{ message: 'Cannot query field "abbreviation" on type "Set".' }] }
        : { data: { sets: [{ id: 'sv01', name: 'Scarlet & Violet', cardCount: { official: 198, total: 258 } }] } }));
    }));

    const sets = await getSets();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ id: 'sv01', ptcgoCode: 'SVI', printedTotal: 198, total: 258 });
  });

  it('still uses official abbreviations from REST set details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'new-set', name: 'New set', abbreviation: { official: 'NEW' },
    }))));
    expect(await getSet('new-set')).toMatchObject({ ptcgoCode: 'NEW' });
  });

  it('fetches set cards with a bounded pool of twelve concurrent requests', async () => {
    const id = 'parallel-test';
    const cards = Array.from({ length: 24 }, (_, i) => ({
      id: `${id}-${i + 1}`,
      localId: String(i + 1),
      name: `Card ${i + 1}`,
      category: 'Pokemon',
      variants: { normal: true },
      set: { id, name: 'Parallel Test' },
    }));
    const set = { id, name: 'Parallel Test', releaseDate: '2026-10-01', cardCount: { official: cards.length, total: cards.length } };
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ data: { cards: cards.map(({ id: cardId }) => ({ id: cardId })) } });
      if (String(url).includes('/sets/')) return Response.json(set);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return Response.json(cards.find((card) => String(url).endsWith(`/cards/${card.id}`)));
    }));

    expect(await getSetCards(id)).toHaveLength(cards.length);
    expect(maxActive).toBe(12);
  });
});

describe('API-listed printings', () => {
  it.each(['swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'fr:swsh9tg', 'new-set'])('retains source records for %s without per-set deletion', (setId) => {
    expect(cardVariants({ id: `${setId}-TG23`, variants: ['holofoil', 'reverseHolofoil'] })).toEqual(['holofoil', 'reverseHolofoil']);
    expect(cardVariants({ id: `${setId}-TG23`, variants: [] })).toEqual([]);
  });
});

it('refreshes both cached empty matches and the set index before renewing search', async () => {
  let stage = 0;
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const set = { id: 'new-search-set', name: 'New', cardCount: { official: 1, total: 1 } };
  const raw = { id: 'new-search-set-001', localId: '001', name: 'Fresh', category: 'Pokemon', set: { id: set.id, name: 'New' } };
  const upstream = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { query } = JSON.parse(String(init.body));
      if (query.includes('sets {')) return Response.json({ data: { sets: stage === 1 ? [set] : [] } });
      return Response.json({ data: { c0: raw } });
    }
    if (String(url).includes('/cards')) return Response.json(stage === 0 ? [] : [raw]);
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', upstream);
  const filter = { name: 'fresh-search-regression' };
  expect((await searchCards(filter, 1, undefined, { refresh: true })).totalCount).toBe(0);
  stage = 1;
  // Ordinary paging reuses one matching observation; revalidation must bypass it.
  expect((await searchCards(filter, 1)).totalCount).toBe(0);
  clock += SEARCH_OBSERVATION_TTL;
  const refreshed = await searchCards(filter, 1, undefined, { refresh: true });
  expect(refreshed).toMatchObject({ totalCount: 1, data: [{ id: raw.id }] });
  stage = 2;
  clock += SEARCH_OBSERVATION_TTL;
  expect((await searchCards(filter, 1, undefined, { refresh: true })).totalCount).toBe(0);
  expect(upstream.mock.calls.filter(([, init]) => init?.body?.toString().includes('sets {'))).toHaveLength(3);
});

it('preserves separate detailed-printing price dates and product links through cache serialization', async () => {
  configureCatalog({ storage: null });
  const raw: RawCard = { id: 'price-source-001', localId: '001', name: 'Provenance', category: 'Pokemon', set: { id: 'price-source', name: 'Source' },
    variants_detailed: [
      { type: 'normal', pricing: { tcgplayer: { updated: '2026-01-01', normal: { marketPrice: 3, productId: 11 } }, cardmarket: { updated: '2026-01-02', trend: 2 } } },
      { type: 'holo', pricing: { tcgplayer: { updated: '2026-02-01', holofoil: { marketPrice: 7, productId: 22 } }, cardmarket: { updated: '2026-02-02', trend: 6 } } },
    ] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(raw)));
  const source = await getCardDetails(raw.id);
  const card = fromPokemon(JSON.parse(JSON.stringify(source)), '2026-03-01');
  expect(card.prices.normal).toEqual([
    { amount: 3, currency: 'USD', source: 'tcgplayer', at: '2026-01-01', url: 'https://www.tcgplayer.com/product/11' },
    { amount: 2, currency: 'EUR', source: 'cardmarket', at: '2026-01-02', url: expect.any(String) },
  ]);
  expect(card.prices.holofoil).toEqual([
    { amount: 7, currency: 'USD', source: 'tcgplayer', at: '2026-02-01', url: 'https://www.tcgplayer.com/product/22' },
    { amount: 6, currency: 'EUR', source: 'cardmarket', at: '2026-02-02', url: expect.any(String) },
  ]);
});

it('shares fresh matches across pages, rejects swapped hydration IDs and partial GraphQL sets', async () => {
  let swapped = false, errors = false;
  let clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const set = { id: 'paging-proof', name: 'Paging', cardCount: { official: 37, total: 37 } };
  const cards = Array.from({ length: 37 }, (_, i) => ({ id: `paging-proof-${i}`, localId: String(i), name: 'Proof', category: 'Pokemon', set }));
  const upstream = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    if (!init?.body) return Response.json(cards);
    const query = JSON.parse(String(init.body)).query as string;
    if (query.includes('sets {')) return Response.json({ data: { sets: [set] }, ...(errors ? { errors: [{ message: 'Partial result' }] } : {}) });
    const ids = [...query.matchAll(/c(\d+): card\(id: "([^"]+)"\)/g)];
    return Response.json({ data: Object.fromEntries(ids.map(([, alias, id]) => [`c${alias}`, swapped ? cards[1] : cards.find((card) => card.id === id)])) });
  });
  vi.stubGlobal('fetch', upstream);
  const query = { name: 'paging-proof' };
  expect((await searchCards(query, 1, undefined, { refresh: true })).data).toHaveLength(36);
  expect((await searchCards(query, 2, undefined, { refresh: true })).data).toHaveLength(1);
  expect(upstream.mock.calls.filter(([, init]) => init?.body?.toString().includes('sets {'))).toHaveLength(1);
  swapped = true;
  await expect(searchCards(query, 2, undefined, { refresh: true })).rejects.toThrow('requested card IDs');
  clock += SEARCH_OBSERVATION_TTL;
  errors = true;
  await expect(searchCards(query, 1, undefined, { refresh: true })).rejects.toThrow('Partial result');
});

it('rejects set listings missing advertised cards', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => init?.body
    ? Response.json({ data: { cards: [null] } })
    : Response.json({ id: 'incomplete-proof', name: 'Incomplete', cardCount: { official: 1, total: 1 } })));
  await expect(getSetCardsBrief('incomplete-proof', true)).rejects.toThrow('Incomplete set listing');
});


it.each([
  { id: 'wrong-set', name: 'Wrong', cardCount: { total: 0 } },
  { id: 'metadata-proof', name: 'Missing count' },
])('rejects invalid completeness metadata', async (metadata) => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => init?.body
    ? Response.json({ data: { cards: [] } }) : Response.json(metadata)));
  await expect(getSetCardsBrief('metadata-proof', true)).rejects.toThrow('Invalid set completeness metadata');
});

it('fresh detail reads bypass old raw cards without publishing an unchecked response', async () => {
  const saveRawCard = vi.fn();
  const raw = { id: 'fresh-proof-1', localId: '1', name: 'Fresh', category: 'Pokemon', set: { id: 'fresh-proof', name: 'Fresh' } };
  configureCatalog({ storage: { profile: () => undefined, rawCard: () => ({ ...raw, name: 'Old' }), saveRawCard } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(raw)));
  expect((await getCardDetails(raw.id, undefined, { fresh: true })).name).toBe('Fresh');
  expect(saveRawCard).not.toHaveBeenCalled();
});

it('retains a live set abbreviation when the GraphQL index is refreshed', async () => {
  const set = { id: 'live-code-proof', name: 'Live code', cardCount: { official: 1, total: 1 } };
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => init?.body
    ? Response.json({ data: { sets: [set] } }) : Response.json({ ...set, abbreviation: { official: 'LIVE' } })));
  await getSet(set.id);
  expect(await getSets()).toMatchObject([{ id: set.id, ptcgoCode: 'LIVE' }]);
});
