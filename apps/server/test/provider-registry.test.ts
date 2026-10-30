import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TcgProvider } from '@poketracker/shared/tcg/types';
import { createProviderRegistry, type ProviderRegistration, type ProviderSelection } from '../src/tcg/providerRegistry.ts';
import { providerFor, providerForCard, providerForSet } from '../src/tcg/provider.ts';
import { startServer, type TestServer } from './helpers.ts';

let s: TestServer;
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected upstream request'); }));
  s = await startServer();
});
afterEach(async () => { await s.close(); vi.unstubAllGlobals(); });

function registration(id: string, game = 'example', prefix = `${id}:`): ProviderRegistration {
  return { id, game, ownsCardId: (value) => value.startsWith(prefix), ownsSetId: (value) => value.startsWith(`${prefix}set-`),
    create: vi.fn((): TcgProvider => ({
      game, name: id, sets: async () => [], search: async () => ({ cards: [], total: 0, hasMore: false }),
      card: async () => { throw new Error('No card requested in this fixture'); }, setCards: async () => [],
    })),
  };
}

describe('source-owned provider selection and reference dispatch', () => {
  it('selects new catalogues by configuration/language while stored IDs keep their original provider', () => {
    let selected = 'old';
    const old = registration('old'), next = registration('next');
    const select = vi.fn<ProviderSelection>((_ctx, _game, language) => language === 'ja' ? 'next' : selected);
    const registry = createProviderRegistry([old, next], select);
    expect(registry.catalogue(s.ctx, 'example').name).toBe('old');
    expect(registry.catalogue(s.ctx, 'example', 'ja').name).toBe('next');
    expect(next.create).toHaveBeenLastCalledWith(s.ctx, 'ja');
    selected = 'next';
    expect(registry.catalogue(s.ctx, 'example').name).toBe('next');
    select.mockClear();
    expect(registry.forCard(s.ctx, { game: 'example', id: 'old:001' }).name).toBe('old');
    expect(registry.forSet(s.ctx, { game: 'example', id: 'old:set-one' }).name).toBe('old');
    expect(select).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects ambiguous references unless explicitly and correctly attributed', () => {
    const old = registration('old', 'example', 'shared:'), next = registration('next', 'example', 'shared:');
    const registry = createProviderRegistry([old, next], () => 'next');
    expect(() => registry.forCard(s.ctx, { game: 'example', id: 'shared:001' })).toThrow('Ambiguous');
    expect(old.create).not.toHaveBeenCalled(); expect(next.create).not.toHaveBeenCalled();
    expect(registry.forCard(s.ctx, { game: 'example', id: 'shared:001', provider: 'old' }).name).toBe('old');
    expect(() => registry.forCard(s.ctx, { game: 'example', id: 'unrelated:001', provider: 'old' })).toThrow('No provider owns');
  });

  it('isolates games even when provider IDs or card IDs overlap', () => {
    const registry = createProviderRegistry([registration('common', 'one'), registration('common', 'two')], () => 'common');
    expect(registry.forCard(s.ctx, { game: 'two', id: 'common:001' }).game).toBe('two');
    expect(() => registry.forCard(s.ctx, { game: 'unknown', id: 'common:001' })).toThrow('No provider owns');
    expect(() => registry.catalogue(s.ctx, 'unknown')).toThrow('No catalogue provider');
  });

  it.each(['', ' ', 'x'.repeat(181), 'old:bad\nreference'])('rejects an invalid stored reference before construction: %#', (id) => {
    const factory = registration('old');
    const registry = createProviderRegistry([factory], () => 'old');
    expect(() => registry.forCard(s.ctx, { game: 'example', id })).toThrow('Invalid stored catalogue');
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate or malformed source registration and invalid factory results', () => {
    const factory = registration('old');
    expect(() => createProviderRegistry([factory, factory], () => 'old')).toThrow('Duplicate');
    expect(() => createProviderRegistry([{ ...factory, id: '../provider' }], () => 'old')).toThrow('Invalid');
    expect(() => createProviderRegistry([{ ...factory, ownsCardId: undefined } as unknown as ProviderRegistration], () => 'old')).toThrow('Incomplete');
    const wrongGame = { ...factory, create: () => ({ ...factory.create(s.ctx), game: 'another' }) };
    expect(() => createProviderRegistry([wrongGame], () => 'old').catalogue(s.ctx, 'example')).toThrow('Invalid provider factory');
    const missingHandler = { ...factory, create: () => ({ ...factory.create(s.ctx), search: undefined }) as unknown as TcgProvider };
    expect(() => createProviderRegistry([missingHandler], () => 'old').catalogue(s.ctx, 'example')).toThrow('Invalid provider factory');
  });

  it('copies registration metadata and fails closed for an unavailable configured provider', () => {
    const factory = registration('old'), registrations = [factory];
    const registry = createProviderRegistry(registrations, () => 'old');
    factory.id = 'changed'; registrations.length = 0;
    expect(registry.catalogue(s.ctx, 'example').name).toBe('old');
    expect(() => createProviderRegistry([registration('old')], () => 'unregistered').catalogue(s.ctx, 'example')).toThrow('No catalogue provider');
  });

  it('retains production Scryfall selection and rejects cross-game/URL references without HTTP', () => {
    expect(providerFor(s.ctx, 'mtg', 'ja').name).toBe('scryfall');
    expect(providerForCard(s.ctx, 'mtg', 'mtg:11111111-1111-4111-8111-111111111111').game).toBe('mtg');
    expect(providerForSet(s.ctx, 'mtg', 'mtg:tst').game).toBe('mtg');
    expect(() => providerForCard(s.ctx, 'pokemon', 'mtg:11111111-1111-4111-8111-111111111111')).toThrow('No provider owns');
    expect(() => providerForCard(s.ctx, 'mtg', 'https://internal.test/card')).toThrow('No provider owns');
    expect(() => providerForSet(s.ctx, 'mtg', 'mtg:../../private')).toThrow('No provider owns');
    expect(fetch).not.toHaveBeenCalled();
  });
});
