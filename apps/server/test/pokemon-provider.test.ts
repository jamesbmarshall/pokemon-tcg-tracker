import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as catalog from '@poketracker/shared/catalog';
import { PRINTING_VERSION } from '@poketracker/shared/printings';
import { POLICY_VERSION } from '@poketracker/shared/printingRules';
import type { PokemonCard } from '@poketracker/shared/types';
import { providerFor, providerForCard, providerForSet } from '../src/tcg/provider.ts';
import { discoverSets, persistCatalogue } from '../src/printingCatalog.ts';
import { startServer, type TestServer, setupOwner } from './helpers.ts';

let server: TestServer;
let card: PokemonCard;
const prefix = `catalogue-display:${PRINTING_VERSION}:${POLICY_VERSION}`;
function cache(key: string, value: unknown, at = Date.now()) {
  server.ctx.db.run('INSERT OR REPLACE INTO http_cache (key,status,content_type,body,fetched_at) VALUES (?,200,?,?,?)', key, 'application/json', Buffer.from(JSON.stringify(value)), at);
}
function complete(value: PokemonCard, at = Date.now()) {
  server.ctx.db.run('INSERT OR REPLACE INTO printing_catalogues (set_id,data,profile,printing_version,policy_version,synced_at) VALUES (?,?,?,?,?,?)', value.set.id, JSON.stringify([value]), '{}', PRINTING_VERSION, POLICY_VERSION, at);
  // Suppress background refresh for the stale fixture, as after a failed import.
  server.ctx.db.run('INSERT OR REPLACE INTO printing_sync_queue (set_id,release_date,next_at,last_error) VALUES (?,?,?,?)', value.set.id, '', Date.now() + 3600_000, 'Fixture outage');
}
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected upstream request'); }));
  server = await startServer();
  card = { id: 'u08-001', name: 'Example', supertype: 'Pokémon', subtypes: ['Basic'], number: '001', detailed: true,
    images: { small: 'small', large: 'large' }, variants: ['normal'], printingCoverage: 'complete',
    set: { id: 'u08', name: 'Example set', series: 'Series', total: 1, printedTotal: 1, releaseDate: '2026-01-01', updatedAt: '', ptcgoCode: 'EXM', images: { logo: '', symbol: '' } },
    tcgplayer: { url: 'url', updatedAt: '2026-01-01', provenance: { normal: { url: 'url', updatedAt: '2026-01-01' } }, prices: { normal: { market: 5 } } } };
});
afterEach(async () => { await server.close(); catalog.configureCatalog({ storage: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('internal Pokémon catalogue provider', () => {
  it.each(['en', 'ja', 'fr'])('satisfies sets/card/set-card contracts from authoritative %s caches', async (lang) => {
    if (lang !== 'en') { card.id = `${lang}:${card.id}`; card.set.id = `${lang}:${card.set.id}`; }
    complete(card);
    server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', lang, JSON.stringify([card.set]), Date.now());
    const provider = providerFor(server.ctx, 'pokemon', lang);
    expect(await provider.sets()).toMatchObject([{ id: card.set.id, game: 'pokemon' }]);
    expect(await providerForCard(server.ctx, 'pokemon', card.id).card(card.id)).toMatchObject({ id: card.id, language: lang, stale: false, details: { detailed: true } });
    expect(await providerForSet(server.ctx, 'pokemon', card.set.id).setCards(card.set.id, lang)).toMatchObject([{ id: card.id }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(server.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tcg_cards')!.n).toBe(0);
  });
  it('reports stale evidence without changing observation time or stored data', async () => {
    const at = Date.now() - 7 * 3600_000;
    complete(card, at);
    const before = server.ctx.db.get('SELECT * FROM printing_catalogues WHERE set_id = ?', card.set.id);
    const result = await providerFor(server.ctx, 'pokemon').card(card.id);
    expect(result).toMatchObject({ stale: true, fetchedAt: new Date(at).toISOString() });
    expect(result.prices.normal[0]).toMatchObject({ amount: 5, at: '2026-01-01' });
    expect(server.ctx.db.get('SELECT * FROM printing_catalogues WHERE set_id = ?', card.set.id)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains set-list provenance on upstream failure', async () => {
    const at = Date.now() - 7 * 3600_000;
    server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([card.set]), at);
    vi.spyOn(catalog, 'getSets').mockRejectedValue(new Error('Provider unavailable'));
    expect(await providerFor(server.ctx, 'pokemon').sets()).toMatchObject([
      { id: card.set.id, stale: true, fetchedAt: new Date(at).toISOString(), details: { images: card.set.images, printedTotal: 1 } },
    ]);
    expect(server.ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM catalogue_set_lists')!.fetched_at).toBe(at);
  });
  it.each(['catalogue', 'card-cache'])('enriches paged summary search from the %s without erasing prices', async (source) => {
    if (source === 'catalogue') complete(card);
    else cache(`${prefix}:card:${card.id}`, card);
    const brief = { ...card, detailed: false, tcgplayer: undefined, printingCoverage: 'partial' as const };
    const search = vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [brief], page: 2, pageSize: 36, totalCount: 37 });
    const provider = providerFor(server.ctx, 'pokemon');
    const result = await provider.search({ q: 'Example', page: 2 });
    expect(result).toMatchObject({ total: 37, hasMore: false, cards: [{ details: { detailed: true }, prices: { normal: [{ amount: 5 }] } }] });
    expect(await provider.search({ q: 'Example', page: 2 })).toEqual(result);
    expect(search).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps all matching printing candidates and handles padded collector numbers', async () => {
    complete(card);
    const other = { ...card, id: 'u08b-001', set: { ...card.set, id: 'u08b' } };
    complete(other);
    server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([card.set, other.set]), Date.now());
    const provider = providerFor(server.ctx, 'pokemon');
    expect((await provider.resolve!({ name: 'Example', set: 'EXM', number: '1', quantity: 1, zone: 'main', line: 1 })).map((c) => c.id)).toEqual([card.id, other.id]);
    expect(await provider.search({ set: card.set.id, number: '1' })).toMatchObject({ total: 1, hasMore: false, cards: [{ id: card.id }] });
  });
  it('enriches a brief set listing from the existing detailed card cache', async () => {
    complete(card);
    server.ctx.db.run('DELETE FROM printing_catalogues');
    cache(`${prefix}:set-complete-v2:${card.set.id}`, [{ ...card, detailed: false, tcgplayer: undefined }]);
    cache(`${prefix}:card:${card.id}`, card);
    const result = await providerFor(server.ctx, 'pokemon').setCards(card.set.id, 'en');
    expect(result).toMatchObject([{ details: { detailed: true }, prices: { normal: [{ amount: 5 }] } }]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('serves stale search during an outage without marking the refresh successful', async () => {
    const search = vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [card], page: 1, pageSize: 36, totalCount: 1 });
    const provider = providerFor(server.ctx, 'pokemon');
    await provider.search({ q: 'outage-example' });
    const at = Date.now() - 7 * 3600_000;
    server.ctx.db.run('UPDATE http_cache SET fetched_at = ?', at);
    search.mockRejectedValue(new Error('Provider unavailable'));
    const result = await provider.search({ q: 'outage-example' });
    expect(result).toMatchObject({ stale: true, cards: [{ fetchedAt: new Date(at).toISOString(), stale: true }] });
    expect(search).toHaveBeenCalledTimes(2);
    expect(server.ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM http_cache')!.fetched_at).toBe(at);
    await expect(provider.search({ q: 'uncached-outage' })).rejects.toThrow('unavailable');
  });
  it('rejects invalid input and language conflicts before upstream work', async () => {
    const provider = providerFor(server.ctx, 'pokemon');
    await expect(provider.card('https://internal/card')).rejects.toThrow('Invalid');
    await expect(provider.setCards('ja:u08', 'en')).rejects.toThrow('disagree');
    await expect(provider.search({ page: NaN })).rejects.toThrow('page');
    await expect(provider.search({ language: 'xx' })).rejects.toThrow('language');
    await expect(provider.search({ set: 'ja:u08', language: 'en' })).rejects.toThrow('disagree');
    await expect(provider.search({ number: '001' })).rejects.toThrow('requires');
    await expect(provider.search({ surprise: 'value' })).rejects.toThrow('field');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not cache malformed or cross-language search responses', async () => {
    const search = vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [{ ...card, id: 'ja:u08-001', set: { ...card.set, id: 'ja:u08' } }], page: 1, pageSize: 36, totalCount: 1 });
    const provider = providerFor(server.ctx, 'pokemon');
    await expect(provider.search({ q: 'bad-language' })).rejects.toThrow('Mismatched');
    search.mockResolvedValue({ data: [card], page: 1, pageSize: 36, totalCount: NaN });
    await expect(provider.search({ q: 'bad-count' })).rejects.toThrow('Invalid');
    search.mockResolvedValue({ data: [card, card], page: 1, pageSize: 36, totalCount: 2 });
    await expect(provider.search({ q: 'duplicate' })).rejects.toThrow('Invalid');
    expect(server.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM http_cache')!.n).toBe(0);
  });
  it('keeps Pokémon generic HTTP routes behind the compatibility boundary', async () => {
    const user = await setupOwner(server.app);
    expect((await user.get('/api/games/pokemon/sets')).statusCode).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves stale negative collector-number results (empty set: %s)', async (empty) => {
    complete(card, Date.now() - 7 * 3600_000);
    if (empty) server.ctx.db.run("UPDATE printing_catalogues SET data = '[]'");
    expect(await providerFor(server.ctx, 'pokemon').search({ set: card.set.id, number: '999' }))
      .toEqual({ cards: [], total: 0, hasMore: false, stale: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('attributes cached detail freshness to its own row (stale detail: %s)', async (staleDetail) => {
    const old = Date.now() - 7 * 3600_000, recent = Date.now();
    complete({ ...card, id: 'u08-002', number: '002' }, staleDetail ? recent : old);
    const detailAt = staleDetail ? old : recent;
    cache(`${prefix}:card:${card.id}`, card, detailAt);
    vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [{ ...card, detailed: false }], page: 1, pageSize: 36, totalCount: 1 });
    const result = await providerFor(server.ctx, 'pokemon').search({ q: 'newly-listed' });
    expect(result.cards[0]).toMatchObject({ fetchedAt: new Date(detailAt).toISOString(), stale: staleDetail });
  });

  it('rejects short search pages and retains a previous successful observation', async () => {
    const search = vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [card], page: 1, pageSize: 36, totalCount: 1 });
    const provider = providerFor(server.ctx, 'pokemon');
    await provider.search({ q: 'short-page' });
    expect(search).toHaveBeenLastCalledWith(expect.any(Object), 1, undefined, { refresh: true });
    const at = Date.now() - 7 * 3600_000;
    server.ctx.db.run('UPDATE http_cache SET fetched_at = ?', at);
    const before = server.ctx.db.get('SELECT body,fetched_at FROM http_cache');
    const warn = vi.spyOn(server.ctx.log, 'warn').mockImplementation(() => {});
    search.mockResolvedValue({ data: [], page: 1, pageSize: 36, totalCount: 1 });
    expect(await provider.search({ q: 'short-page' })).toMatchObject({ stale: true, total: 1 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(server.ctx.db.get('SELECT body,fetched_at FROM http_cache')).toEqual(before);
    await expect(provider.search({ q: 'cold-short-page' })).rejects.toThrow('Invalid');
  });

  it('resolves printed codes in French catalogues lacking live abbreviations', async () => {
    card.id = 'fr:sv01-001'; card.set.id = 'fr:sv01'; delete card.set.ptcgoCode;
    complete(card);
    server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'fr', JSON.stringify([card.set]), Date.now());
    expect(await providerFor(server.ctx, 'pokemon', 'fr').resolve!({ name: card.name, set: 'SVI', number: '1', quantity: 1, zone: 'main', line: 1 }))
      .toMatchObject([{ id: card.id, language: 'fr', setCode: 'SVI' }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['rarity', 'artist', 'series', 'ptcgoCode'])('rejects malformed %s before caching normalized search', async (field) => {
    const invalid = field === 'rarity' || field === 'artist' ? { ...card, [field]: {} } : { ...card, set: { ...card.set, [field]: {} } };
    vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [invalid as unknown as PokemonCard], page: 1, pageSize: 36, totalCount: 1 });
    await expect(providerFor(server.ctx, 'pokemon').search({ q: 'bad-field' })).rejects.toThrow('Invalid Pokémon');
    expect(server.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM http_cache')!.n).toBe(0);
  });

  it.each(['REST', 'GraphQL'])('disables redirects on the %s proxy upstream request', async (kind) => {
    const upstream = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', upstream);
    const user = await setupOwner(server.app);
    const response = kind === 'REST' ? await user.get('/api/tcgdex/v2/en/cards') : await user.post('/api/tcgdex/v2/graphql', { query: '{ sets { id } }' });
    expect(response.statusCode).toBe(200);
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('http://tcgdex.test/v2'), expect.objectContaining({ redirect: 'error' }));
  });
});

it('requires normalized names as well as supplied collector numbers', async () => {
  complete(card);
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([card.set]), Date.now());
  const provider = providerFor(server.ctx, 'pokemon');
  const row = { name: 'wrong name', set: 'EXM', number: '1', quantity: 1, zone: 'main' as const, line: 1 };
  expect(await provider.resolve!(row)).toEqual([]);
  expect(await provider.resolve!({ ...row, name: '  example  ' })).toMatchObject([{ id: card.id }]);
  vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [card], page: 1, pageSize: 36, totalCount: 1 });
  expect(await provider.resolve!({ ...row, name: 'example', set: undefined })).toMatchObject([{ id: card.id }]);
});

it('consults and caches live abbreviations for newly released sets', async () => {
  complete(card);
  const set = { ...card.set, ptcgoCode: undefined };
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([set]), Date.now());
  const metadata = vi.spyOn(catalog, 'getSet').mockResolvedValue({ ...set, ptcgoCode: 'NEW' });
  const provider = providerFor(server.ctx, 'pokemon');
  const row = { name: card.name, set: 'NEW', number: '1', quantity: 1, zone: 'main' as const, line: 1 };
  expect(await provider.resolve!(row)).toMatchObject([{ id: card.id }]);
  expect(await provider.resolve!(row)).toHaveLength(1);
  expect(metadata).toHaveBeenCalledTimes(1);
});

it('uses newer live abbreviations for cards and sets without letting older metadata win', async () => {
  const provider = providerFor(server.ctx, 'pokemon');
  complete(card, Date.now() - 10_000);
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([card.set]), Date.now() - 10_000);
  cache(`${prefix}:metadata:${card.set.id}`, { ...card.set, ptcgoCode: 'NEW' }, Date.now());
  expect(await provider.card(card.id)).toMatchObject({ setCode: 'NEW' });
  expect(await provider.sets()).toMatchObject([{ id: card.set.id, code: 'NEW' }]);

  complete(card, Date.now());
  cache(`${prefix}:metadata:${card.set.id}`, { ...card.set, ptcgoCode: 'OLD' }, Date.now() - 10_000);
  server.ctx.db.run('UPDATE catalogue_set_lists SET fetched_at = ?', Date.now());
  expect(await provider.card(card.id)).toMatchObject({ setCode: 'EXM' });
  expect(await provider.sets()).toMatchObject([{ id: card.set.id, code: 'EXM' }]);
});

it.each([
  ['no abbreviation', undefined],
  ['a static fallback', 'SVI'],
])('retains a cached live abbreviation over a newer observation with %s', async (_description, ptcgoCode) => {
  const setCard = { ...card, id: 'sv01-001', set: { ...card.set, id: 'sv01', ptcgoCode } };
  const at = Date.now();
  complete(setCard, at);
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([setCard.set]), at);
  cache(`${prefix}:metadata:${setCard.set.id}`, { ...setCard.set, ptcgoCode: 'LIVE' }, at - 10_000);

  const provider = providerFor(server.ctx, 'pokemon');
  expect(await provider.card(setCard.id)).toMatchObject({ setCode: 'LIVE' });
  expect(await provider.sets()).toMatchObject([{ id: setCard.set.id, code: 'LIVE' }]);
});

it('skips successful metadata without abbreviations while building the live code index', async () => {
  const target = { ...card, id: 'live-index-proof-001', set: { ...card.set, id: 'live-index-proof', ptcgoCode: undefined } };
  complete(target);
  const noCode = { ...target.set, id: 'no-code-proof', name: 'No code' };
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([noCode, target.set]), Date.now());
  const metadata = vi.spyOn(catalog, 'getSet').mockImplementation(async (id) => ({
    ...target.set, id, ptcgoCode: id === target.set.id ? 'NEW' : undefined,
  }));
  const result = await providerFor(server.ctx, 'pokemon').resolve!({
    name: target.name, set: 'NEW', number: target.number, quantity: 1, zone: 'main', line: 1,
  });
  expect(result).toMatchObject([{ id: target.id }]);
  expect(metadata).toHaveBeenCalledTimes(2);
});

it.each([
  ['DP', ['dp1-001', 'dpp-001']],
  ['HS', ['hgss1-001', 'hgssp-001']],
  ['XY', ['xy1-001', 'xyp-001']],
])('matches both the %s promo prefix and its expansion sets', async (code, expected) => {
  const setIds = ['dp1', 'dpp', 'hgss1', 'hgssp', 'xy1', 'xyp'];
  const candidates = setIds.map((id) => ({
    ...card,
    id: `${id}-001`,
    set: { ...card.set, id, name: id, ptcgoCode: undefined },
  }));
  for (const candidate of candidates) complete(candidate);
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify(candidates.map(({ set }) => set)), Date.now());

  const result = await providerFor(server.ctx, 'pokemon').resolve!({
    name: card.name, set: code, number: '001', quantity: 1, zone: 'main', line: 1,
  });
  expect(result.map(({ id }) => id).sort()).toEqual(expected);
});

