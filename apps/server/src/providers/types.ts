/**
 * Catalogue provider abstraction. TCGdex (tcgdex.ts) is the only implementation today, but
 * routing every catalogue call through this interface means the server's resilience (retry,
 * circuit breaker, stale fallback) and any future second catalogue source live at one seam
 * instead of being wired into every call site by hand.
 */
import type { CardSet, PokemonCard } from '@poketracker/shared/types';
import type { Lang } from '@poketracker/shared/catalog';

export interface CatalogProvider {
  /** Stable id used for health tracking and the admin providers panel. */
  readonly name: string;
  getSets(lang?: Lang): Promise<CardSet[]>;
  getSet(setId: string): Promise<CardSet>;
  getSetCards(setId: string): Promise<PokemonCard[]>;
  getCard(cardId: string): Promise<PokemonCard>;
  getCardsByIds(ids: string[]): Promise<PokemonCard[]>;
}
