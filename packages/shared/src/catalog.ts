/**
 * Catalogue adapter for TCGdex (https://tcgdex.dev): free, open source and keyless.
 * Everything that talks to the card data provider lives here, so the rest of the app only
 * ever sees PokemonCard / CardSet / CardSnapshot.
 */
import type { ApiResponse, CardSet, CardSnapshot, PokemonCard, PriceBlock, PriceSource } from './types';
import { LEGACY_SET_MAP, SET_CODES } from './legacySets';
import { fromEnglishCategory, fromEnglishType, splitId, toEnglishCategory, toEnglishType, withLang, type Lang } from './languages';

export type { Lang } from './languages';

export const TCGDEX_API = 'https://api.tcgdex.net/v2';

let API = TCGDEX_API;
let GRAPHQL = `${TCGDEX_API}/graphql`;
let extraHeaders: () => Record<string, string> = () => ({});
// Only used to convert Cardmarket (EUR) prices to USD when TCGplayer has none.
let eurRate: () => number = () => 0.89;

/**
 * The browser talks to TCGdex through the app server (which caches responses); the server
 * talks to TCGdex directly. `base` is the equivalent of https://api.tcgdex.net/v2.
 */
export function configureCatalog(opts: { base?: string; headers?: () => Record<string, string>; eurPerUsd?: () => number }) {
  if (opts.base) {
    API = opts.base.replace(/\/$/, '');
    GRAPHQL = `${API}/graphql`;
  }
  if (opts.headers) extraHeaders = opts.headers;
  if (opts.eurPerUsd) eurRate = opts.eurPerUsd;
}
/** TCG Pocket (the mobile game) shares the catalogue; it isn't physical cards. */
const DIGITAL_SERIES = new Set(['tcgp']);

// ---------------------------------------------------------------- transport

const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 250));

/**
 * fetch with retries for network errors, 429 and 5xx (up to four attempts with jittered backoff).
 * TCGdex is a free community service and has occasional blips; one should not break a page.
 * Aborted requests are never retried.
 */
async function request<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      const headers = { ...extraHeaders(), ...(init.headers as Record<string, string> | undefined) };
      res = await fetch(url, { ...init, headers, signal });
    } catch (err) {
      if (signal?.aborted || attempt >= 3) throw err;
      await backoff(attempt);
      continue;
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await backoff(attempt);
      continue;
    }
    throw new Error(res.status === 404 ? 'Not found in the card database' : res.status === 429 ? 'Rate limited by the card API — try again shortly.' : `Card API error ${res.status}`);
  }
}

export function rest<T>(path: string, params?: Record<string, string>, signal?: AbortSignal, lang: Lang = 'en'): Promise<T> {
  // In the browser API is a relative path (/api/tcgdex/v2), so it needs the page as a base URL.
  const url = new URL(`${API}/${lang}${path}`, typeof location !== 'undefined' ? location.href : undefined);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  return request<T>(url.toString(), {}, signal);
}

async function gql<T>(query: string, signal?: AbortSignal): Promise<T> {
  const res = await request<{ data?: T; errors?: { message: string }[] }>(
    GRAPHQL,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) },
    signal,
  );
  if (!res.data) throw new Error(res.errors?.[0]?.message ?? 'Card API error');
  return res.data;
}

const str = (s: string) => JSON.stringify(s);
/** GraphQL picks the catalogue language per field via a directive. */
const loc = (lang: Lang) => (lang === 'en' ? '' : ` @locale(lang: ${str(lang)})`);

/** Runs `fn` over `items` with at most `size` in flight, so bulk card fetches don't flood TCGdex. */
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = { status: 'fulfilled', value: await fn(items[i]) };
        } catch (reason) {
          out[i] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- raw shapes

interface RawVariants {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
  wPromo?: boolean;
}

interface RawSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { official?: number; total?: number };
}

interface RawSet extends RawSetBrief {
  releaseDate?: string;
  serie?: { id: string; name: string };
  abbreviation?: { official?: string };
}

