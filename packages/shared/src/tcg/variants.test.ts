import { describe, expect, it } from 'vitest';
import { pokemonVariants, collectibleVariants } from './variants';
import { holdingId, cardValue } from './collection';
import { fromScryfall } from './scryfall';
import type { CollectibleVariant } from './types';

const detailed: CollectibleVariant = {
  id: 'stamped_physical', label: 'Stamped', finish: 'holo', size: 'standard', stamp: 'campaign', edition: 'first',
  distribution: 'unknown', status: 'inferred', role: 'additional', dataQuality: 'detailed', providerId: 'source-1',
  legacyAliases: ['old'], raw: { type: 'holo', stamp: ['campaign'], foil: 'pattern' },
  decision: { policyVersion: 2, rule: 'R20', reason: 'Synthetic evidence', products: ['product-1'], peers: 12 },
  productIds: { tcgplayer: 12, cardmarket: 34 }, evidence: 'Synthetic', sourceProduct: 'product-1',
};

describe('lossless collectible variant contracts', () => {
  it('preserves physical distinctions, all evidence and historical ownership keys', () => {
    const regular = { ...detailed, id: 'regular', stamp: undefined, role: 'core' as const };
    const card = { id: 'legacy-001', variants: ['old'], printings: [regular, detailed] };
    const result = pokemonVariants(card);
    expect(result).toEqual([regular, detailed]);
    expect(result.map((v) => holdingId(card.id, v.id))).toEqual(['legacy-001::regular', 'legacy-001::stamped_physical']);
    result[1].legacyAliases!.push('mutated');
    result[1].raw!.stamp = 'changed';
    result[1].decision!.products!.push('changed');
    expect(card.printings[1]).toEqual(detailed);
    expect(detailed.legacyAliases).toEqual(['old']);
    expect(detailed.raw!.stamp).toEqual(['campaign']);
    expect(detailed.decision!.products).toEqual(['product-1']);
  });

  it('keeps summary-only Pokémon data provisional without inventing detailed evidence', () => {
    const result = pokemonVariants({ id: 'ja:synthetic-001', variants: ['normal', 'unfamiliar'], printings: [] });
    expect(result.map((v) => v.id)).toEqual(['normal', 'unfamiliar']);
    expect(result.every((v) => v.status === 'unverified' && v.role === 'unresolved')).toBe(true);
    expect(result.every((v) => v.providerId === undefined && v.productIds === undefined)).toBe(true);
  });

  it('preserves Magic identity, finishes and exact quote indexing through a compatibility projection', () => {
    const card = fromScryfall({ id: 'synthetic', oracle_id: 'identity', name: 'Synthetic', lang: 'ja', set: 'tst', set_name: 'Test', collector_number: '001', games: ['paper'], finishes: ['nonfoil', 'foil', 'etched'], prices: { usd: '0', usd_foil: null, usd_etched: '7' } }, '2026-01-01');
    const before = structuredClone(card);
    const variants = collectibleVariants(card);
    expect(variants.map((v) => holdingId(card.id, v.id))).toEqual(['mtg:synthetic::nonfoil', 'mtg:synthetic::foil', 'mtg:synthetic::etched']);
    expect(cardValue(card, variants[0].id)).toBe(0);
    expect(cardValue(card, variants[1].id)).toBeUndefined();
    expect(cardValue(card, variants[2].id)).toBe(7);
    expect(variants.every((v) => v.role === undefined && v.size === 'unknown')).toBe(true);
    expect(card).toEqual(before);
  });

  it('honors explicit empty/detailed variants instead of unioning summary finishes', () => {
    expect(collectibleVariants({ finishes: ['foil'], variants: [] })).toEqual([]);
    expect(collectibleVariants({ finishes: ['foil'], variants: [detailed] })).toEqual([detailed]);
  });

  it('rejects ambiguous duplicate identities before they can collapse ownership', () => {
    expect(() => collectibleVariants({ finishes: ['foil', 'foil'] })).toThrow('duplicate');
    expect(() => pokemonVariants({ id: 'card', variants: [], printings: [detailed, detailed] })).toThrow('duplicate');
    expect(() => collectibleVariants({ finishes: [''] })).toThrow('Empty');
  });
});
