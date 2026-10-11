/**
 * TCGdex catalogue provider: the default (and currently only) CatalogProvider implementation.
 * It wraps the shared TCGdex client (which already retries network errors, 5xx and 429 with
 * backoff) with a circuit breaker and health tracking, so repeated outright failures stop
 * hammering a downed TCGdex and show up in the admin providers panel.
 *
 * This provider does not itself serve stale data — callers already have their own fallback
 * (cards.ts keeps the previous snapshot when a refresh batch fails; collections.ts falls back
 * to the last counted set-stats row) — but breaker state here still gates whether a call is
 * attempted at all, which is what makes those fallbacks engage promptly during an outage
 * instead of waiting out a full timeout on every request.
 */
import { getCard, getCardsByIds, getSet, getSetCards, getSets, type Lang } from '@poketracker/shared/catalog';
import type { CardSet, PokemonCard } from '@poketracker/shared/types';
import { withBreaker } from './resilience.ts';
import type { CatalogProvider } from './types.ts';

export const PROVIDER_NAME = 'tcgdex';

export const tcgdexProvider: CatalogProvider = {
  name: PROVIDER_NAME,
  getSets: (lang: Lang = 'en'): Promise<CardSet[]> => withBreaker(PROVIDER_NAME, () => getSets(lang)),
  getSet: (setId: string): Promise<CardSet> => withBreaker(PROVIDER_NAME, () => getSet(setId)),
  getSetCards: (setId: string): Promise<PokemonCard[]> => withBreaker(PROVIDER_NAME, () => getSetCards(setId)),
  getCard: (cardId: string): Promise<PokemonCard> => withBreaker(PROVIDER_NAME, () => getCard(cardId)),
  getCardsByIds: (ids: string[]): Promise<PokemonCard[]> => withBreaker(PROVIDER_NAME, () => getCardsByIds(ids)),
};
