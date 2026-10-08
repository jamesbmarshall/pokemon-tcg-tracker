import { describe, expect, it } from 'vitest';
import { computeDeckOwnership } from './ownership';
import type { CardSnapshot } from '../types';
import type { DeckCard } from './legality';

function card(overrides: Partial<CardSnapshot> & { id: string; name: string }): CardSnapshot {
  return {
    number: '1',
    setId: 'sv01',
    setName: 'Scarlet & Violet',
    series: 'Scarlet & Violet',
    releaseDate: '2023-03-31',
    printedTotal: 198,
    supertype: 'Pokémon',
    image: '',
    imageLarge: '',
    variants: ['normal'],
    prices: {},
    syncedAt: '2024-01-01T00:00:00.000Z',
    legal: { standard: true, expanded: true },
    ...overrides,
  };
}

describe('computeDeckOwnership', () => {
  it('sums owned copies across printings of the same name', () => {
    const printingA = card({ id: 'a', name: 'Arven', setId: 'sv01' });
    const printingB = card({ id: 'b', name: 'Arven', setId: 'sv02' });
    const deck: DeckCard[] = [{ card: printingA, qty: 4 }];
    const owned = new Map([['a', 1], ['b', 2]]);
    const result = computeDeckOwnership(deck, 'standard', owned, [printingA, printingB]);
    expect(result).toEqual([{ name: 'Arven', needed: 4, owned: 3, missing: 1, deckCardIds: ['a'] }]);
  });

  it('ignores owned copies that are not legal in the chosen format', () => {
    const legalPrinting = card({ id: 'a', name: 'Old Card' });
    const illegalPrinting = card({ id: 'b', name: 'Old Card', legal: { standard: false, expanded: true } });
    const deck: DeckCard[] = [{ card: legalPrinting, qty: 2 }];
    const owned = new Map([['a', 1], ['b', 5]]);
    const result = computeDeckOwnership(deck, 'standard', owned, [legalPrinting, illegalPrinting]);
    expect(result[0]).toMatchObject({ owned: 1, missing: 1 });
  });

  it('reports everything missing when nothing is owned', () => {
    const printing = card({ id: 'a', name: 'Rare Candy', supertype: 'Trainer' });
    const deck: DeckCard[] = [{ card: printing, qty: 4 }];
    const result = computeDeckOwnership(deck, 'standard', new Map(), [printing]);
    expect(result[0]).toMatchObject({ needed: 4, owned: 0, missing: 4 });
  });
});
