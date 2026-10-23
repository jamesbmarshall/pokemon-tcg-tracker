import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startServer,
  setupOwner,
  personalId,
  invite,
  Client,
  type TestServer,
} from './helpers.ts';
import { fromScryfall } from '@poketracker/shared/tcg/scryfall';
import { saveGameCards } from '../src/tcg/provider.ts';
import { gameState } from '../src/tcg/state.ts';
import { jsonObjects } from '../src/tcg/jobs.ts';
import { reconcilePhotos } from '../src/photoStorage.ts';
const card = fromScryfall({
  id: '11111111-1111-4111-8111-111111111111',
  oracle_id: '22222222-2222-4222-8222-222222222222',
  name: 'Leader',
  lang: 'en',
  set: 'tst',
  set_name: 'Test',
  collector_number: '001a',
  games: ['paper'],
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '3.50', usd_foil: '8' },
  type_line: 'Legendary Creature — Elf',
  color_identity: ['G'],
  colors: ['G'],
  legalities: { commander: 'legal' },
  keywords: [],
  cmc: 3,
  oracle_text: 'Partner',
  image_uris: { normal: 'https://cards.scryfall.io/normal/front/1/1/test.jpg' },
});
let s: TestServer, owner: Client, id: string;
beforeEach(async () => {
  s = await startServer();
  owner = await setupOwner(s.app);
  id = await personalId(owner);
  saveGameCards(s.ctx, [card]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await s.close();
});
const entry = () => ({
  kind: 'entry',
  id: `${card.id}::nonfoil`,
  data: {
    cardId: card.id,
    finish: 'nonfoil',
    quantity: 2,
    paid: { amount: 2, currency: 'USD' },
    notes: 'private',
    valueUsd: 9,
    addedAt: '2026-10-23T00:00:00Z',
  },
});
const base = () => `/api/collections/${id}/games/mtg`;
describe('multi-game collections', () => {
  it('uses existing sessions and collection access while isolating Pokémon', async () => {
    expect((await new Client(s.app).get(`${base()}/state`)).statusCode).toBe(
      401,
    );
    expect(
      (await owner.put(`${base()}/records`, { records: [entry()] })).statusCode,
    ).toBe(200);
    const state = (await owner.get(`${base()}/state`)).json();
    expect(state.entries[0].quantity).toBe(2);
    expect(state.history[0].valueUsd).toBe(18);
    const pokemon = (await owner.get(`/api/collections/${id}/state`)).json();
    expect(pokemon.entries).toEqual([]);
    expect(pokemon.history).toEqual([]);
    const other = await invite(owner, s.app, 'misty');
    expect((await other.get(`${base()}/state`)).statusCode).toBe(404);
    expect(
      (await other.put(`${base()}/records`, { records: [entry()] })).statusCode,
    ).toBe(404);
  });
  it('rejects stale revisions, replays receipts and validates game/finish/quantity', async () => {
    const start = (await owner.get(`${base()}/state`)).json();
    const route = `${base()}/records`;
    const headers = {
      'idempotency-key': 'test-tcg-receipt',
      'if-match': `"${start.revision}"`,
    };
    const a = await owner.req('PUT', route, { records: [entry()] }, headers);
    expect(a.statusCode).toBe(200);
    const replay = await owner.req(
      'PUT',
      route,
      { records: [entry()] },
      headers,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['x-mutation-replayed']).toBe('1');
    expect(
      (
        await owner.req(
          'PUT',
          route,
          { records: [entry()] },
          { ...headers, 'idempotency-key': 'test-tcg-second' },
        )
      ).statusCode,
    ).toBe(409);
    for (const patch of [
      { cardId: 'sv01-001' },
      { finish: 'etched' },
      { quantity: -1 },
      { quantity: 1.2 },
    ])
      expect(
        (
          await owner.put(route, {
            records: [{ ...entry(), data: { ...entry().data, ...patch } }],
          })
        ).statusCode,
      ).toBe(400);
  });
  it('allows draft Commander decks and quantities beyond Pokémon limits', async () => {
    const deck = {
      id: 'test-deck',
      game: 'mtg',
      name: 'Draft',
      kind: 'deck',
      format: 'commander',
      items: [{ cardId: card.id, quantity: 99, zone: 'main' }],
    };
    expect(
      (
        await owner.put(`${base()}/records`, {
          records: [{ kind: 'list', id: deck.id, data: deck }],
        })
      ).statusCode,
    ).toBe(200);
    expect(gameState(s.ctx, id, 'mtg').lists[0].items[0].quantity).toBe(99);
    expect(
      (
        await owner.put(`${base()}/records`, {
          records: [
            { kind: 'list', id: deck.id, data: { ...deck, format: 'modern' } },
          ],
        })
      ).statusCode,
    ).toBe(400);
  });
  it('round-trips version-7 exports idempotently without trusting injected catalogue data', async () => {
    await owner.put(`${base()}/records`, { records: [entry()] });
    const exported = (await owner.get(`${base()}/export`)).json();
    expect(exported.version).toBe(7);
    await owner.del(base());
    expect(gameState(s.ctx, id, 'mtg').entries).toHaveLength(0);
    exported.games.mtg.cards[0].prices.nonfoil[0].amount = 99999;
    expect((await owner.post(`${base()}/import`, exported)).statusCode).toBe(
      200,
    );
    expect((await owner.post(`${base()}/import`, exported)).statusCode).toBe(
      200,
    );
    const state = gameState(s.ctx, id, 'mtg');
    expect(state.entries).toHaveLength(1);
    expect(state.cards[0].prices.nonfoil[0].amount).toBe(3.5);
  });
  it('redacts Magic shares on the server and rechecks revocation and audience', async () => {
    await owner.put(`${base()}/records`, {
      records: [
        entry(),
        { kind: 'note', id: card.id, data: { text: 'secret' } },
      ],
    });
    const result = await owner.post('/api/shares', {
      collectionId: id,
      game: 'mtg',
      scope: 'collection',
      audience: 'public',
      hidePaid: true,
      hideValue: true,
      hideNotes: true,
    });
    expect(result.statusCode).toBe(200);
    const share = result.json();
    const visitor = new Client(s.app);
    const path = `/api/public/${share.url.split('/s/')[1]}`;
    const data = (await visitor.get(path)).json();
    expect(data.game).toBe('mtg');
    expect(data.entries[0]).not.toHaveProperty('paid');
    expect(data.entries[0]).not.toHaveProperty('notes');
    expect(data.entries[0]).not.toHaveProperty('valueUsd');
    expect(data.cards[0].prices).toEqual({});
    expect(data.notes).toEqual([]);
    expect(data.history).toEqual([]);
    await owner.del(`/api/shares/${share.id}`);
    expect((await visitor.get(path)).statusCode).toBe(404);
    const privateShare = (
      await owner.post('/api/shares', {
        collectionId: id,
        game: 'mtg',
        scope: 'collection',
        audience: 'instance',
      })
    ).json();
    expect(
      (
        await new Client(s.app).get(
          `/api/public/${privateShare.url.split('/s/')[1]}`,
        )
      ).statusCode,
    ).toBe(401);
  });
  it('preserves item photos across metadata updates and includes them in reconciliation', async () => {
    const slab = {
      kind: 'graded',
      id: 'slab-1',
      data: {
        cardId: card.id,
        finish: 'foil',
        company: 'PSA',
        grade: '10',
        countsTowardSet: true,
      },
    };
    await owner.put(`${base()}/records`, { records: [slab] });
    const boundary = 'test-photo-boundary';
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="slab.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await owner.req(
      'POST',
      `${base()}/records/graded/slab-1/photos`,
      body,
      { 'content-type': `multipart/form-data; boundary=${boundary}` },
    );
    expect(res.statusCode).toBe(200);
    const photoId = res.json().id;
    await owner.put(`${base()}/records`, {
      records: [{ ...slab, data: { ...slab.data, grade: '9' } }],
    });
    expect(
      s.ctx.db.get('SELECT 1 FROM tcg_photos WHERE id=?', photoId),
    ).toBeTruthy();
    expect(reconcilePhotos(s.ctx, 0).missing).toEqual([]);
    expect((await owner.get(`${base()}/photos/${photoId}`)).statusCode).toBe(
      200,
    );
    const share = (
      await owner.post('/api/shares', {
        collectionId: id,
        game: 'mtg',
        scope: 'graded',
        audience: 'public',
      })
    ).json();
    const visitor = new Client(s.app),
      token = share.url.split('/s/')[1];
    expect(
      (await visitor.get(`/api/public/${token}/game-photo/${photoId}`))
        .statusCode,
    ).toBe(200);
    await owner.del(`${base()}/records/graded/slab-1`);
    expect(gameState(s.ctx, id, 'mtg').graded).toEqual([]);
    expect(
      (await visitor.get(`/api/public/${token}/game-photo/${photoId}`))
        .statusCode,
    ).toBe(404);
    await owner.put(`${base()}/records`, { records: [slab] });
    expect((await owner.get(`${base()}/photos/${photoId}`)).statusCode).toBe(
      200,
    );
    await owner.del(`/api/shares/${share.id}`);
    expect(
      (await visitor.get(`/api/public/${token}/game-photo/${photoId}`))
        .statusCode,
    ).toBe(404);
    const other = await invite(owner, s.app, 'brock');
    expect((await other.get(`${base()}/photos/${photoId}`)).statusCode).toBe(
      404,
    );
  });
});
it('serves Scryfall through the authenticated server adapter and exposes game descriptors', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          {
            id: card.providerId,
            oracle_id: 'oracle',
            name: 'Leader',
            lang: 'ja',
            set: 'tst',
            set_name: 'Test',
            collector_number: '1',
            games: ['paper'],
            finishes: ['foil'],
          },
        ],
        has_more: false,
        total_cards: 1,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  const result = await owner.get('/api/games/mtg/search?q=Leader&language=ja');
  expect(result.statusCode).toBe(200);
  expect(result.json().cards[0].language).toBe('ja');
  expect(fetch.mock.calls[0][0]).toContain(
    'https://api.scryfall.com/cards/search',
  );
  expect(
    (await owner.get('/api/games')).json().map((g: { id: string }) => g.id),
  ).toEqual(['pokemon', 'mtg']);
});
it('streams bulk objects across UTF-8 and string/brace boundaries and rejects truncation', async () => {
  const text = JSON.stringify([
    { name: 'Éowyn', text: '} " quote' },
    { name: 'Second' },
  ]);
  const bytes = new TextEncoder().encode(text);
  async function* chunks() {
    for (const byte of bytes) yield new Uint8Array([byte]);
  }
  const objects = [];
  for await (const obj of jsonObjects(chunks())) objects.push(obj);
  expect(objects).toEqual(JSON.parse(text));
  async function* truncated() {
    yield new TextEncoder().encode('[{"name":"test"}');
  }
  await expect(async () => {
    for await (const ignored of jsonObjects(truncated())) void ignored;
  }).rejects.toThrow('Incomplete');
});

