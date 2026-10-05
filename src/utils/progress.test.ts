import { describe, expect, it } from 'vitest';
import { ownedBySet, setProgress } from './progress';
import { makeCard, makeEntry, makeSet } from '../test/fixtures';

const set = makeSet({ printedTotal: 3 });
const cards = [
  makeCard({ id: 'sv03-001', number: '1', set, variants: ['normal', 'reverseHolofoil'] }),
  makeCard({ id: 'sv03-002', number: '2', set, variants: ['normal', 'reverseHolofoil'] }),
  makeCard({ id: 'sv03-003', number: '3', set, variants: ['holofoil'] }),
  makeCard({ id: 'sv03-004', number: '4', set, variants: ['holofoil'] }),
  makeCard({ id: 'sv03-TG01', number: 'TG01', set, variants: [] }),
];

describe('setProgress', () => {
  it('reports totals with nothing owned', () => {
    const p = setProgress(cards, new Map());
    expect(p.base).toEqual({ owned: 0, total: 3 });
    expect(p.full).toEqual({ owned: 0, total: 5 });
    // empty variants fall back to a single "normal" printing
    expect(p.master).toEqual({ owned: 0, total: 7 });
  });
  it('counts secret rares in full/master but not base', () => {
    const p = setProgress(cards, new Map([['sv03-004', { holofoil: 1 }]]));
    expect(p.base.owned).toBe(0);
    expect(p.full.owned).toBe(1);
    expect(p.master.owned).toBe(1);
  });
  it('counts each owned variant towards master', () => {
    const p = setProgress(
      cards,
      new Map<string, Record<string, number>>([
        ['sv03-001', { normal: 2, reverseHolofoil: 1 }],
        ['sv03-002', { reverseHolofoil: 1 }],
        ['sv03-TG01', { normal: 1 }],
      ]),
    );
    expect(p.base.owned).toBe(2);
    expect(p.full.owned).toBe(3);
    expect(p.master.owned).toBe(4);
  });
  it('ignores an empty variant record', () => {
    expect(setProgress(cards, new Map([['sv03-001', {}]])).full.owned).toBe(0);
  });
});

describe('ownedBySet', () => {
  it('groups unique cards, variant slots and copies per set', () => {
    const out = ownedBySet([
      makeEntry({ cardId: 'sv03-001', variant: 'normal', quantity: 2 }),
      makeEntry({ cardId: 'sv03-001', variant: 'reverseHolofoil', quantity: 1 }),
      makeEntry({ cardId: 'sv03-002', variant: 'normal', quantity: 3 }),
      makeEntry({ cardId: 'base1-4', variant: 'holofoil', quantity: 1 }),
    ]);
    expect(out.get('sv03')).toMatchObject({ slots: 3, copies: 6 });
    expect(out.get('sv03')!.cards.size).toBe(2);
    expect(out.get('base1')!.cards.size).toBe(1);
  });
});
