import { describe, expect, it } from 'vitest';
import { createGameRegistry, games, GameCapabilityError, magicModule, pokemonModule } from './registry';
import type { GameModule } from './types';

describe('source-owned game module contracts', () => {
  it('keeps compatibility explicit and existing registry exports stable', () => {
    expect(games.require('pokemon')).toBe(pokemonModule);
    expect(games.require('mtg')).toBe(magicModule);
    expect(pokemonModule.compatibility?.reason).toContain('controllers');
    expect(magicModule.completionReport?.([], [], [], false).coverage.complete).toBe(false);
  });

  it('supports a third game with absent capabilities and controlled capability errors', () => {
    const module: GameModule = { ...magicModule, id: 'example', capabilities: { decks: false, scanning: false, graded: false, sealed: false }, formats: [], deckTools: undefined, sealedTypes: [] };
    const registry = createGameRegistry([module]);
    expect(registry.all()).toEqual([module]);
    expect(() => registry.requireCapability('example', 'decks')).toThrow(GameCapabilityError);
    expect(() => registry.requireCapability('example', 'scanning')).toThrow('does not support');
    expect(games.requireCapability('mtg', 'decks')).toBe(magicModule);
    expect(() => registry.requireCapability('unknown', 'decks')).toThrow('Unsupported game');
  });

  it.each([
    { formats: [], deckTools: undefined },
    { languages: [] },
    { languages: [{ code: 'en', name: 'English' }, { code: 'en', name: 'Duplicate' }] },
    { searchFields: [{ key: 'type', label: 'A' }, { key: 'type', label: 'B' }] },
    { formats: [...magicModule.formats, ...magicModule.formats] },
    { sealedTypes: [] },
    { preconCatalogue: undefined },
    { compatibility: { reason: '' } },
  ])('rejects invalid advertised configuration %#', (patch) => {
    expect(() => createGameRegistry([{ ...magicModule, ...patch }])).toThrow();
  });

  it('rejects missing runtime handlers despite TypeScript assertions', () => {
    // Simulates malformed source registration at a JS boundary.
    const invalid = { ...magicModule, scan: undefined } as unknown as GameModule;
    expect(() => createGameRegistry([invalid])).toThrow('scanning requires a parser');
    expect(() => createGameRegistry([{ ...magicModule, complete: undefined } as unknown as GameModule])).toThrow('missing completion policy');
    expect(() => createGameRegistry([{ ...magicModule, completionReport: 'invalid' } as unknown as GameModule])).toThrow('invalid completion report policy');
    expect(() => createGameRegistry([{ ...magicModule, formats: [{ ...magicModule.formats[0], validate: undefined }] } as unknown as GameModule])).toThrow('missing format validator');
  });

  it('retains registry isolation when a separate extension is registered', () => {
    const registry = createGameRegistry([...games.all(), { ...magicModule, id: 'extension' }]);
    expect(registry.require('extension').id).toBe('extension');
    expect(games.get('extension')).toBeUndefined();
  });
});
