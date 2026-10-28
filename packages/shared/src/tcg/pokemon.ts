/** Lossless projections of the existing Pokémon catalogue. Never a storage migration. */
import type { CardSet, PokemonCard, PriceSource } from '../types';
import { splitId, isLang } from '../languages';
import { pokemonVariants } from './variants';
import type { PokemonTcgCard, Quote, TcgSet } from './types';

/** Historical English IDs stay bare; other catalogues retain their language prefix. */
export function pokemonReference(id: string, kind: 'card' | 'set'): boolean {
  if (typeof id !== 'string' || id.length > 180) return false;
  const colon = id.indexOf(':');
  if (colon >= 0 && !isLang(id.slice(0, colon))) return false;
  const { raw } = splitId(id);
  if (raw.includes('..')) return false;
  return kind === 'card' ? /^[A-Za-z0-9][A-Za-z0-9.-]*-[A-Za-z0-9]+$/.test(raw)
    : /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(raw) && !raw.includes('..');
}

export function pokemonSet(set: CardSet): TcgSet {
  if (!set || !pokemonReference(set.id, 'set') || typeof set.name !== 'string' ||
    !Number.isSafeInteger(set.total) || set.total < 0 || typeof set.releaseDate !== 'string')
    throw new Error('Invalid Pokémon set data');
  return { game: 'pokemon', id: set.id, providerId: splitId(set.id).raw,
    code: set.ptcgoCode ?? '', name: set.name, releaseDate: set.releaseDate,
    total: set.total, type: set.series, details: { ...structuredClone(set), kind: 'pokemon' } };
}

/** Preserve source currency, timestamp and URL, including real zero prices. */
function quotes(source: PriceSource | undefined, currency: Quote['currency'], name: string, prices: Record<string, Quote[]>) {
  if (!source) return;
  if (typeof source.updatedAt !== 'string' || typeof source.url !== 'string' || !source.prices || typeof source.prices !== 'object' || Array.isArray(source.prices))
    throw new Error('Invalid Pokémon price source');
  for (const [variant, block] of Object.entries(source.prices)) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('Invalid Pokémon price block');
    for (const value of Object.values(block)) if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid Pokémon quote');
    const amount = block.market ?? block.mid ?? block.low;
    if (amount === undefined) continue;
    // Use own properties so a provider-supplied variant cannot address Object.prototype.
    if (!Object.hasOwn(prices, variant)) Object.defineProperty(prices, variant, { value: [], enumerable: true, writable: true, configurable: true });
    prices[variant].push({ amount, currency, source: name, at: source.updatedAt, url: source.url });
  }
}

export function fromPokemon(card: PokemonCard, fetchedAt: string): PokemonTcgCard {
  if (!card || !pokemonReference(card.id, 'card') || typeof card.name !== 'string' ||
    typeof card.number !== 'string' || !card.images || typeof card.images.small !== 'string' || typeof card.images.large !== 'string' ||
    !Array.isArray(card.variants) || card.variants.some((v) => typeof v !== 'string') ||
    !['Pokémon', 'Trainer', 'Energy'].includes(card.supertype) || !Number.isFinite(Date.parse(fetchedAt)))
    throw new Error('Invalid Pokémon card data');
  pokemonSet(card.set);
  const { lang, raw } = splitId(card.id);
  if (splitId(card.set.id).lang !== lang || raw.slice(0, raw.lastIndexOf('-')) !== splitId(card.set.id).raw)
    throw new Error('Mismatched Pokémon set membership');
  const { id, name, number, rarity, artist, variants, printings, ...details } = structuredClone(card);
  const prices: Record<string, Quote[]> = {};
  quotes(card.tcgplayer, 'USD', 'tcgplayer', prices);
  quotes(card.cardmarket, 'EUR', 'cardmarket', prices);
  return { game: 'pokemon', id, providerId: raw, identity: id, name, printedName: name,
    setId: card.set.id, setName: card.set.name, setCode: card.set.ptcgoCode ?? '', number,
    language: lang, rarity: rarity ?? '', artist: artist ?? '', image: card.images.large || card.images.small,
    faces: [], finishes: variants, variants: pokemonVariants({ id, variants, printings }), treatments: [],
    extra: false, paper: true, prices, fetchedAt, details: { ...details, kind: 'pokemon' } };
}
