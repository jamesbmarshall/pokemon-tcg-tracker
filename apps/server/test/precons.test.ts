import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  startServer,
  setupOwner,
  personalId,
  Client,
  type TestServer,
} from './helpers.ts';
import type { ScryfallCard } from '@poketracker/shared/tcg/scryfall';
const leader: ScryfallCard = {
  id: '11111111-1111-4111-8111-111111111111',
  oracle_id: '21111111-1111-4111-8111-111111111111',
  name: 'Morska, Undersea Sleuth',
  lang: 'en',
  set: 'mkc',
  set_name: 'Murders at Karlov Manor Commander',
  collector_number: '3',
  games: ['paper'],
  finishes: ['foil'],
  type_line: 'Legendary Creature',
  color_identity: ['G'],
  colors: ['G'],
  legalities: { commander: 'legal' },
  cmc: 3,
};
const forest: ScryfallCard = {
  ...leader,
  id: '33333333-3333-4333-8333-333333333333',
  oracle_id: '23333333-3333-4333-8333-333333333333',
  name: 'Forest',
  collector_number: '10',
  finishes: ['nonfoil'],
  type_line: 'Basic Land — Forest',
};
const index = [
  {
    fileName: 'DeepClueSea_MKC',
    name: 'Deep Clue Sea',
    code: 'MKC',
    releaseDate: '2024-02-09',
    type: 'Commander Deck',
    source: 'https://magic.wizards.com/en/news/decklists/example',
  },
  {
    fileName: 'AnotherDeck_ABC',
    name: 'Another Deck',
    code: 'ABC',
    releaseDate: '2023-01-01',
    type: 'Commander Deck',
  },
  {
    fileName: 'ArenaDeck_XYZ',
    name: 'Arena Deck',
    code: 'XYZ',
    releaseDate: '2024-01-01',
    type: 'Arena Starter Deck',
  },
];
const row = (card: ScryfallCard, count: number) => ({
  name: card.name,
  count,
  setCode: 'MKC',
  number: card.collector_number,
  isFoil: card.finishes?.includes('foil'),
  finishes: card.finishes,
  identifiers: { scryfallId: card.id },
});
let s: TestServer, owner: Client, collection: string;
let rawDeck: {
  name: string;
  code: string;
  commander: ReturnType<typeof row>[];
  mainBoard: ReturnType<typeof row>[];
  displayCommander: ReturnType<typeof row>[];
  tokens: ReturnType<typeof row>[];
};
let upstreamCards: ScryfallCard[];
let fetchMock: MockInstance<typeof globalThis.fetch>;
beforeEach(async () => {
  s = await startServer();
  owner = await setupOwner(s.app);
  collection = await personalId(owner);
  rawDeck = {
    name: 'Deep Clue Sea',
    code: 'MKC',
    commander: [row(leader, 1)],
    mainBoard: [row(forest, 99)],
    displayCommander: [row(leader, 1)],
    tokens: [row(forest, 4)],
  };
  upstreamCards = [leader, forest];
  fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.endsWith('/DeckList.json'))
        return Response.json({ data: index });
      if (target.endsWith('/decks/DeepClueSea_MKC.json'))
        return Response.json({ data: rawDeck });
      if (target.endsWith('/cards/collection')) {
        const ids = (
          JSON.parse(String(init?.body)).identifiers as { id: string }[]
        ).map((i) => i.id);
        return Response.json({
          data: upstreamCards.filter((c) => ids.includes(c.id)),
        });
      }
      throw new Error(`Unexpected upstream ${target}`);
    });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await s.close();
});
const path = '/api/games/mtg/precons';
describe('preconstructed deck catalogue', () => {
  it('searches names, set codes and years case-insensitively and caches the index', async () => {
    expect(
      (await owner.get(`${path}?q=DEEP%20clue`))
        .json()
        .decks.map((d: { id: string }) => d.id),
    ).toEqual(['DeepClueSea_MKC']);
    expect((await owner.get(`${path}?q=mkc`)).json().decks).toHaveLength(1);
    expect((await owner.get(`${path}?q=2024`)).json().decks).toHaveLength(1);
    expect((await owner.get(`${path}?q=unknown`)).json().decks).toEqual([]);
    expect((await owner.get(path)).json().decks).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps commander zones and basic-land quantities and excludes display copies and tokens', async () => {
    const result = await owner.get(`${path}/DeepClueSea_MKC`);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      name: 'Deep Clue Sea',
      total: 100,
      format: 'commander',
      cards: [
        {
          name: leader.name,
          quantity: 1,
          zone: 'commander',
          finish: 'foil',
          providerId: leader.id,
        },
        { name: 'Forest', quantity: 99, zone: 'main', finish: 'nonfoil' },
      ],
    });
  });
  it('resolves exact printings in bulk and saves a deck without creating physical holdings', async () => {
    const resolved = (await owner.get(`${path}/DeepClueSea_MKC/cards`)).json();
    expect(resolved.unresolved).toEqual([]);
    expect(resolved.items).toEqual([
      { cardId: `mtg:${leader.id}`, quantity: 1, zone: 'commander' },
      { cardId: `mtg:${forest.id}`, quantity: 99, zone: 'main' },
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/cards/collection'),
      ),
    ).toHaveLength(1);
    const saved = await owner.put(
      `/api/collections/${collection}/games/mtg/records`,
      {
        records: [
          {
            kind: 'list',
            id: 'precon-copy',
            data: {
              id: 'precon-copy',
              game: 'mtg',
              kind: 'deck',
              format: 'commander',
              name: 'My Deep Clue Sea',
              items: resolved.items,
              addedAt: new Date().toISOString(),
            },
          },
        ],
      },
    );
    expect(saved.statusCode).toBe(200);
    const state = (
      await owner.get(`/api/collections/${collection}/games/mtg/state`)
    ).json();
    expect(
      state.lists[0].items.reduce(
        (n: number, i: { quantity: number }) => n + i.quantity,
        0,
      ),
    ).toBe(100);
    expect(state.entries).toEqual([]);
    expect(state.sealed).toEqual([]);
    await owner.get(`${path}/DeepClueSea_MKC/cards`);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/cards/collection'),
      ),
    ).toHaveLength(1);
  });
  it('splits a full deck into provider-supported batches of at most 75 identifiers', async () => {
    upstreamCards = [
      leader,
      ...Array.from({ length: 76 }, (_, i) => ({
        ...forest,
        id: `50000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`,
        name: `Card ${i}`,
      })),
    ];
    rawDeck.mainBoard = upstreamCards.slice(1).map((card) => row(card, 1));
    const result = (await owner.get(`${path}/DeepClueSea_MKC/cards`)).json();
    expect(result.unresolved).toEqual([]);
    expect(result.items).toHaveLength(77);
    const batches = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/cards/collection'))
      .map(([, init]) => JSON.parse(String(init?.body)).identifiers.length);
    expect(batches).toEqual([75, 2]);
  });
  it('reports missing printings rather than substituting another printing or silently losing cards', async () => {
    upstreamCards = [leader];
    const result = (await owner.get(`${path}/DeepClueSea_MKC/cards`)).json();
    expect(result.unresolved).toEqual([
      expect.objectContaining({ name: 'Forest', quantity: 99 }),
    ]);
    expect(result.items).toHaveLength(1);
    expect(
      (await owner.get(`/api/collections/${collection}/games/mtg/state`)).json()
        .lists,
    ).toEqual([]);
  });
  it('requires a session and rejects unsupported games and unlisted or unsafe filenames', async () => {
    expect((await new Client(s.app).get(path)).statusCode).toBe(401);
    expect((await owner.get('/api/games/pokemon/precons')).statusCode).toBe(
      404,
    );
    expect((await owner.get(`${path}/Unknown_ABC`)).statusCode).toBe(404);
    expect((await owner.get(`${path}/bad%2Fpath`)).statusCode).toBe(400);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/decks/')),
    ).toHaveLength(0);
  });
  it('uses a stale catalogue during an outage without caching the failure over good data', async () => {
    await owner.get(path);
    s.ctx.db.run(
      'UPDATE http_cache SET fetched_at = 0 WHERE key = ?',
      'mtgjson:DeckList.json',
    );
    fetchMock.mockResolvedValue(new Response('Unavailable', { status: 403 }));
    const result = await owner.get(`${path}?q=Deep`);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      stale: true,
      decks: [{ name: 'Deep Clue Sea' }],
    });
  });
});