interface RawCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  rarity?: string;
  illustrator?: string;
  types?: string[];
  hp?: number;
  stage?: string;
  suffix?: string;
  trainerType?: string;
  energyType?: string;
  evolveFrom?: string;
  description?: string;
  effect?: string;
  regulationMark?: string;
  dexId?: number[];
  abilities?: { type?: string; name: string; effect?: string }[];
  attacks?: { cost?: string[]; name: string; effect?: string; damage?: string | number }[];
  weaknesses?: { type: string; value?: string }[];
  resistances?: { type: string; value?: string }[];
  retreat?: number;
  variants?: RawVariants;
  set?: RawSetBrief;
  pricing?: {
    tcgplayer?: { updated?: string; [variant: string]: unknown };
    cardmarket?: { updated?: string; idProduct?: number; [k: string]: unknown };
  };
}

// ---------------------------------------------------------------- assets

const imageUrl = (base: string | undefined, quality: 'low' | 'high') => (base ? `${base}/${quality}.webp` : '');
const logoUrl = (logo?: string) => (logo ? `${logo}.webp` : '');
// Symbols are only served from the language path as PNG.
const symbolUrl = (symbol: string | undefined, lang: Lang) => (symbol ? `${symbol.replace('/univ/', `/${lang}/`)}.png` : '');

// Reverse of LEGACY_SET_MAP. Several legacy ids can map to one TCGdex set; the first one wins.
const LEGACY_BY_TCGDEX = new Map<string, string>();
for (const [legacy, id] of Object.entries(LEGACY_SET_MAP)) if (!LEGACY_BY_TCGDEX.has(id)) LEGACY_BY_TCGDEX.set(id, legacy);

/**
 * pokemontcg.io's image CDN, used only for the ~1,600 cards TCGdex hasn't scanned yet.
 * Best effort: it may disappear once that API is retired.
 */
export function legacyImageUrl(cardId: string, hires = false): string | undefined {
  const setId = setIdFromCardId(cardId);
  const legacySet = LEGACY_BY_TCGDEX.get(setId);
  if (!legacySet) return undefined;
  const local = cardId.slice(setId.length + 1);
  const num = /^\d+$/.test(local) ? String(Number(local)) : local;
  return `https://images.pokemontcg.io/${legacySet}/${num}${hires ? '_hires' : ''}.png`;
}

// ---------------------------------------------------------------- sets

// Module-level set cache. Cards from listings carry only a brief set, so the full set (release
// date, printed total) is looked up here.
const setIndex = new Map<string, CardSet>();
const loadedLangs = new Set<Lang>();

function toSet(raw: RawSet, lang: Lang = 'en'): CardSet {
  return {
    id: withLang(lang, raw.id),
    name: raw.name,
    series: raw.serie?.name ?? '',
    // 'official' is the number printed on cards (e.g. /198); secret rares push 'total' beyond it.
    printedTotal: raw.cardCount?.official ?? raw.cardCount?.total ?? 0,
    total: raw.cardCount?.total ?? 0,
    releaseDate: raw.releaseDate ?? '',
    updatedAt: raw.releaseDate ?? '',
    ptcgoCode: raw.abbreviation?.official ?? (lang === 'en' ? SET_CODES[raw.id] : undefined),
    images: { logo: logoUrl(raw.logo), symbol: symbolUrl(raw.symbol, lang) },
  };
}

/** Seeds the set index from a cached list so cards can be dated without a request. */
export function primeSets(sets: CardSet[] | undefined, lang: Lang = 'en') {
  if (!sets?.length || loadedLangs.has(lang)) return;
  for (const s of sets) if (!setIndex.has(s.id)) setIndex.set(s.id, s);
  loadedLangs.add(lang);
}

// De-duplicates concurrent getSets() calls, which many components make on first load.
const setsInFlight = new Map<Lang, Promise<CardSet[]>>();

