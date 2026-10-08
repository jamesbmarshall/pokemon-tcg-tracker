import { describe, expect, it } from 'vitest';
import { computeValue, costBasis, gradedValue, sealedValue, valuePoint, FALLBACK_RATES } from './value';
import type { CardSnapshot, CollectionEntry, GradedCopy, SealedItem } from './types';

const card = (id: string, price = 10): CardSnapshot => ({
  id,
  name: `Card ${id}`,
  number: id.split('-')[1],
  setId: id.split('-')[0],
  setName: 'Set',
  series: 'S',
  releaseDate: '2024-01-01',
  printedTotal: 100,
  supertype: 'Pokémon',
  image: '',
  imageLarge: '',
  variants: ['normal'],
  prices: { normal: price },
  syncedAt: new Date().toISOString(),
});

const graded = (over: Partial<GradedCopy> = {}): GradedCopy => ({
  id: 'g1',
  cardId: 'sv1-001',
  variant: 'normal',
  company: 'PSA',
  grade: '10',
  addedAt: new Date().toISOString(),
  ...over,
});

const sealed = (over: Partial<SealedItem> = {}): SealedItem => ({
  id: 's1',
  name: 'Scarlet & Violet booster box',
  productType: 'booster_box',
  quantity: 1,
  status: 'sealed',
  addedAt: new Date().toISOString(),
  ...over,
});

describe('gradedValue precedence', () => {
  it('prefers the owner valuation over everything else', () => {
    const cards = new Map([['sv1-001', card('sv1-001', 10)]]);
    expect(gradedValue(graded({ valueUsd: 500, pcPrice: 300 }), cards)).toBe(500);
  });

  it('falls back to the PriceCharting graded price when there is no owner valuation', () => {
    const cards = new Map([['sv1-001', card('sv1-001', 10)]]);
    expect(gradedValue(graded({ pcPrice: 300 }), cards)).toBe(300);
  });

  it('falls back to the raw market price when neither is set', () => {
    const cards = new Map([['sv1-001', card('sv1-001', 10)]]);
    expect(gradedValue(graded(), cards)).toBe(10);
  });
});

describe('sealedValue precedence and opened exclusion', () => {
  it('prefers the owner valuation over the PriceCharting price', () => {
    expect(sealedValue(sealed({ valueUsd: 150, pcPrice: 90, quantity: 3 }))).toBe(150);
  });

  it('falls back to PriceCharting price times quantity', () => {
    expect(sealedValue(sealed({ pcPrice: 90, quantity: 3 }))).toBe(270);
  });

  it('is zero with neither an owner valuation nor a linked price', () => {
    expect(sealedValue(sealed())).toBe(0);
  });

  it('is zero once opened, regardless of valuation', () => {
    expect(sealedValue(sealed({ status: 'opened', valueUsd: 150 }))).toBe(0);
  });
});

describe('computeValue', () => {
  it('includes unopened sealed items and graded slabs in the total but not in card counts', () => {
    const cards = new Map([['sv1-001', card('sv1-001', 10)]]);
    const entries: CollectionEntry[] = [{ cardId: 'sv1-001', variant: 'normal', quantity: 2, addedAt: new Date().toISOString() }];
    const { valueUsd, count, unique } = computeValue(entries, cards, [graded({ valueUsd: 500 })], [sealed({ pcPrice: 90, quantity: 2 }), sealed({ id: 's2', status: 'opened', valueUsd: 999 })]);
    // 2 raw copies @ 10 + 1 slab @ 500 + 1 unopened sealed item (90*2=180) + 0 for the opened one.
    expect(valueUsd).toBe(2 * 10 + 500 + 180);
    expect(count).toBe(3); // 2 raw copies + 1 slab; sealed items don't count as cards
    expect(unique).toBe(1);
  });
});

describe('costBasis', () => {
  it('counts an unopened sealed item with a recorded price but skips an opened one', () => {
    const cards = new Map<string, CardSnapshot>();
    const s1 = sealed({ paid: { amount: 50, currency: 'USD' }, pcPrice: 70, quantity: 1 });
    const s2 = sealed({ id: 's2', status: 'opened', paid: { amount: 30, currency: 'USD' } });
    const out = costBasis([], cards, [], FALLBACK_RATES, [s1, s2]);
    expect(out.costed).toBe(1);
    expect(out.costUsd).toBe(50);
    expect(out.valueUsd).toBe(70);
  });
});

describe('valuePoint', () => {
  it('still records a point for a collection that holds only sealed product', () => {
    const point = valuePoint([], new Map(), [], FALLBACK_RATES, false, [sealed({ pcPrice: 25, quantity: 2 })]);
    expect(point).toBeDefined();
    expect(point!.valueUsd).toBe(50);
    expect(point!.cards).toBe(0);
  });

  it('returns undefined for a truly empty collection with no history', () => {
    expect(valuePoint([], new Map(), [], FALLBACK_RATES, false, [])).toBeUndefined();
  });
});
