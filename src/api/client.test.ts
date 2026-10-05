import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aliasesIn, json, mockFetch, type Route } from '../test/fetchMock';
import { makeCard, rawCard, rawSets } from '../test/fixtures';

type Client = typeof import('./client');
let api: Client;

// client.ts keeps a set index and search cache in module state, so load a fresh copy per test.
beforeEach(async () => {
  vi.resetModules();
  api = await import('./client');
});

const setsRoute: Route = { match: '{ sets {', body: { data: { sets: rawSets } } };
const detail = (over: Record<string, unknown> = {}) => rawCard('sv03-125', { set: { id: 'sv03', name: 'Obsidian Flames' }, ...over });

describe('pure helpers', () => {
  it('setIdFromCardId keeps dotted and hyphenated set ids', () => {
    expect(api.setIdFromCardId('sv03.5-006')).toBe('sv03.5');
    expect(api.setIdFromCardId('2021swsh-1')).toBe('2021swsh');
    expect(api.setIdFromCardId('me01-TG01')).toBe('me01');
  });

  it('compareCardNumber sorts numerically', () => {
    const list = ['10', '2', '1', 'TG1'].map((number) => ({ number }));
    expect(list.sort(api.compareCardNumber).map((c) => c.number)).toEqual(['1', '2', '10', 'TG1']);
  });

  it('cardVariants defaults to normal', () => {
    expect(api.cardVariants({ variants: [] })).toEqual(['normal']);
    expect(api.cardVariants({ variants: ['holofoil'] })).toEqual(['holofoil']);
  });

  it('legacyImageUrl maps back to pokemontcg.io', () => {
    expect(api.legacyImageUrl('sv03.5-006')).toBe('https://images.pokemontcg.io/sv3pt5/6.png');
    expect(api.legacyImageUrl('sv03.5-006', true)).toBe('https://images.pokemontcg.io/sv3pt5/6_hires.png');
    expect(api.legacyImageUrl('swsh9-TG01')).toMatch(/\/TG01\.png$/);
    expect(api.legacyImageUrl('nope-1')).toBeUndefined();
  });
});

describe('usdPrices', () => {
  it('prefers TCGplayer market, then mid, then low', () => {
    const out = api.usdPrices({
      variants: ['normal', 'holofoil', 'reverseHolofoil'],
      tcgplayer: { url: '', updatedAt: '', prices: { normal: { market: 1.5, mid: 9 }, holofoil: { mid: 3 }, reverseHolofoil: { low: 0.5 } } },
    });
    expect(out).toEqual({ normal: 1.5, holofoil: 3, reverseHolofoil: 0.5 });
  });

  it('includes TCGplayer-only variants', () => {
    const out = api.usdPrices({ variants: ['normal'], tcgplayer: { url: '', updatedAt: '', prices: { '1stEditionNormal': { market: 40 } } } });
    expect(out['1stEditionNormal']).toBe(40);
  });

  it('converts Cardmarket EUR using the cached rate, else 0.89', () => {
    const card = { variants: ['normal'], cardmarket: { url: '', updatedAt: '', prices: { normal: { market: 8.9 } } } };
    expect(api.usdPrices(card).normal).toBe(10);
    localStorage.setItem('poketracker-fx', JSON.stringify({ rates: { EUR: 0.5 } }));
    expect(api.usdPrices(card).normal).toBe(17.8);
    localStorage.setItem('poketracker-fx', '{bad json');
    expect(api.usdPrices(card).normal).toBe(10);
  });

  it('returns nothing when there are no prices', () => {
    expect(api.usdPrices({ variants: ['normal'] })).toEqual({});
  });
});

describe('toSnapshot', () => {
  it('flattens a card and only keeps prices for detailed cards', () => {
    const s = api.toSnapshot(makeCard());
    expect(s).toMatchObject({ id: 'sv03-001', setId: 'sv03', setName: 'Obsidian Flames', printedTotal: 197, prices: { normal: 1, reverseHolofoil: 2 }, tcgplayerUrl: 'https://www.tcgplayer.com/product/1' });
    expect(Date.parse(s.syncedAt)).not.toBeNaN();
    expect(api.toSnapshot(makeCard({ detailed: false })).prices).toEqual({});
    expect(api.toSnapshot(makeCard({ variants: [], tcgplayer: { url: '', updatedAt: '', prices: {} } })).tcgplayerUrl).toBeUndefined();
  });
});