export function getSets(lang: Lang = 'en'): Promise<CardSet[]> {
  let p = setsInFlight.get(lang);
  if (!p) {
    p = gql<{ sets: RawSet[] }>(
      `{ sets${loc(lang)} { id name releaseDate logo symbol serie { id name } cardCount { official total } } }`,
    )
      .then(({ sets }) => {
        const list = sets
          // Drop digital-only and empty (announced but not yet catalogued) sets.
          .filter((s) => !DIGITAL_SERIES.has(s.serie?.id ?? '') && (s.cardCount?.total ?? 0) > 0)
          .map((s) => toSet(s, lang))
          .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name));
        for (const s of list) setIndex.set(s.id, s);
        loadedLangs.add(lang);
        return list;
      })
      .finally(() => setsInFlight.delete(lang));
    setsInFlight.set(lang, p);
  }
  return p;
}

async function ensureSets(lang: Lang = 'en') {
  if (!loadedLangs.has(lang)) await getSets(lang);
  return setIndex;
}

export async function getSet(setId: string): Promise<CardSet> {
  const { lang, raw } = splitId(setId);
  const set = toSet(await rest<RawSet>(`/sets/${encodeURIComponent(raw)}`, undefined, undefined, lang), lang);
  setIndex.set(set.id, { ...setIndex.get(set.id), ...set });
  return set;
}

function setFor(rawCardId: string, brief: RawSetBrief | undefined, lang: Lang): CardSet {
  const rawSetId = brief?.id ?? setIdFromCardId(rawCardId);
  const known = setIndex.get(withLang(lang, rawSetId));
  if (known) return known;
  return toSet({ ...brief, id: rawSetId, name: brief?.name ?? rawSetId }, lang);
}

// ---------------------------------------------------------------- variants & prices

const VARIANT_ORDER = ['normal', '1stEditionNormal', 'holofoil', '1stEditionHolofoil', 'reverseHolofoil', 'wPromo'];

/**
 * Maps TCGdex's variant flags to the variant keys stored in collections (pokemontcg.io names).
 * A first-edition flag on a card with both normal and holo printings yields both 1st Edition
 * variants. With no flags at all, guess from rarity so every card has at least one variant.
 */
function toVariants(v: RawVariants | undefined, rarity?: string): string[] {
  const out: string[] = [];
  if (v?.normal) out.push('normal');
  if (v?.holo) out.push('holofoil');
  if (v?.firstEdition) {
    if (v.normal || !v.holo) out.push('1stEditionNormal');
    if (v.holo) out.push('1stEditionHolofoil');
  }
  if (v?.reverse) out.push('reverseHolofoil');
  if (v?.wPromo) out.push('wPromo');
  if (!out.length) out.push(/holo|rare|ultra|secret|illustration/i.test(rarity ?? '') ? 'holofoil' : 'normal');
  return out.sort((a, b) => VARIANT_ORDER.indexOf(a) - VARIANT_ORDER.indexOf(b));
}

// TCGplayer's price keys (after camel-casing) differ from our variant keys for base-era printings.
const PRICE_KEY_ALIASES: Record<string, string> = {
  unlimited: 'normal',
  unlimitedHolofoil: 'holofoil',
  '1stEdition': '1stEditionNormal',
};
const camel = (k: string) => k.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
// Zero or missing means "no data" in TCGdex pricing, never a real price of zero.
const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);

function toTcgplayer(raw: NonNullable<RawCard['pricing']>['tcgplayer']): PriceSource | undefined {
  if (!raw) return undefined;
  const prices: Record<string, PriceBlock> = {};
  let productId: unknown;
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const p = v as Record<string, unknown>;
    const key = PRICE_KEY_ALIASES[camel(k)] ?? camel(k);
    const block = { low: num(p.lowPrice), mid: num(p.midPrice), high: num(p.highPrice), market: num(p.marketPrice), directLow: num(p.directLowPrice) };
    if (Object.values(block).some((x) => x !== undefined)) prices[key] = block;
    // Every variant block points at the same product page, so the first id found is enough.
    productId ??= p.productId;
  }
  if (!Object.keys(prices).length) return undefined;
  return { url: productId ? `https://www.tcgplayer.com/product/${productId}` : '', updatedAt: raw.updated ?? '', prices };
}

/**
 * Cardmarket reports one non-foil and one "holo" price per product. Map them onto the
 * card's variants: if a non-foil printing exists, foil variants take the holo price;
 * otherwise the card itself is the foil and only the reverse takes the holo price.
 */
