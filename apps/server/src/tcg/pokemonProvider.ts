/** Internal adapter over Pokémon's authoritative catalogue services and caches. */
import { searchCards, type SearchFilters } from '@poketracker/shared/catalog';
import { SET_CODES } from '@poketracker/shared/legacySets';
import { isLang, splitId } from '@poketracker/shared/languages';
import { PRINTING_VERSION } from '@poketracker/shared/printings';
import { POLICY_VERSION } from '@poketracker/shared/printingRules';
import { fromPokemon, pokemonReference, pokemonSet } from '@poketracker/shared/tcg/pokemon';
import type { TcgProvider, TcgSearch, TcgPage } from '@poketracker/shared/tcg/types';
import type { PokemonCard } from '@poketracker/shared/types';
import { bad, HttpError, type Ctx } from '../context.ts';
import { catalogSets, displayCached, getCatalogCard, getCatalogSetForDisplay, readCatalogCards } from '../printingCatalog.ts';
import { sha256 } from '../security.ts';
import { json } from '../db.ts';

const HOUR = 3600_000;
const prefix = `catalogue-display:${PRINTING_VERSION}:${POLICY_VERSION}`;
function language(value: string) {
  if (!isLang(value)) throw bad('Unsupported Pokémon catalogue language');
  return value;
}
function reference(id: string, kind: 'card' | 'set') {
  if (!pokemonReference(id, kind)) throw bad('Invalid Pokémon catalogue reference');
}
function observed(ctx: Ctx, setId: string, key: string, source: 'catalogue' | 'display' | 'prefer-catalogue' = 'prefer-catalogue') {
  const catalogueAt = source !== 'display' ? ctx.db.get<{ synced_at: number }>('SELECT synced_at FROM printing_catalogues WHERE set_id = ? AND printing_version = ? AND policy_version = ?', setId, PRINTING_VERSION, POLICY_VERSION)?.synced_at : undefined;
  const at = catalogueAt ?? (source !== 'catalogue' ? ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM http_cache WHERE key = ?', key)?.fetched_at : undefined);
  if (at === undefined) throw new HttpError(502, 'Missing Pokémon cache provenance', 'upstream');
  return { at: new Date(at).toISOString(), stale: Date.now() - at >= 6 * HOUR };
}
function numberMatches(a: string, b: string) {
  return /^\d+$/.test(a) && /^\d+$/.test(b) ? a.replace(/^0+(?=\d)/, '') === b.replace(/^0+(?=\d)/, '') : a.toUpperCase() === b.toUpperCase();
}
function cachedDetail(ctx: Ctx, id: string): PokemonCard | undefined {
  const row = ctx.db.get<{ body: Uint8Array }>('SELECT body FROM http_cache WHERE key = ?', `${prefix}:card:${id}`);
  const card = row ? json<PokemonCard | undefined>(Buffer.from(row.body).toString(), undefined) : undefined;
  return card?.id === id && card.detailed === true ? card : undefined;
}

export function pokemonProvider(ctx: Ctx, selectedLanguage = 'en'): TcgProvider {
  const lang = language(selectedLanguage);
  async function setPage(id: string, requestedLanguage: string) {
    reference(id, 'set');
    if (language(requestedLanguage) !== splitId(id).lang) throw bad('Set ID and language disagree');
    const cards = await getCatalogSetForDisplay(ctx, id);
    if (!Array.isArray(cards) || cards.length > 5000 || new Set(cards.map((card) => card.id)).size !== cards.length)
      throw new HttpError(502, 'Invalid Pokémon set response', 'upstream');
    const metadata = observed(ctx, id, `${prefix}:set:${id}`);
    const normalized = cards.map((card) => {
      if (card.set.id !== id) throw new HttpError(502, 'Mismatched Pokémon set response', 'upstream');
      if (card.detailed !== true) {
        const full = cachedDetail(ctx, card.id);
        if (full) {
          if (full.set.id !== id) throw new HttpError(502, 'Mismatched Pokémon cached response', 'upstream');
          const detailMetadata = observed(ctx, id, `${prefix}:card:${card.id}`, 'display');
          return { ...fromPokemon(full, detailMetadata.at), stale: detailMetadata.stale || metadata.stale };
        }
      }
      return { ...fromPokemon(card, metadata.at), stale: metadata.stale };
    });
    return { cards: normalized, stale: metadata.stale || normalized.some((card) => card.stale) };
  }
  async function setCards(id: string, requestedLanguage: string) {
    return (await setPage(id, requestedLanguage)).cards;
  }
  async function search(query: TcgSearch): Promise<TcgPage> {
    const selected = language(query.language ?? lang);
    const page = query.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw bad('Invalid Pokémon search page');
    const allowed = new Set(['q', 'language', 'set', 'number', 'page', 'type', 'supertype', 'rarity', 'artist', 'sort']);
    for (const [key, value] of Object.entries(query)) {
      if (!allowed.has(key) || key !== 'page' && value !== undefined && (typeof value !== 'string' || value.length > 180)) throw bad('Invalid Pokémon search field');
    }
    if (query.set) {
      reference(query.set, 'set');
      if (splitId(query.set).lang !== selected) throw bad('Set ID and language disagree');
    }
    if (query.number) {
      if (!query.set || Object.entries(query).some(([key, value]) => !['number', 'set', 'page', 'language'].includes(key) && value)) throw bad('Collector-number search requires only set and language filters');
      const source = await setPage(query.set, selected);
      const cards = source.cards.filter((c) => numberMatches(query.number!, c.number));
      return { cards: cards.slice((page - 1) * 36, page * 36), total: cards.length, hasMore: page * 36 < cards.length, stale: source.stale };
    }
    const sort = query.sort ?? 'newest';
    if (sort !== 'newest' && sort !== 'oldest' && sort !== 'name') throw bad('Unsupported Pokémon search order');
    const filters: SearchFilters = { name: query.q, langs: [selected], setId: query.set,
      types: query.type ? [String(query.type)] : undefined, supertype: query.supertype as string | undefined,
      rarity: query.rarity as string | undefined, artist: query.artist as string | undefined, sort };
    const key = `${prefix}:search:${sha256(JSON.stringify([filters, page]))}`;
    const result = await displayCached(ctx, key, async () => {
      const result = await searchCards(filters, page, undefined, { refresh: true });
      if (!Array.isArray(result.data) || !Number.isSafeInteger(result.totalCount) || result.totalCount < 0 || result.page !== page || result.pageSize !== 36 || result.data.length !== Math.min(36, Math.max(0, result.totalCount - (page - 1) * 36)) || new Set(result.data.map((card) => card.id)).size !== result.data.length)
        throw new HttpError(502, 'Invalid Pokémon search response', 'upstream');
      for (const card of result.data) {
        const normalized = fromPokemon(card, new Date().toISOString());
        if (normalized.language !== selected || query.set && normalized.setId !== query.set) throw new HttpError(502, 'Mismatched Pokémon search response', 'upstream');
      }
      return result;
    });
    const timestamp = ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM http_cache WHERE key = ?', key)!.fetched_at;
    // Complete catalogues remain authoritative when search returns summary records.
    const sets = new Map<string, Map<string, PokemonCard>>();
    const cards = result.data.map((brief) => {
      if (!sets.has(brief.set.id)) sets.set(brief.set.id, new Map((readCatalogCards(ctx.db, brief.set.id) ?? []).map((card) => [card.id, card])));
      const detailKey = `${prefix}:card:${brief.id}`;
      const catalogueCard = sets.get(brief.set.id)!.get(brief.id);
      const full = catalogueCard ?? cachedDetail(ctx, brief.id);
      const metadata = full ? observed(ctx, brief.set.id, detailKey, catalogueCard ? 'catalogue' : 'display') : { at: new Date(timestamp).toISOString(), stale: Date.now() - timestamp >= 6 * HOUR };
      return { ...fromPokemon(full ?? brief, metadata.at), stale: metadata.stale };
    });
    return { cards, total: result.totalCount, hasMore: page * result.pageSize < result.totalCount,
      stale: Date.now() - timestamp >= 6 * HOUR || cards.some((c) => c.stale) };
  }
  return {
    game: 'pokemon', name: 'tcgdex', search, setCards,
    async sets() {
      const sets = await catalogSets(ctx, lang);
      const at = ctx.db.get<{ fetched_at: number }>('SELECT fetched_at FROM catalogue_set_lists WHERE language = ?', lang)!.fetched_at;
      return sets.map((set) => {
        if (splitId(set.id).lang !== lang) throw new HttpError(502, 'Mismatched Pokémon language', 'upstream');
        return { ...pokemonSet(set), fetchedAt: new Date(at).toISOString(), stale: Date.now() - at >= 6 * HOUR };
      });
    },
    async card(id) {
      reference(id, 'card');
      const card = await getCatalogCard(ctx, id);
      if (card.id !== id) throw new HttpError(502, 'Mismatched Pokémon card response', 'upstream');
      const metadata = observed(ctx, card.set.id, `${prefix}:card:${id}`);
      return { ...fromPokemon(card, metadata.at), stale: metadata.stale };
    },
    async resolve(row) {
      if (!row.name || row.name.length > 180 || row.set && row.set.length > 180 || row.number && row.number.length > 180) throw bad('Invalid Pokémon deck reference');
      if (row.set) {
        const sets = (await catalogSets(ctx, lang)).filter((set) => set.id === row.set || set.ptcgoCode?.toUpperCase() === row.set!.toUpperCase() || SET_CODES[splitId(set.id).raw]?.toUpperCase() === row.set!.toUpperCase());
        if (sets.length > 20) throw bad('Ambiguous Pokémon deck set');
        const candidates = [];
        for (const set of sets) candidates.push(...(await setCards(set.id, lang)).filter((card) => row.number ? numberMatches(row.number, card.number) : card.name === row.name));
        return candidates; // Never pick the first of several valid printings.
      }
      const candidates = [];
      for (let page = 1; page <= 14; page++) {
        const result = await search({ q: row.name, language: lang, page });
        candidates.push(...result.cards.filter((card) => card.name === row.name && (!row.number || numberMatches(row.number, card.number))));
        if (!result.hasMore) return candidates;
      }
      throw bad('Pokémon deck lookup exceeded candidate limit');
    },
  };
}