it('rejects malformed imports and missing finishes without modifying collection data', async () => {
  for (const patch of [
    { entries: [null] },
    { wishlist: [42] },
    { lists: [{ id: 'bad', items: 'bad' }] },
  ]) {
    expect(
      (
        await owner.post(`${base()}/import`, {
          version: 7,
          games: { mtg: patch },
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await owner.put(`${base()}/records`, {
        records: [{ ...entry(), data: { ...entry().data, finish: undefined } }],
      })
    ).statusCode,
  ).toBe(400);
  expect(gameState(s.ctx, id, 'mtg').entries).toEqual([]);
});

it('does not replace newer quotes or invent a new observation date from stale catalogue data', () => {
  saveGameCards(s.ctx, [
    {
      ...card,
      fetchedAt: '2000-01-01T00:00:00Z',
      prices: {
        nonfoil: [
          {
            amount: 999,
            currency: 'USD',
            source: 'tcgplayer',
            at: '2000-01-01T00:00:00Z',
          },
        ],
      },
    },
  ]);
  const row = s.ctx.db.get<{ data: string }>(
    'SELECT data FROM tcg_cards WHERE game=? AND id=?',
    'mtg',
    card.id,
  )!;
  expect(JSON.parse(row.data).prices.nonfoil[0].amount).toBe(3.5);
  expect(
    s.ctx.db.get("SELECT 1 FROM tcg_price_history WHERE date='2000-01-01'"),
  ).toBeUndefined();
});