function toCardmarket(raw: NonNullable<RawCard['pricing']>['cardmarket'], variants: string[], name: string): PriceSource | undefined {
  if (!raw) return undefined;
  const base: PriceBlock = { low: num(raw.low), mid: num(raw.avg), market: num(raw.trend) ?? num(raw.avg) };
  const holo: PriceBlock = { low: num(raw['low-holo']), mid: num(raw['avg-holo']), market: num(raw['trend-holo']) ?? num(raw['avg-holo']) };
  const has = (b: PriceBlock) => b.market !== undefined || b.low !== undefined;
  const nonFoil = variants.some((v) => !/holo/i.test(v));
  const prices: Record<string, PriceBlock> = {};
  for (const v of variants) {
    const foil = /holo/i.test(v);
    const block = nonFoil ? (foil ? holo : base) : v === 'reverseHolofoil' ? holo : base;
    if (has(block)) prices[v] = block;
  }
  if (!Object.keys(prices).length) return undefined;
  return {
    url: `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`,
    updatedAt: raw.updated ?? '',
    prices,
  };
}

function eurPerUsd(): number {
  const r = eurRate();
  return r > 0 ? r : 0.89;
}

/**
 * Best single market price per variant in USD: TCGplayer, falling back to converted Cardmarket.
 * USD is the base for every stored price; EUR figures are divided by the EUR-per-USD rate.
 */
export function usdPrices(card: Pick<PokemonCard, 'tcgplayer' | 'cardmarket' | 'variants'>): Record<string, number> {
  const out: Record<string, number> = {};
  const rate = eurPerUsd();
  for (const v of new Set([...card.variants, ...Object.keys(card.tcgplayer?.prices ?? {})])) {
    const t = card.tcgplayer?.prices[v];
    const usd = t?.market ?? t?.mid ?? t?.low;
    if (usd) out[v] = usd;
    else {
      const eur = card.cardmarket?.prices[v]?.market;
      // Rounded to cents so converted prices don't show spurious precision.
      if (eur) out[v] = Math.round((eur / rate) * 100) / 100;
    }
  }
  return out;
}

// ---------------------------------------------------------------- cards

const CATEGORY: Record<string, string> = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' };

function toCard(raw: RawCard, detailed: boolean, lang: Lang = 'en'): PokemonCard {
  const variants = toVariants(raw.variants, raw.rarity);
  const category = toEnglishCategory(lang, raw.category ?? '');
  const type = (t: string) => toEnglishType(lang, t);
  const isPokemon = category === 'Pokemon';
  const card: PokemonCard = {
    id: withLang(lang, raw.id),
    name: raw.name,
    supertype: CATEGORY[category] ?? category,
    // TCGdex reports a non-special energy as energyType 'Normal', which isn't a meaningful subtype.
    subtypes: [raw.stage, raw.suffix, raw.trainerType, raw.energyType].filter((x): x is string => !!x && x !== 'Normal'),
    hp: raw.hp ? String(raw.hp) : undefined,
    types: raw.types?.map(type),
    evolvesFrom: raw.evolveFrom,
    // Trainer and Energy text is shown as rules; Pokémon use attacks and abilities instead.
    rules: !isPokemon && raw.effect ? [raw.effect] : undefined,
    abilities: raw.abilities?.map((a) => ({ name: a.name, text: a.effect ?? '', type: a.type ?? 'Ability' })),
    attacks: raw.attacks?.map((a) => ({
      name: a.name,
      cost: a.cost?.map(type) ?? [],
      convertedEnergyCost: a.cost?.length ?? 0,
      damage: a.damage == null ? '' : String(a.damage),
      text: a.effect ?? '',
    })),
    weaknesses: raw.weaknesses?.map((w) => ({ type: type(w.type), value: w.value ?? '' })),
    resistances: raw.resistances?.map((w) => ({ type: type(w.type), value: w.value ?? '' })),
    retreatCost: raw.retreat ? Array(raw.retreat).fill('Colorless') : undefined,
    set: setFor(raw.id, raw.set, lang),
    number: raw.localId,
    rarity: raw.rarity && raw.rarity !== 'None' ? raw.rarity : undefined,
    artist: raw.illustrator,
    flavorText: isPokemon ? raw.description : undefined,
    nationalPokedexNumbers: raw.dexId,
    regulationMark: raw.regulationMark,
    images: { small: imageUrl(raw.image, 'low'), large: imageUrl(raw.image, 'high') },
    variants,
    detailed,
  };
  if (detailed) {
    card.tcgplayer = toTcgplayer(raw.pricing?.tcgplayer);
    card.cardmarket = toCardmarket(raw.pricing?.cardmarket, variants, raw.name);
  }
  return card;
}

