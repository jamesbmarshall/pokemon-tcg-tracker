import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as catalog from '@poketracker/shared/catalog';
import { PRINTING_VERSION } from '@poketracker/shared/printings';
import { POLICY_VERSION } from '@poketracker/shared/printingRules';
import type { PokemonCard } from '@poketracker/shared/types';
import { providerFor, providerForCard, providerForSet } from '../src/tcg/provider.ts';
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
    tcgplayer: { url: 'url', updatedAt: '2026-01-01', prices: { normal: { market: 5 } } } };
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
    const search = vi.spyOn(catalog, 'searchCards').mockResolvedValue({ data: [brief], page: 2, pageSize: 36, totalCount: 90 });
    const provider = providerFor(server.ctx, 'pokemon');
    const result = await provider.search({ q: 'Example', page: 2 });
    expect(result).toMatchObject({ total: 90, hasMore: true, cards: [{ details: { detailed: true }, prices: { normal: [{ amount: 5 }] } }] });
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
    cache(`${prefix}:set:${card.set.id}`, [{ ...card, detailed: false, tcgplayer: undefined }]);
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
});