it.each(['card', 'set'])('rejects malformed %s refreshes before cache publication', async (kind) => {
  complete(card);
  server.ctx.db.run('DELETE FROM printing_catalogues');
  const key = `${prefix}:${kind === 'card' ? 'card' : 'set-complete-v2'}:${kind === 'card' ? card.id : card.set.id}`;
  const at = Date.now() - 7 * 3600_000;
  cache(key, kind === 'card' ? card : [card], at);
  const before = server.ctx.db.get('SELECT body,fetched_at FROM http_cache WHERE key = ?', key);
  vi.spyOn(catalog, 'getSet').mockResolvedValue(card.set);
  const malformed = { ...card, rarity: {} } as unknown as PokemonCard;
  vi.spyOn(catalog, 'getCardDetails').mockResolvedValue(malformed);
  vi.spyOn(catalog, 'getSetCardsBrief').mockResolvedValue([malformed]);
  const warn = vi.spyOn(server.ctx.log, 'warn').mockImplementation(() => {});
  const provider = providerFor(server.ctx, 'pokemon');
  if (kind === 'card') expect((await provider.card(card.id)).stale).toBe(true);
  else expect((await provider.setCards(card.set.id, 'en'))[0].stale).toBe(true);
  await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  expect(server.ctx.db.get('SELECT body,fetched_at FROM http_cache WHERE key = ?', key)).toEqual(before);
});