describe('getSets', () => {
  it('drops Pocket and empty sets, sorts newest first and builds asset URLs', async () => {
    const fetch = mockFetch([setsRoute]);
    const sets = await api.getSets();
    expect(sets.map((s) => s.id)).toEqual(['sv03.5', 'sv03', 'base1']);
    const obf = sets[1];
    expect(obf).toMatchObject({ name: 'Obsidian Flames', series: 'Scarlet & Violet', printedTotal: 197, total: 230, ptcgoCode: 'OBF' });
    expect(obf.images.logo).toBe('https://assets.tcgdex.net/en/sv/sv03/logo.webp');
    expect(obf.images.symbol).toBe('https://assets.tcgdex.net/en/sv/sv03/symbol.png');
    expect(sets[2].images).toEqual({ logo: '', symbol: '' });
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe('POST');
  });

  it('dedupes concurrent requests', async () => {
    const fetch = mockFetch([setsRoute]);
    await Promise.all([api.getSets(), api.getSets()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces GraphQL errors', async () => {
    mockFetch([{ match: '{ sets {', body: { errors: [{ message: 'Bad query' }] } }]);
    await expect(api.getSets()).rejects.toThrow('Bad query');
    mockFetch([{ match: '{ sets {', body: {} }]);
    await expect(api.getSets()).rejects.toThrow('Card API error');
  });
});

describe('transport errors', () => {
  it('maps 404 to a friendly message without retrying', async () => {
    const fetch = mockFetch([{ match: '/cards/x-1', status: 404, body: {} }, setsRoute]);
    await expect(api.getCard('x-1')).rejects.toThrow('Not found in the card database');
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/cards/x-1'))).toHaveLength(1);
  });

  it('reports other client errors with their status', async () => {
    mockFetch([{ match: '/rarities', status: 400, body: {} }]);
    await expect(api.getRarities()).rejects.toThrow('Card API error 400');
  });

  it('retries 5xx and 429 with backoff, then succeeds', async () => {
    vi.useFakeTimers();
    let n = 0;
    mockFetch([{ match: '/rarities', reply: () => (++n < 3 ? json({}, n === 1 ? 503 : 429) : json(['Common'])) }]);
    const p = api.getRarities();
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual(['Common']);
    expect(n).toBe(3);
  });

  it('gives up after three retries', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch([{ match: '/rarities', status: 429, body: {} }]);
    const p = api.getRarities();
    const assertion = expect(p).rejects.toThrow('Rate limited');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('retries network errors and rethrows the last one', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch([{ match: '/rarities', networkError: true }]);
    const p = api.getRarities();
    const assertion = expect(p).rejects.toThrow('Failed to fetch');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not retry an aborted request', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetch = mockFetch([{ match: '/cards', networkError: true }]);
    await expect(api.rest('/cards', {}, ctrl.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('getCard', () => {
  it('maps a detailed card with text, prices and set info', async () => {
    mockFetch([
      setsRoute,
      {
        match: '/cards/sv03-125',
        body: detail({
          name: 'Charizard ex',
          rarity: 'Double rare',
          illustrator: 'PLANETA',
          hp: 330,
          stage: 'Stage2',
          suffix: 'EX',
          evolveFrom: 'Charmeleon',
          description: 'Flavour',
          dexId: [6],
          regulationMark: 'G',
          retreat: 2,
          abilities: [{ name: 'Infernal Reign', effect: 'Attach energy' }],
          attacks: [{ name: 'Burning Darkness', cost: ['Fire', 'Fire'], damage: 180, effect: 'More' }, { name: 'Tap' }],
          weaknesses: [{ type: 'Water', value: '×2' }],
          resistances: [{ type: 'Grass' }],
          variants: { normal: false, reverse: false, holo: true },
          pricing: {
            tcgplayer: { updated: '2025-01-01', holofoil: { productId: 42, marketPrice: 30, lowPrice: 20, midPrice: 25, highPrice: 50, directLowPrice: 0 } },
            cardmarket: { updated: '2025-01-02', avg: 20, low: 15, trend: 22, 'avg-holo': 0 },
          },
        }),
      },
    ]);
    const card = await api.getCard('sv03-125');
    expect(card).toMatchObject({
      id: 'sv03-125',
      name: 'Charizard ex',
      supertype: 'Pokémon',
      subtypes: ['Stage2', 'EX'],
      hp: '330',
      evolvesFrom: 'Charmeleon',
      flavorText: 'Flavour',
      artist: 'PLANETA',
      number: '125',
      regulationMark: 'G',
      nationalPokedexNumbers: [6],
      retreatCost: ['Colorless', 'Colorless'],
      variants: ['holofoil'],
      detailed: true,
      images: { small: 'https://assets.tcgdex.net/en/sv/sv03/125/low.webp', large: 'https://assets.tcgdex.net/en/sv/sv03/125/high.webp' },
    });
    expect(card.set).toMatchObject({ id: 'sv03', releaseDate: '2023-08-11', ptcgoCode: 'OBF' });
    expect(card.abilities).toEqual([{ name: 'Infernal Reign', text: 'Attach energy', type: 'Ability' }]);
    expect(card.attacks?.[0]).toEqual({ name: 'Burning Darkness', cost: ['Fire', 'Fire'], convertedEnergyCost: 2, damage: '180', text: 'More' });
    expect(card.attacks?.[1]).toMatchObject({ cost: [], damage: '', text: '' });
    expect(card.resistances).toEqual([{ type: 'Grass', value: '' }]);
    expect(card.tcgplayer).toEqual({
      url: 'https://www.tcgplayer.com/product/42',
      updatedAt: '2025-01-01',
      prices: { holofoil: { low: 20, mid: 25, high: 50, market: 30, directLow: undefined } },
    });
    // Holo-only card: the base Cardmarket price applies to the holo itself.
    expect(card.cardmarket?.prices).toEqual({ holofoil: { low: 15, mid: 20, market: 22 } });
    expect(card.cardmarket?.url).toContain('searchString=Charizard%20ex');
  });

  it('maps trainers, rules and rarity "None"', async () => {
    mockFetch([setsRoute, { match: '/cards/sv03-190', body: rawCard('sv03-190', { category: 'Trainer', trainerType: 'Item', stage: undefined, effect: 'Draw 2', description: 'x', rarity: 'None', hp: undefined }) }]);
    const card = await api.getCard('sv03-190');
    expect(card).toMatchObject({ supertype: 'Trainer', subtypes: ['Item'], rules: ['Draw 2'], rarity: undefined, flavorText: undefined, hp: undefined });
  });

  it('still maps the card when the set list fails, using the brief set', async () => {
    mockFetch([{ match: '{ sets {', status: 400, body: {} }, { match: '/cards/zz-1', body: rawCard('zz-1', { set: { id: 'zz', name: 'Mystery', cardCount: { official: 10 } } }) }]);
    const card = await api.getCard('zz-1');
    expect(card.set).toMatchObject({ id: 'zz', name: 'Mystery', printedTotal: 10 });
  });

  it('normalises TCGplayer keys and aliases', async () => {
    mockFetch([
      setsRoute,
      {
        match: '/cards/base1-4',
        body: rawCard('base1-4', {
          variants: { holo: true, firstEdition: true },
          pricing: {
            tcgplayer: {
              updated: 'u',
              unit: 'USD',
              '1st-edition-holofoil': { marketPrice: 9000 },
              'unlimited-holofoil': { marketPrice: 400 },
              unlimited: { marketPrice: 5 },
              '1st-edition': { marketPrice: 7 },
              'reverse-holofoil': { lowPrice: 0 },
            },
          },
        }),
      },
    ]);
    const card = await api.getCard('base1-4');
    expect(card.variants).toEqual(['holofoil', '1stEditionHolofoil']);
    expect(Object.keys(card.tcgplayer!.prices).sort()).toEqual(['1stEditionHolofoil', '1stEditionNormal', 'holofoil', 'normal']);
    expect(card.tcgplayer!.url).toBe('');
  });

  it('drops empty price sources', async () => {
    mockFetch([setsRoute, { match: '/cards/sv03-001', body: rawCard('sv03-001', { pricing: { tcgplayer: { updated: 'x', normal: { marketPrice: null } }, cardmarket: { avg: 0 } } }) }]);
    const card = await api.getCard('sv03-001');
    expect(card.tcgplayer).toBeUndefined();
    expect(card.cardmarket).toBeUndefined();
  });

  it('maps Cardmarket holo prices onto foil variants when a non-foil exists', async () => {
    mockFetch([setsRoute, { match: '/cards/sv03-001', body: rawCard('sv03-001', { pricing: { cardmarket: { avg: 0.2, trend: 0.1, 'avg-holo': 1, 'low-holo': 0.5 } } }) }]);
    const card = await api.getCard('sv03-001');
    expect(card.cardmarket!.prices).toEqual({ normal: { low: undefined, mid: 0.2, market: 0.1 }, reverseHolofoil: { low: 0.5, mid: 1, market: 1 } });
  });

  it('gives a holo-only card a reverse price from the holo column', async () => {
    mockFetch([setsRoute, { match: '/cards/sv03-002', body: rawCard('sv03-002', { variants: { holo: true, reverse: true }, pricing: { cardmarket: { trend: 3, 'trend-holo': 4 } } }) }]);
    const card = await api.getCard('sv03-002');
    expect(card.cardmarket!.prices.holofoil.market).toBe(3);
    expect(card.cardmarket!.prices.reverseHolofoil.market).toBe(4);
  });
});

describe('variant mapping', () => {
  const variantsOf = async (variants: unknown, rarity = 'Common') => {
    mockFetch([setsRoute, { match: '/cards/sv03-001', body: rawCard('sv03-001', { variants, rarity }) }]);
    return (await api.getCard('sv03-001')).variants;
  };
  it.each([
    [{ normal: true, reverse: true }, 'Common', ['normal', 'reverseHolofoil']],
    [{ firstEdition: true, normal: true }, 'Common', ['normal', '1stEditionNormal']],
    [{ firstEdition: true }, 'Common', ['1stEditionNormal']],
    [{ wPromo: true, holo: true }, 'Common', ['holofoil', 'wPromo']],
    [undefined, 'Rare Holo', ['holofoil']],
    [{}, 'Special illustration rare', ['holofoil']],
    [{}, 'Common', ['normal']],
  ])('%o (%s) → %o', async (v, rarity, expected) => {
    expect(await variantsOf(v, rarity)).toEqual(expected);
  });
});

describe('getCardsByIds', () => {
  it('skips cards that fail', async () => {
    mockFetch([setsRoute, { match: '/cards/sv03-001', body: rawCard('sv03-001') }, { match: '/cards/sv03-002', status: 404 }]);
    const cards = await api.getCardsByIds(['sv03-001', 'sv03-002']);
    expect(cards.map((c) => c.id)).toEqual(['sv03-001']);
  });

  it('returns [] when every card is simply missing', async () => {
    mockFetch([setsRoute]);
    await expect(api.getCardsByIds(['a-1', 'b-2'])).resolves.toEqual([]);
  });

  it('throws when every card fails for another reason', async () => {
    mockFetch([setsRoute, { match: '/cards/', status: 400 }]);
    await expect(api.getCardsByIds(['a-1'])).rejects.toThrow('Card API error 400');
  });

  it('handles an empty list', async () => {
    mockFetch([setsRoute]);
    await expect(api.getCardsByIds([])).resolves.toEqual([]);
  });
});

describe('getSetCards', () => {
  it('pages through GraphQL, keeps only exact set matches and sorts by number', async () => {
    const page1 = Array.from({ length: 250 }, (_, i) => rawCard(`sv03-${String(i + 1).padStart(3, '0')}`));
    const fetch = mockFetch([
      { match: '/sets/sv03', body: rawSets[0] },
      {
        match: 'cards(filters',
        reply: ({ query }) => ({ data: { cards: query!.includes('page: 1,') ? [...page1].reverse() : [rawCard('sv03-251'), rawCard('sv03.5-001')] } }),
      },
    ]);
    const cards = await api.getSetCards('sv03');
    expect(cards).toHaveLength(251);
    expect(cards[0].id).toBe('sv03-001');
    expect(cards.at(-1)!.id).toBe('sv03-251');
    expect(cards[0].set.printedTotal).toBe(197);
    expect(cards[0].detailed).toBe(false);
    expect(cards[0].tcgplayer).toBeUndefined();
    expect(fetch.mock.calls.filter(([, i]) => String(i?.body).includes('cards(filters'))).toHaveLength(2);
  });

  it('getSet updates the set index used by later cards', async () => {
    mockFetch([{ match: '/sets/sv03', body: { ...rawSets[0], name: 'Renamed' } }]);
    expect((await api.getSet('sv03')).name).toBe('Renamed');
  });
});

describe('search', () => {
  const list = [
    { id: 'base1-58', localId: '58', name: 'Pikachu', image: 'i' },
    { id: 'sv03.5-025', localId: '025', name: 'Pikachu', image: 'i' },
    { id: 'sv03-062', localId: '062', name: 'Pikachu ex' },
    { id: 'A1-094', localId: '094', name: 'Pikachu' }, // Pocket: not a physical set
  ];
  const searchRoutes = (onList?: (url: string) => void): Route[] => [
    setsRoute,
    {
      match: /\/v2\/en\/cards\?|\/v2\/en\/cards$/,
      reply: ({ url }) => {
        onList?.(url);
        return list;
      },
    },
    { match: 'c0: card(', reply: ({ query }) => ({ data: Object.fromEntries(aliasesIn(query!).map(([a, id]) => [a, id === 'sv03-062' ? null : rawCard(id)])) }) },
  ];

  it('builds query params, excludes Pocket and sorts newest first', async () => {
    let url = '';
    mockFetch(searchRoutes((u) => (url = u)));
    const res = await api.searchCards({ name: 'pika', types: ['Lightning', 'Fire'], supertype: 'Pokémon', rarity: 'Common', artist: 'Mitsuhiro' }, 1);
    const q = new URL(url).searchParams;
    expect(q.get('name')).toBe('pika');
    expect(q.get('types')).toBe('Lightning|Fire');
    expect(q.get('category')).toBe('Pokemon');
    expect(q.get('rarity')).toBe('eq:Common');
    expect(q.get('illustrator')).toBe('Mitsuhiro');
    expect(res.totalCount).toBe(3);
    expect(res.pageSize).toBe(36);
    // sv03-062 resolved to null in the batch and is skipped
    expect(res.data.map((c) => c.id)).toEqual(['sv03.5-025', 'base1-58']);
  });

  it('sorts oldest first, by name, and filters to a set', async () => {
    mockFetch(searchRoutes());
    expect((await api.searchCards({ sort: 'oldest' }, 1)).data[0].id).toBe('base1-58');
    expect((await api.searchCards({ sort: 'name' }, 1)).data.map((c) => c.id)).toEqual(['sv03.5-025', 'base1-58']);
    expect((await api.searchCards({ setId: 'base1' }, 1)).totalCount).toBe(1);
  });

  it('caches matches so paging does not refetch the list', async () => {
    let calls = 0;
    mockFetch(searchRoutes(() => calls++));
    await api.searchCards({ name: 'pika' }, 1);
    const page2 = await api.searchCards({ name: 'pika' }, 2);
    expect(calls).toBe(1);
    expect(page2.data).toEqual([]);
    expect(page2.page).toBe(2);
  });

  it('drops failed queries from the cache so they can be retried', async () => {
    mockFetch([setsRoute, { match: /\/cards\?/, status: 400 }]);
    await expect(api.searchCards({ name: 'x' }, 1)).rejects.toThrow();
    mockFetch(searchRoutes());
    await expect(api.searchCards({ name: 'x' }, 1)).resolves.toMatchObject({ totalCount: 3 });
  });

  it('getPrintings lists physical printings newest first', async () => {
    let url = '';
    mockFetch(searchRoutes((u) => (url = u)));
    const out = await api.getPrintings('Pikachu');
    expect(new URL(url).searchParams.get('name')).toBe('eq:Pikachu');
    expect(out.map((p) => p.id)).toEqual(['sv03.5-025', 'sv03-062', 'base1-58']);
    expect(out[0]).toEqual({ id: 'sv03.5-025', name: 'Pikachu', number: '025', image: 'i/low.webp', setName: '151', releaseDate: '2023-09-22' });
    expect(out[1].image).toBe('');
  });

  it('getRarities hides TCG Pocket rarities', async () => {
    mockFetch([{ match: '/rarities', body: ['Common', 'One Diamond', 'Three Star', 'Crown', 'None', 'Rare Holo', 'Two Shiny'] }]);
    expect(await api.getRarities()).toEqual(['Common', 'Rare Holo']);
  });

  it('primeSets seeds the index so no set request is needed', async () => {
    const fetch = mockFetch([{ match: '/rarities', body: [] }, ...searchRoutes().slice(1)]);
    api.primeSets([{ id: 'base1', name: 'Base Set', series: 'Base', printedTotal: 102, total: 102, releaseDate: '1999-01-09', updatedAt: '', images: { logo: '', symbol: '' } }]);
    const res = await api.searchCards({ name: 'pika' }, 1);
    expect(res.totalCount).toBe(1);
    expect(fetch.mock.calls.some(([, i]) => String(i?.body).includes('{ sets {'))).toBe(false);
    api.primeSets(undefined);
    api.primeSets([]);
  });
});