const LIST_FIELDS = 'id localId name image category rarity illustrator types hp stage variants { normal reverse holo firstEdition wPromo }';

/** A card with full text and prices. */
export async function getCard(cardId: string): Promise<PokemonCard> {
  const { lang, raw } = splitId(cardId);
  // Best effort: the set list adds release dates, but a card should still load without it.
  await ensureSets(lang).catch(() => undefined);
  return toCard(await rest<RawCard>(`/cards/${encodeURIComponent(raw)}`, undefined, undefined, lang), true, lang);
}

/** Lightweight cards (no text/prices) for many ids in one round trip. Unknown ids are skipped. */
async function getCardsBrief(ids: string[], signal?: AbortSignal): Promise<PokemonCard[]> {
  if (!ids.length) return [];
  const parts = ids.map(splitId);
  // One GraphQL request with an alias per id. Ids go through JSON.stringify so they can't break
  // out of the string literal.
  const body = parts.map(({ lang, raw }, i) => `c${i}: card(id: ${str(raw)})${loc(lang)} { ${LIST_FIELDS} set { id name } }`).join('\n');
  const data = await gql<Record<string, RawCard | null>>(`{ ${body} }`, signal);
  return parts.flatMap(({ lang }, i) => {
    const c = data[`c${i}`];
    return c ? [toCard(c, false, lang)] : [];
  });
}

/** Full cards (with prices) for owned / wishlisted ids. Individual failures are skipped. */
export async function getCardsByIds(ids: string[]): Promise<PokemonCard[]> {
  await Promise.all(Array.from(new Set(ids.map((id) => splitId(id).lang)), (l) => ensureSets(l).catch(() => undefined)));
  const results = await pool(ids, 6, getCard);
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  // Partial failures are tolerated (that card just keeps its old snapshot). Only when everything
  // failed, for a reason other than ids TCGdex no longer knows, is it treated as an outage.
  if (!ok.length && ids.length) {
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure && !String(failure.reason).includes('Not found')) throw failure.reason;
  }
  return ok;
}

/** Every card in a set, in number order. */
export async function getSetCards(setId: string): Promise<PokemonCard[]> {
  const { lang, raw: rawSetId } = splitId(setId);
  const [, raw] = await Promise.all([
    getSet(setId),
    (async () => {
      const all: RawCard[] = [];
      const per = 250;
      // Capped at 19 pages (4,750 cards) as a guard against a pagination bug looping forever.
      for (let page = 1; page < 20; page++) {
        // The id filter is a substring match, so results are filtered to this exact set below.
        const { cards } = await gql<{ cards: RawCard[] }>(
          `{ cards(filters: { id: ${str(`${rawSetId}-`)} }, pagination: { page: ${page}, itemsPerPage: ${per} })${loc(lang)} { ${LIST_FIELDS} } }`,
        );
        all.push(...cards);
        if (cards.length < per) break;
      }
      return all;
    })(),
  ]);
  return raw
    .filter((c) => setIdFromCardId(c.id) === rawSetId)
    .map((c) => toCard(c, false, lang))
    .sort(compareCardNumber);
}

// ---------------------------------------------------------------- search

export interface SearchFilters {
  name?: string;
  types?: string[];
  supertype?: string;
  rarity?: string;
  artist?: string;
  setId?: string;
  sort?: 'newest' | 'oldest' | 'name';
  /** Catalogues to search; defaults to English. */
  langs?: Lang[];
}

interface Brief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

const SEARCH_PAGE = 36;
const matchCache = new Map<string, Promise<Brief[]>>();