it.each(['card', 'set'])('keeps %s display observation provenance during a concurrent catalogue import', async (kind) => {
  complete(card);
  server.ctx.db.run('DELETE FROM printing_catalogues');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const loader = kind === 'card'
    ? vi.spyOn(catalog, 'getCardDetails').mockImplementation(async () => { await blocked; return card; })
    : vi.spyOn(catalog, 'getSetCardsBrief').mockImplementation(async () => { await blocked; return [card]; });
  vi.spyOn(catalog, 'getSet').mockResolvedValue(card.set);
  const provider = providerFor(server.ctx, 'pokemon');
  const pending = kind === 'card' ? provider.card(card.id).then((c) => [c]) : provider.setCards(card.set.id, 'en');
  await vi.waitFor(() => expect(loader).toHaveBeenCalled());
  complete({ ...card, name: 'Different catalogue observation' }, Date.now() - 7 * 3600_000);
  release();
  const result = await pending;
  const at = server.ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM http_cache WHERE key = ?', `${prefix}:${kind === 'card' ? 'card' : 'set-complete-v2'}:${kind === 'card' ? card.id : card.set.id}`)!.fetched_at;
  expect(result[0]).toMatchObject({ name: 'Example', stale: false, fetchedAt: new Date(at).toISOString() });
});


