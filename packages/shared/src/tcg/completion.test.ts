import { describe, expect, it } from 'vitest';
import type { PokemonCard } from '../types';
import { fromScryfall } from './scryfall';
import { pokemonCompletionReport, catalogCompletionReport } from './completion';
import type { Slab } from './types';

const pokemon: PokemonCard = {
  id: 'baseline-001', name: 'Synthetic', number: '001', supertype: 'Pokémon',
  images: { small: '', large: '' },
  set: { id: 'baseline', name: 'Baseline', series: 'Test', total: 1, printedTotal: 1, releaseDate: '', updatedAt: '', images: { symbol: '', logo: '' } },
  variants: ['regular', 'stamped'], printingCoverage: 'complete',
  printings: [
    { id: 'regular', label: 'Regular', finish: 'holo', size: 'standard', role: 'core', distribution: 'unknown', status: 'verified' },
    { id: 'stamped', label: 'Stamped', finish: 'holo', size: 'standard', role: 'additional', distribution: 'unknown', status: 'verified' },
  ],
};
const magic = fromScryfall({ id: 'one', oracle_id: 'shared', name: 'Synthetic', set: 'tst', set_name: 'Test', collector_number: '001', lang: 'en', games: ['paper'], finishes: ['nonfoil', 'foil'] }, '2026-01-01');

describe('extensible completion reports', () => {
  it('retains Pokémon policy while separating eligible and all-printing measures', () => {
    expect(pokemonCompletionReport([pokemon], new Map([['baseline-001', { stamped: 3 }]]), true)).toEqual({
      measures: [
        { key: 'base', label: 'Base', owned: 0, total: 1, complete: false },
        { key: 'full', label: 'Full', owned: 0, total: 1, complete: false },
        { key: 'master', label: 'Master', owned: 0, total: 1, complete: false },
        { key: 'all', label: 'All printings', owned: 1, total: 2, complete: false },
      ],
      coverage: { complete: true, provisional: false, unresolved: 0, additional: 1 },
    });
  });

  it('keeps full ownership distinct from partial catalogue coverage and provisional evidence', () => {
    const partial = { ...pokemon, printingCoverage: 'partial' as const, printings: pokemon.printings!.map((p) => ({ ...p, status: 'inferred' as const })) };
    const result = pokemonCompletionReport([partial], new Map([['baseline-001', { regular: 1, stamped: 1 }]]), true);
    expect(result.measures.every((m) => m.complete)).toBe(true);
    expect(result.coverage).toEqual({ complete: false, provisional: true, unresolved: 0, additional: 1 });
    expect(pokemonCompletionReport([pokemon], new Map(), false).coverage.complete).toBe(false);
  });

  it('counts Magic identities, reprints and finishes independently, including eligible slabs', () => {
    const reprint = { ...magic, id: 'mtg:two' };
    const slab: Slab = { id: 'slab', cardId: reprint.id, finish: 'foil', company: 'PSA', grade: '10', countsTowardSet: true, addedAt: '' };
    const report = catalogCompletionReport([magic, reprint], [
      { id: 'entry', cardId: magic.id, finish: 'nonfoil', quantity: 4, addedAt: '' },
    ], [slab, { ...slab, id: 'excluded', cardId: magic.id, countsTowardSet: false }], false);
    expect(report).toEqual({ measures: [
      { key: 'cards', label: 'Distinct cards', owned: 1, total: 1, complete: true },
      { key: 'printings', label: 'Printings', owned: 2, total: 2, complete: true },
      { key: 'finishes', label: 'Finishes', owned: 2, total: 4, complete: false },
    ], coverage: { complete: false } });
    expect(catalogCompletionReport([magic, reprint].reverse(), [], [], true).measures.map((m) => m.total)).toEqual([1, 2, 4]);
  });

  it('never calls a zero-slot checklist complete and never invents generic eligibility metadata', () => {
    const emptyPokemon = pokemonCompletionReport([], new Map(), true);
    const emptyGeneric = catalogCompletionReport([], [], [], true);
    for (const report of [emptyPokemon, emptyGeneric]) {
      expect(report.measures.every((m) => m.owned === 0 && m.total === 0 && !m.complete)).toBe(true);
    }
    expect(emptyGeneric.coverage).toEqual({ complete: true });
  });
});
