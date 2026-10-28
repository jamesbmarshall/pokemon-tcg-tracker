import { describe, expect, it } from 'vitest';
import { fromPokemon, pokemonReference, pokemonSet } from './pokemon';
import type { PokemonCard } from '../types';

function fixture(id = 'sv01-001'): PokemonCard {
  const setId = id.slice(0, id.lastIndexOf('-'));
  return { id, name: 'Example', number: '001', supertype: 'Pokémon', subtypes: ['Basic'], detailed: true,
    set: { id: setId, name: 'Example set', series: 'Example series', total: 1, printedTotal: 1, releaseDate: '2026-01-01', updatedAt: '2026-02-01', ptcgoCode: 'SVI', images: { logo: 'logo', symbol: 'symbol' } },
    images: { small: 'small', large: 'large' }, variants: ['normal'],
    rules: ['Rule'], attacks: [{ name: 'Attack', cost: ['Fire'], convertedEnergyCost: 1, damage: '20', text: 'Text' }],
    legal: { standard: false }, regulationMark: 'G', printingCoverage: 'partial',
    tcgplayer: { url: 'https://example.com/us', updatedAt: '2026-02-01', provenance: { normal: { url: 'https://example.com/us', updatedAt: '2026-02-01' } }, prices: { normal: { market: 0, mid: 2, low: 1, high: 4, directLow: 1 } } },
    cardmarket: { url: 'https://example.com/eu', updatedAt: '2026-02-02', provenance: { normal: { url: 'https://example.com/eu', updatedAt: '2026-02-02' } }, prices: { normal: { market: 3 } } } };
}

describe('Pokémon catalogue projections', () => {
  it.each(['sv01-001', 'ja:SV4a-001', 'fr:sv01-001', 'zh-tw:sv01-001'])('preserves historical identity and every source detail: %s', (id) => {
    const source = fixture(id), before = structuredClone(source);
    const result = fromPokemon(source, '2026-03-01');
    expect(result.id).toBe(id); expect(result.identity).toBe(id);
    expect(result.number).toBe('001'); expect(result.details.set).toEqual(source.set);
    const { id: originalId, name, number, variants, rarity, artist, printings, ...details } = source;
    expect(result.details).toEqual({ ...details, kind: 'pokemon' });
    expect([result.id, result.name, result.number, result.finishes, result.rarity, result.artist]).toEqual([originalId, name, number, variants, rarity ?? '', artist ?? '']);
    expect(printings).toBeUndefined();
    expect(result.prices.normal).toEqual([
      { amount: 0, currency: 'USD', source: 'tcgplayer', at: '2026-02-01', url: 'https://example.com/us' },
      { amount: 3, currency: 'EUR', source: 'cardmarket', at: '2026-02-02', url: 'https://example.com/eu' },
    ]);
    result.details.set.images.logo = 'changed'; result.details.attacks![0].cost.push('Water');
    expect(source).toEqual(before);
  });
  it('retains physical evidence and never invents missing prices', () => {
    const source = fixture();
    source.printings = [{ id: 'stamped', label: 'Stamped', finish: 'holo', size: 'standard', stamp: 'event', legacyAliases: ['old'], raw: { type: 'holo', stamp: 'event' }, status: 'verified', distribution: 'unknown' }];
    const result = fromPokemon(source, '2026-03-01');
    expect(result.variants).toEqual(source.printings);
    expect(result.prices.stamped).toBeUndefined();
    expect(result.details.tcgplayer).toEqual(source.tcgplayer);
    expect(pokemonSet(source.set)).toMatchObject({ id: source.set.id, total: 1, code: 'SVI' });
  });
  it.each(['https://internal/card', 'xx:sv01-001', 'mtg:abc-001', '../sv01-001', 'sv01-001\n', 'sv01%2f-001'])('rejects unsafe or foreign IDs: %s', (id) => {
    expect(pokemonReference(id, 'card')).toBe(false);
  });
  it('rejects malformed quotes and mismatched set/language evidence', () => {
    const source = fixture();
    expect(() => fromPokemon({ ...source, set: { ...source.set, id: 'ja:sv01' } }, '2026-03-01')).toThrow('Mismatched');
    source.tcgplayer!.prices.normal.market = NaN;
    expect(() => fromPokemon(source, '2026-03-01')).toThrow('quote');
  });
  it.each([
    ['name', ''],
    ['name', '   '],
    ['number', ''],
    ['number', ' \t '],
  ])('rejects an empty or whitespace-only %s', (field, value) => {
    const source = fixture();
    expect(() => fromPokemon({ ...source, [field]: value } as PokemonCard, '2026-03-01')).toThrow('Invalid Pokémon card');
  });
  it('does not treat prototype-shaped variant names as object properties', () => {
    const source = fixture();
    source.tcgplayer!.prices = JSON.parse('{"__proto__":{"market":2}}');
    expect(fromPokemon(source, '2026-03-01').prices['__proto__'][0].amount).toBe(2);
    expect(Object.hasOwn({}, 'amount')).toBe(false);
  });
  it('keeps prices but does not invent per-printing provenance for old flattened caches', () => {
    const source = fixture();
    delete source.tcgplayer!.provenance;
    delete source.cardmarket!.provenance;
    const result = fromPokemon(source, '2026-03-01');
    expect(result.prices.normal).toEqual([
      { amount: 0, currency: 'USD', source: 'tcgplayer', at: '' },
      { amount: 3, currency: 'EUR', source: 'cardmarket', at: '' },
    ]);
    expect(result.details.tcgplayer).toEqual(source.tcgplayer);
  });
  it('rejects malformed physical-variant display fields', () => {
    const source = fixture();
    const valid = fromPokemon(source, '2026-03-01').variants[0];
    source.printings = [{ ...valid, label: {} } as unknown as typeof valid];
    expect(() => fromPokemon(source, '2026-03-01')).toThrow('Invalid Pokémon variant');
  });
});
