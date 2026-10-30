import type { TcgProvider } from '@poketracker/shared/tcg/types';
import { bad, type Ctx } from '../context.ts';

/** Source-owned factories, not a loader for external code. IDs are scoped by game. */
export interface ProviderRegistration {
  id: string;
  game: string;
  create(ctx: Ctx, language?: string): TcgProvider;
  ownsCardId(id: string): boolean;
  ownsSetId(id: string): boolean;
}
export interface StoredProviderReference {
  game: string;
  id: string;
  /** Required when historical ID namespaces overlap. Never guess a conversion. */
  provider?: string;
}
export type ProviderSelection = (ctx: Ctx, game: string, language?: string) => string | undefined;

export function createProviderRegistry(registrations: ProviderRegistration[], select: ProviderSelection) {
  const byGame = new Map<string, Map<string, Readonly<ProviderRegistration>>>();
  for (const registration of registrations) {
    if (!/^[a-z][a-z0-9-]*$/.test(registration.id) || !/^[a-z][a-z0-9-]*$/.test(registration.game))
      throw new Error('Invalid provider registration ID');
    const providers = byGame.get(registration.game) ?? new Map<string, Readonly<ProviderRegistration>>();
    if (providers.has(registration.id)) throw new Error('Duplicate provider registration');
    if ([registration.create, registration.ownsCardId, registration.ownsSetId].some((handler) => typeof handler !== 'function'))
      throw new Error('Incomplete provider registration');
    providers.set(registration.id, Object.freeze({ ...registration }));
    byGame.set(registration.game, providers);
  }
  function instantiate(ctx: Ctx, registration: ProviderRegistration, language?: string): TcgProvider {
    const provider = registration.create(ctx, language);
    if (!provider || provider.game !== registration.game || typeof provider.name !== 'string' || !provider.name.trim() ||
      [provider.sets, provider.search, provider.card, provider.setCards].some((handler) => typeof handler !== 'function') ||
      provider.resolve !== undefined && typeof provider.resolve !== 'function')
      throw new Error('Invalid provider factory result');
    return provider;
  }
  function stored(ctx: Ctx, reference: StoredProviderReference, kind: 'card' | 'set'): TcgProvider {
    const { game, id, provider } = reference;
    if (typeof id !== 'string' || !id.trim() || id.length > 180 || [...id].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
      throw bad('Invalid stored catalogue reference', 'provider_reference');
    const candidates = [...(byGame.get(game)?.values() ?? [])].filter((registration) =>
      (provider === undefined || provider === registration.id) &&
      (kind === 'card' ? registration.ownsCardId(id) : registration.ownsSetId(id)) === true,
    );
    if (candidates.length !== 1)
      throw bad(candidates.length ? 'Ambiguous stored catalogue reference' : 'No provider owns this catalogue reference', 'provider_reference');
    return instantiate(ctx, candidates[0]);
  }
  return {
    catalogue(ctx: Ctx, game: string, language?: string) {
      const id = select(ctx, game, language);
      const registration = id === undefined ? undefined : byGame.get(game)?.get(id);
      if (!registration) throw bad('No catalogue provider for this game', 'provider_unavailable');
      return instantiate(ctx, registration, language);
    },
    forCard: (ctx: Ctx, reference: StoredProviderReference) => stored(ctx, reference, 'card'),
    forSet: (ctx: Ctx, reference: StoredProviderReference) => stored(ctx, reference, 'set'),
  };
}
