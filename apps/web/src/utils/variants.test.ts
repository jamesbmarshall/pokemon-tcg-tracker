import { describe, expect, it } from 'vitest';
import { CONDITIONS, entryKey, isFoil, variantLabel, variantShort } from './variants';

describe('variants', () => {
  it.each([
    ['normal', 'Normal', 'N'],
    ['holofoil', 'Holo', 'H'],
    ['reverseHolofoil', 'Reverse Holo', 'RH'],
    ['1stEditionHolofoil', '1st Ed. Holo', '1H'],
    ['1stEditionNormal', '1st Edition', '1E'],
    ['wPromo', 'W Stamp Promo', 'W'],
  ])('%s → %s / %s', (v, label, short) => {
    expect(variantLabel(v)).toBe(label);
    expect(variantShort(v)).toBe(short);
  });
  it('falls back for unknown variants', () => {
    expect(variantLabel('fooBar')).toBe('Foo Bar');
    expect(variantLabel('pokeballReverse')).toBe('Pokeball Reverse');
    expect(variantShort('fooBar')).toBe('FO');
  });
  it('isFoil matches any holo variant', () => {
    expect(isFoil('holofoil')).toBe(true);
    expect(isFoil('reverseHolofoil')).toBe(true);
    expect(isFoil('1stEditionHolofoil')).toBe(true);
    expect(isFoil('normal')).toBe(false);
    expect(isFoil('wPromo')).toBe(false);
  });
  it('entryKey joins card and variant', () => {
    expect(entryKey('sv03-001', 'normal')).toBe('sv03-001::normal');
  });
  it('lists six conditions from Mint to Damaged', () => {
    expect(CONDITIONS.map((c) => c.value)).toEqual(['M', 'NM', 'LP', 'MP', 'HP', 'DMG']);
  });
});
