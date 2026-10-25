import { describe, expect, it } from 'vitest';
import { setProgress } from './completion';
import type { CardPrinting, PokemonCard } from './types';

// Synthetic baseline: the same finish can identify different physical printings.
// Expected counts are specified independently of the completion implementation.
function printing(id: string, role: CardPrinting['role']): CardPrinting {
  return { id, label: id, finish: 'holo', size: 'standard', distribution: 'unknown', status: 'verified', role };
}
function card(id: string, number: string, printings: CardPrinting[]): PokemonCard {
  return {
    id, number, name: id, supertype: 'Pokémon',
    set: { id: 'baseline', name: 'Synthetic baseline', series: 'Test', printedTotal: 2, total: 3, releaseDate: '2026-01-01', updatedAt: '', images: { symbol: '', logo: '' } },
    images: { small: '', large: '' }, variants: printings.map((p) => p.id), printings, printingCoverage: 'complete',
  };
}
const cards = [
  card('baseline-001', '001', [printing('regular', 'core'), printing('parallel', 'parallel'), printing('stamped', 'additional')]),
  card('baseline-002', '002', [{ ...printing('unknown', 'unresolved'), status: 'unverified' }]),
  card('baseline-003', '003', [printing('secret', 'core')]),
];

describe('Pokémon completion preservation baseline', () => {
  it('keeps physical slots distinct and excludes additional/unresolved copies from eligible completion', () => {
    const holdings = new Map<string, Record<string, number>>([
      ['baseline-001', { stamped: 2 }],
      ['baseline-002', { unknown: 1 }],
      ['baseline-003', { secret: 1 }],
    ]);
    expect(setProgress(cards, holdings)).toEqual({
      base: { owned: 0, total: 2 }, full: { owned: 1, total: 3 },
      master: { owned: 1, total: 3 }, all: { owned: 3, total: 5 },
      provisional: true, unresolved: 1, additional: 1, coverageComplete: true,
    });
  });

  it('counts slots rather than quantities and preserves results when catalogue order changes', () => {
    const holdings = new Map([['baseline-001', { regular: 12, parallel: 1 }]]);
    const result = setProgress(cards, holdings);
    expect(result.base).toEqual({ owned: 1, total: 2 });
    expect(result.master).toEqual({ owned: 2, total: 3 });
    expect(setProgress([...cards].reverse(), holdings)).toEqual(result);
  });

  it('reports incomplete evidence independently from ownership and preserves empty denominators', () => {
    expect(setProgress([{ ...cards[0], printingCoverage: 'partial' }], new Map()).coverageComplete).toBe(false);
    expect(setProgress([], new Map())).toEqual({
      base: { owned: 0, total: 0 }, full: { owned: 0, total: 0 },
      master: { owned: 0, total: 0 }, all: { owned: 0, total: 0 },
      provisional: false, unresolved: 0, additional: 0, coverageComplete: true,
    });
  });
});