function byRelease(sets: Map<string, CardSet>, dir: 1 | -1) {
  return (a: Brief, b: Brief) => {
    const da = sets.get(setIdFromCardId(a.id))?.releaseDate ?? '';
    const db = sets.get(setIdFromCardId(b.id))?.releaseDate ?? '';
    return dir * da.localeCompare(db) || setIdFromCardId(a.id).localeCompare(setIdFromCardId(b.id)) || a.localId.localeCompare(b.localId, undefined, { numeric: true });
  };
}

function searchParams(f: SearchFilters, lang: Lang): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.types?.length) params.types = f.types.map((t) => fromEnglishType(lang, t)).join('|');
  if (f.supertype) {
    const cat = f.supertype.replace('é', 'e');
    // The UI uses 'Pokémon'; TCGdex's English category is 'Pokemon'.
    params.category = lang === 'en' ? cat : fromEnglishCategory(lang, cat);
  }
  // eq: forces an exact match; the default is substring, so "Rare" would also match "Rare Holo".
  if (f.rarity) params.rarity = `eq:${f.rarity}`;
  if (f.artist) params.illustrator = f.artist;
  return params;
}

const dexCache = new Map<string, Promise<number[]>>();

/** Pokédex numbers of English cards matching a name, used to find the same Pokémon in other languages. */
function dexIdsFor(name: string, signal?: AbortSignal): Promise<number[]> {
  const key = name.toLowerCase();
  let hit = dexCache.get(key);
  if (!hit) {
    hit = gql<{ cards: { dexId?: number[] | null }[] }>(`{ cards(filters: { name: ${str(name)} }, pagination: { page: 1, itemsPerPage: 500 }) { dexId } }`, signal).then(({ cards }) =>
      Array.from(new Set(cards.flatMap((c) => c.dexId ?? []))),
    );
    // Failed lookups are evicted so the next search retries instead of caching the error.
    hit.catch(() => dexCache.delete(key));
    dexCache.set(key, hit);
  }
  return hit;
}

// Mechanic suffixes stay in Latin script on Japanese, Chinese and Korean cards ("リザードンex").
const MECHANICS = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'v-union', 'break', 'lv.x', 'prime', 'star', 'δ', 'legend']);
const mechanicTokens = (name: string) => name.toLowerCase().split(/\s+/).filter((t) => MECHANICS.has(t));

async function matchesInLang(f: SearchFilters, lang: Lang, signal?: AbortSignal): Promise<Brief[]> {
  const params = searchParams(f, lang);
  const out: Brief[] = [];
  out.push(...(await rest<Brief[]>('/cards', f.name ? { ...params, name: f.name } : params, signal, lang)));
  // An English name won't match a Japanese or German card, but the Pokédex number will.
  if (lang !== 'en' && f.name && /[a-z]/i.test(f.name)) {
    const dex = (await dexIdsFor(f.name, signal)).slice(0, 8);
    const tokens = mechanicTokens(f.name);
    const lists = await Promise.all(dex.map((d) => rest<Brief[]>('/cards', { ...params, dexId: `eq:${d}` }, signal, lang)));
    for (const c of lists.flat()) if (tokens.every((t) => c.name.toLowerCase().includes(t))) out.push(c);
  }
  return out.map((c) => ({ ...c, id: withLang(lang, c.id) }));
}

/** All matching card ids, physical sets only, sorted. Cached per query so paging is instant. */
function matchingCards(f: SearchFilters, signal?: AbortSignal): Promise<Brief[]> {
  const langs: Lang[] = f.langs?.length ? f.langs : ['en'];
  const key = JSON.stringify([f.name, f.types, f.supertype, f.rarity, f.artist, f.setId, f.sort, langs]);
  let hit = matchCache.get(key);
  if (!hit) {
    hit = (async () => {
      const [, ...lists] = await Promise.all([Promise.all(langs.map((l) => ensureSets(l))), ...langs.map((l) => matchesInLang(f, l, signal))]);
      const seen = new Set<string>();
      const out = lists.flat().filter((c) => {
        // Cards whose set isn't in the index belong to filtered-out (digital) sets.
        if (seen.has(c.id) || !setIndex.has(setIdFromCardId(c.id)) || (f.setId && setIdFromCardId(c.id) !== f.setId)) return false;
        seen.add(c.id);
        return true;
      });
      if (f.sort === 'name') {
        const newest = byRelease(setIndex, -1);
        out.sort((a, b) => a.name.localeCompare(b.name) || newest(a, b));
      } else out.sort(byRelease(setIndex, f.sort === 'oldest' ? 1 : -1));
      return out;
    })();
    hit.catch(() => matchCache.delete(key));
    matchCache.set(key, hit);
    // Keep the cache bounded: evict the oldest query (Map preserves insertion order).
    if (matchCache.size > 30) matchCache.delete(matchCache.keys().next().value!);
  }
  return hit;
}

