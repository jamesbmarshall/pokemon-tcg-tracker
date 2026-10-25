import type { PokemonCard } from '../types';
import { resolvePrintings } from '../printings';
import type { CollectibleVariant, TcgCard } from './types';

/** Clone so consumers cannot mutate cached policy evidence or alias lists. */
function checkedVariants(variants: CollectibleVariant[]): CollectibleVariant[] {
  const ids = new Set<string>();
  for (const variant of variants) {
    if (!variant.id || ids.has(variant.id)) throw new Error('Empty or duplicate collectible variant ID');
    ids.add(variant.id);
  }
  return structuredClone(variants);
}

/** Adapt Pokémon records without reclassifying detailed evidence or rewriting keys. */
export function pokemonVariants(card: Pick<PokemonCard, 'id' | 'variants' | 'printings'>): CollectibleVariant[] {
  return checkedVariants(card.printings?.length
    ? card.printings
    : resolvePrintings(card.id, card.variants));
}

/** Older generic records expose availability through finishes. Keep those exact IDs.
 * A finish list proves neither physical size nor completion/release eligibility.
 * This is an internal projection; it does not rewrite caches or public responses.
 */
export function collectibleVariants(card: Pick<TcgCard, 'variants' | 'finishes'>): CollectibleVariant[] {
  if (card.variants !== undefined) return checkedVariants(card.variants);
  return checkedVariants(card.finishes.map((finish) => ({
    id: finish, label: finish, finish, size: 'unknown',
    distribution: 'unknown', status: 'unverified',
  })));
}
