import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PokemonCard } from './types';

const getSetCards = vi.hoisted(() => vi.fn());
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), getSetCards }));

import { markMigrated, migrateVariant, needsMigration, resolveLegacyIds } from './migrate';

const c = (id: string, number: string, name = 'Card') => ({ id, number, name }) as unknown as PokemonCard;

beforeEach(() => getSetCards.mockReset());

describe('provider flag', () => {
  it('needs migration until marked', () => {
    expect(needsMigration()).toBe(true);
    markMigrated();
    expect(localStorage.getItem('poketracker-provider')).toBe('tcgdex');
    expect(needsMigration()).toBe(false);
  });
});

describe('migrateVariant', () => {
  it('maps legacy unlimited keys and passes others through', () => {
    expect(migrateVariant('unlimited')).toBe('normal');
    expect(migrateVariant('unlimitedHolofoil')).toBe('holofoil');
    expect(migrateVariant('reverseHolofoil')).toBe('reverseHolofoil');
  });
});

describe('resolveLegacyIds', () => {
  it('maps legacy set ids and zero-padded numbers', async () => {
    getSetCards.mockResolvedValue([c('sv03.5-006', '006', 'Charizard'), c('sv03.5-007', '007')]);
    const { map, failedSets } = await resolveLegacyIds(['sv3pt5-6'], new Map());
    expect(getSetCards).toHaveBeenCalledWith('sv03.5');
    expect(map.get('sv3pt5-6')).toBe('sv03.5-006');
    expect(failedSets).toBe(0);
  });

  it('keeps ids that already exist and normalises prefixed numbers', async () => {
    getSetCards.mockResolvedValue([c('swsh9-TG01', 'TG01'), c('swsh9-001', '001'), c('swsh9-SV001', 'SV001')]);
    const { map } = await resolveLegacyIds(['swsh9-001', 'swsh9-TG1', 'swsh9-sv1'], new Map());
    expect(map.get('swsh9-001')).toBe('swsh9-001');
    expect(map.get('swsh9-TG1')).toBe('swsh9-TG01');
    expect(map.get('swsh9-sv1')).toBe('swsh9-SV001');
  });

  it('breaks number ties by card name, else takes the first hit', async () => {
    getSetCards.mockResolvedValue([c('x-1a', '1', 'Pikachu'), c('x-1b', '1', 'Raichu')]);
    const names = new Map([['x-1', 'raichu']]);
    expect((await resolveLegacyIds(['x-1'], names)).map.get('x-1')).toBe('x-1b');
    expect((await resolveLegacyIds(['x-1'], new Map())).map.get('x-1')).toBe('x-1a');
  });

  it('counts failed sets once and leaves their ids unmapped', async () => {
    getSetCards.mockImplementation(async (s: string) => {
      if (s === 'base1') throw new Error('offline');
      return [c('sv03-001', '001')];
    });
    const { map, failedSets } = await resolveLegacyIds(['base1-4', 'base1-5', 'sv3-1'], new Map());
    expect(failedSets).toBe(1);
    expect(getSetCards).toHaveBeenCalledTimes(2);
    expect(map.has('base1-4')).toBe(false);
    expect(map.get('sv3-1')).toBe('sv03-001');
  });

  it('omits ids with no matching number', async () => {
    getSetCards.mockResolvedValue([c('sv03-001', '001')]);
    expect((await resolveLegacyIds(['sv03-999'], new Map())).map.size).toBe(0);
  });
});
