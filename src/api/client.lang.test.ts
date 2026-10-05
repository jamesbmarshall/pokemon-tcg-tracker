import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch, type Route } from '../test/fetchMock';
import { rawCard, rawSets } from '../test/fixtures';

type Client = typeof import('./client');
let api: Client;

beforeEach(async () => {
  vi.resetModules();
  api = await import('./client');
});

const jaSets = [
  { id: 'SV4a', name: 'シャイニートレジャーex', releaseDate: '2023-12-01', symbol: 'https://assets.tcgdex.net/univ/SV/SV4a/symbol', serie: { id: 'SV', name: 'スカーレット&バイオレット' }, cardCount: { official: 190, total: 320 } },
  { id: 'S8b', name: 'VMAXクライマックス', releaseDate: '2021-12-03', serie: { id: 'S', name: '剣と盾' }, cardCount: { official: 184, total: 278 } },
];
const enSetsRoute: Route = { match: /^\{ sets \{/, body: { data: { sets: rawSets } } };
const jaSetsRoute: Route = { match: '{ sets @locale(lang: "ja")', body: { data: { sets: jaSets } } };

describe('language-aware catalogue', () => {
  it('loads a language set list via the @locale directive and namespaces its ids', async () => {
    const fetch = mockFetch([jaSetsRoute]);
    const sets = await api.getSets('ja');
    expect(sets.map((s) => s.id)).toEqual(['ja:SV4a', 'ja:S8b']);
    expect(sets[0].images.symbol).toBe('https://assets.tcgdex.net/ja/SV/SV4a/symbol.png');
    expect(sets[0].ptcgoCode).toBeUndefined();
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).query).toContain('@locale(lang: "ja")');
  });

  it('fetches a namespaced card from that language and keeps the prefix', async () => {
    let url = '';
    mockFetch([
      jaSetsRoute,
      { match: '/v2/ja/cards/', reply: (r) => ((url = r.url), rawCard('SV4a-001', { name: 'ナゾノクサ', set: { id: 'SV4a', name: 'シャイニートレジャーex' } })) },
    ]);
    const card = await api.getCard('ja:SV4a-001');
    expect(url).toBe('https://api.tcgdex.net/v2/ja/cards/SV4a-001');
    expect(card.id).toBe('ja:SV4a-001');
    expect(card.name).toBe('ナゾノクサ');
    expect(card.set).toMatchObject({ id: 'ja:SV4a', releaseDate: '2023-12-01' });
    expect(api.toSnapshot(card).setId).toBe('ja:SV4a');
    expect(api.setIdFromCardId(card.id)).toBe('ja:SV4a');
    expect(api.legacyImageUrl(card.id)).toBeUndefined();
  });

  it('normalises localised types and categories on European cards', async () => {
    mockFetch([
      { match: '{ sets @locale(lang: "fr")', body: { data: { sets: [] } } },
      {
        match: '/v2/fr/cards/',
        body: rawCard('sv03-125', {
          category: 'Pokémon',
          types: ['Feu'],
          weaknesses: [{ type: 'Eau', value: '×2' }],
          attacks: [{ name: 'Flamme', cost: ['Feu', 'Incolore'], damage: 30 }],
          set: { id: 'sv03', name: 'Flammes Obsidiennes' },
        }),
      },
    ]);
    const card = await api.getCard('fr:sv03-125');
    expect(card.id).toBe('fr:sv03-125');
    expect(card.supertype).toBe('Pokémon');
    expect(card.types).toEqual(['Fire']);
    expect(card.weaknesses).toEqual([{ type: 'Water', value: '×2' }]);
    expect(card.attacks?.[0].cost).toEqual(['Fire', 'Colorless']);
    expect(card.set.id).toBe('fr:sv03');
  });

  it('loads a language set with raw ids in the filter', async () => {
    let query = '';
    mockFetch([
      { match: '/v2/ja/sets/SV4a', body: jaSets[0] },
      {
        match: 'cards(filters',
        reply: (r) => {
          query = r.query!;
          return { data: { cards: [rawCard('SV4a-002'), rawCard('SV4a-001'), rawCard('SV4a-1000')] } };
        },
      },
    ]);
    const cards = await api.getSetCards('ja:SV4a');
    expect(query).toContain('id: "SV4a-"');
    expect(query).toContain('@locale(lang: "ja")');
    expect(cards.map((c) => c.id)).toEqual(['ja:SV4a-001', 'ja:SV4a-002', 'ja:SV4a-1000']);
  });

  it('batches brief cards across languages with a directive per alias', async () => {
    let query = '';
    mockFetch([
      enSetsRoute,
      jaSetsRoute,
      { match: '/v2/en/cards', body: [{ id: 'sv03-125', localId: '125', name: 'Charizard ex' }] },
      { match: /^\{ cards\(filters: \{ name/, body: { data: { cards: [{ dexId: [6] }, { dexId: null }] } } },
      { match: /\/v2\/ja\/cards\?name=/, body: [] },
      {
        match: /\/v2\/ja\/cards\?dexId=eq%3A6/,
        body: [
          { id: 'SV4a-349', localId: '349', name: 'リザードンex' },
          { id: 'S8b-012', localId: '012', name: 'リザードンVMAX' },
          { id: 'XX-1', localId: '1', name: 'リザードンex' }, // unknown set: dropped
        ],
      },
      {
        match: 'c0: card(',
        reply: (r) => {
          query = r.query!;
          const ids = [...r.query!.matchAll(/(c\d+): card\(id: "([^"]+)"\)/g)];
          return { data: Object.fromEntries(ids.map(([, a, id]) => [a, rawCard(id)])) };
        },
      },
    ]);
    const res = await api.searchCards({ name: 'Charizard ex', langs: ['en', 'ja'] }, 1);
    expect(res.data.map((c) => c.id)).toEqual(['ja:SV4a-349', 'sv03-125']);
    expect(query).toMatch(/card\(id: "SV4a-349"\) @locale\(lang: "ja"\)/);
    expect(query).toMatch(/card\(id: "sv03-125"\) \{/);
  });

  it('finds every Japanese printing of a Pokémon when no mechanic is named', async () => {
    mockFetch([
      enSetsRoute,
      jaSetsRoute,
      { match: '/v2/en/cards', body: [] },
      { match: /^\{ cards\(filters: \{ name/, body: { data: { cards: [{ dexId: [6] }] } } },
      { match: /\/v2\/ja\/cards\?name=/, body: [] },
      {
        match: /\/v2\/ja\/cards\?dexId=eq%3A6/,
        body: [
          { id: 'SV4a-349', localId: '349', name: 'リザードンex' },
          { id: 'S8b-012', localId: '012', name: 'リザードンVMAX' },
        ],
      },
      { match: 'c0: card(', body: { data: {} } },
    ]);
    const res = await api.searchCards({ name: 'charizard', langs: ['ja'] }, 1);
    expect(res.totalCount).toBe(2);
  });

  it('searches a language directly by native name and maps filters into it', async () => {
    let url = '';
    mockFetch([
      { match: '{ sets @locale(lang: "fr")', body: { data: { sets: [{ ...rawSets[0] }] } } },
      { match: '/v2/fr/cards', reply: (r) => ((url = r.url), [{ id: 'sv03-125', localId: '125', name: 'Dracaufeu' }]) },
      { match: 'c0: card(', body: { data: {} } },
    ]);
    const res = await api.searchCards({ types: ['Fire'], supertype: 'Pokémon', langs: ['fr'] }, 1);
    const q = new URL(url).searchParams;
    expect(q.get('types')).toBe('Feu');
    expect(q.get('category')).toBe('Pokémon');
    expect(res.totalCount).toBe(1);
  });

  it('lists printings and rarities from the requested language', async () => {
    const urls: string[] = [];
    mockFetch([
      jaSetsRoute,
      { match: '/v2/ja/cards', reply: (r) => (urls.push(r.url), [{ id: 'SV4a-001', localId: '001', name: 'ナゾノクサ', image: 'i' }]) },
      { match: '/v2/ja/rarities', reply: (r) => (urls.push(r.url), json(['Common', 'One Diamond'])) },
    ]);
    const printings = await api.getPrintings('ナゾノクサ', 'ja');
    expect(printings).toEqual([{ id: 'ja:SV4a-001', name: 'ナゾノクサ', number: '001', image: 'i/low.webp', setName: 'シャイニートレジャーex', releaseDate: '2023-12-01' }]);
    expect(await api.getRarities('ja')).toEqual(['Common']);
    expect(urls).toHaveLength(2);
  });

  it('primes each language independently', async () => {
    const fetch = mockFetch([{ match: '/v2/ja/cards/', body: rawCard('SV4a-001', { set: { id: 'SV4a', name: 'x' } }) }]);
    api.primeSets([{ id: 'ja:SV4a', name: 'Primed', series: '', printedTotal: 1, total: 1, releaseDate: '2023-12-01', updatedAt: '', images: { logo: '', symbol: '' } }], 'ja');
    const card = await api.getCard('ja:SV4a-001');
    expect(card.set.name).toBe('Primed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