/** One page of search results. Matching runs once per query; each page then fetches just its cards. */
export async function searchCards(f: SearchFilters, page: number, signal?: AbortSignal): Promise<ApiResponse<PokemonCard[]>> {
  const all = await matchingCards(f, signal);
  const slice = all.slice((page - 1) * SEARCH_PAGE, page * SEARCH_PAGE);
  const cards = await getCardsBrief(slice.map((c) => c.id), signal);
  return { data: cards, page, pageSize: SEARCH_PAGE, totalCount: all.length };
}

export interface Printing {
  id: string;
  name: string;
  number: string;
  image: string;
  setName: string;
  releaseDate: string;
}

/** Other printings of a card name across physical sets, newest first. */
export async function getPrintings(name: string, lang: Lang = 'en'): Promise<Printing[]> {
  const [sets, raw] = await Promise.all([ensureSets(lang), rest<Brief[]>('/cards', { name: `eq:${name}` }, undefined, lang)]);
  return raw
    .map((c) => ({ ...c, id: withLang(lang, c.id) }))
    .filter((c) => sets.has(setIdFromCardId(c.id)))
    .sort(byRelease(sets, -1))
    .map((c) => {
      const s = sets.get(setIdFromCardId(c.id))!;
      return { id: c.id, name: c.name, number: c.localId, image: imageUrl(c.image, 'low'), setName: s.name, releaseDate: s.releaseDate };
    });
}

/** Pocket rarities share the endpoint; these never appear on physical cards. */
const DIGITAL_RARITIES = /diamond|^(one|two|three) (star|shiny)$|^crown$|^none$/i;

export async function getRarities(lang: Lang = 'en'): Promise<string[]> {
  const list = await rest<string[]>('/rarities', undefined, undefined, lang);
  return list.filter((r) => !DIGITAL_RARITIES.test(r));
}

// ---------------------------------------------------------------- helpers

/** A card's collectible variants, never empty: every card can be owned as at least a normal printing. */
export function cardVariants(card: Pick<PokemonCard, 'variants'>): string[] {
  return card.variants?.length ? card.variants : ['normal'];
}

/** Natural sort for card numbers, so 2 comes before 10 and TG2 before TG10. */
export function compareCardNumber(a: { number: string }, b: { number: string }) {
  return a.number.localeCompare(b.number, undefined, { numeric: true });
}

/**
 * Flattens a card into the snapshot stored alongside collections. Listing cards carry no prices,
 * so their snapshot has empty `prices`; the web store's merge keeps any earlier priced snapshot.
 */
export function toSnapshot(card: PokemonCard): CardSnapshot {
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    setId: card.set.id,
    setName: card.set.name,
    series: card.set.series,
    releaseDate: card.set.releaseDate,
    printedTotal: card.set.printedTotal,
    rarity: card.rarity,
    supertype: card.supertype,
    types: card.types,
    artist: card.artist,
    image: card.images.small,
    imageLarge: card.images.large,
    variants: cardVariants(card),
    prices: card.detailed ? usdPrices(card) : {},
    tcgplayerUrl: card.tcgplayer?.url || undefined,
    cardmarketUrl: card.cardmarket?.url,
    syncedAt: new Date().toISOString(),
  };
}

/** Set id from a card id. Uses the last '-' because set ids may themselves contain one. */
export function setIdFromCardId(cardId: string): string {
  return cardId.slice(0, cardId.lastIndexOf('-'));
}
