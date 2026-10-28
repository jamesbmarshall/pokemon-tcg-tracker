import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardVariants, configureCatalog, getCardDetails, getSet, getSetCards, getSets, searchCards, type RawCard } from './catalog';
import { fromPokemon } from './tcg/pokemon';

afterEach(() => vi.unstubAllGlobals());

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
  const refreshed = await searchCards(filter, 1, undefined, { refresh: true });
  expect(refreshed).toMatchObject({ totalCount: 1, data: [{ id: raw.id }] });
  stage = 2;
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