it('retains published catalogue and list observations when scheduled data is invalid', async () => {
  complete(card);
  const before = server.ctx.db.get('SELECT * FROM printing_catalogues WHERE set_id = ?', card.set.id);
  expect(() => persistCatalogue(server.ctx, card.set.id, [{ ...card, artist: {} } as unknown as PokemonCard])).toThrow('Invalid Pokémon card');
  expect(server.ctx.db.get('SELECT * FROM printing_catalogues WHERE set_id = ?', card.set.id)).toEqual(before);
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([card.set]), 123);
  vi.spyOn(catalog, 'getSets').mockResolvedValue([{ ...card.set, total: 1.5 }]);
  await expect(discoverSets(server.ctx, 'en')).rejects.toThrow('Invalid Pokémon set');
  expect(server.ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM catalogue_set_lists')!.fetched_at).toBe(123);
  expect(() => persistCatalogue(server.ctx, card.set.id, [{ ...card, set: { ...card.set, total: 2 } }])).toThrow('incomplete catalogue');
});

it('resolves an explicit set without unrelated metadata and applies cached live codes to projections', async () => {
  const noCode = { ...card, set: { ...card.set, ptcgoCode: undefined } };
  complete(noCode);
  const other = { ...noCode.set, id: 'unknown-new' };
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([noCode.set, other]), Date.now());
  const metadata = vi.spyOn(catalog, 'getSet').mockImplementation(async (id) => {
    if (id === other.id) throw new Error('Unrelated outage');
    return { ...noCode.set, ptcgoCode: 'NEW' };
  });
  const provider = providerFor(server.ctx, 'pokemon');
  const row = { name: card.name, set: noCode.set.id, number: '1', quantity: 1, zone: 'main' as const, line: 1 };
  expect(await provider.resolve!(row)).toHaveLength(1);
  expect(metadata).not.toHaveBeenCalled();
  await expect(provider.resolve!({ ...row, set: 'NEW' })).rejects.toThrow('Unrelated outage');
  cache(`${prefix}:metadata:${noCode.set.id}`, { ...noCode.set, ptcgoCode: 'NEW' });
  const projected = await provider.card(card.id);
  expect(projected.setCode).toBe('NEW');
  expect(projected.details.set).not.toHaveProperty('ptcgoCode');
  expect((await provider.sets()).find((set) => set.id === noCode.set.id)).toMatchObject({ code: 'NEW' });
});

it('maps printed promo prefixes to the matching set code', async () => {
  const promo = { ...card, id: 'svp-064', number: '064', set: { ...card.set, id: 'svp', ptcgoCode: 'PR-SV' } };
  complete(promo);
  server.ctx.db.run('INSERT INTO catalogue_set_lists (language,data,fetched_at) VALUES (?,?,?)', 'en', JSON.stringify([promo.set]), Date.now());
  expect(await providerFor(server.ctx, 'pokemon').resolve!({ name: promo.name, set: 'SVP', number: '064', quantity: 1, zone: 'main', line: 1 })).toMatchObject([{ id: promo.id }]);
});

it('does not use legacy partial set listings as completeness evidence', async () => {
  complete(card);
  server.ctx.db.run('DELETE FROM printing_catalogues');
  cache(`${prefix}:set:${card.set.id}`, []);
  vi.spyOn(catalog, 'getSetCardsBrief').mockRejectedValue(new Error('Incomplete set listing'));
  await expect(providerFor(server.ctx, 'pokemon').search({ set: card.set.id, number: '1' })).rejects.toThrow('Incomplete set listing');
});
