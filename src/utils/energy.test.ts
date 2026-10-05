import { describe, expect, it } from 'vitest';
import { ENERGY_TYPES, TYPE_META, typeColor } from './energy';

describe('energy', () => {
  it('has the 11 TCG energy types, each with an icon', () => {
    expect(ENERGY_TYPES).toHaveLength(11);
    for (const t of ENERGY_TYPES) expect(TYPE_META[t].icon).toBeTruthy();
  });
  it('typeColor maps known types and falls back to colorless', () => {
    expect(typeColor('Fire')).toBe('var(--color-fire)');
    expect(typeColor('Unknown')).toBe('var(--color-colorless)');
    expect(typeColor()).toBe('var(--color-colorless)');
  });
});
