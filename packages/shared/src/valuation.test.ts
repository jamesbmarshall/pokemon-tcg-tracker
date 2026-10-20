import { expect, it } from 'vitest';
import { valuationCoverage } from './valuation';
import type { CardSnapshot, CollectionEntry, GradedCopy, SealedItem } from './types';
it('distinguishes known zero, missing, raw estimates, stale and unknown freshness', () => {
  const cards = new Map([['a', { id: 'a', prices: { normal: 0 }, tcgplayerUpdatedAt: '2026-01-01' } as unknown as CardSnapshot]]);
  const entries = [{ cardId: 'a', variant: 'normal', quantity: 2 }, { cardId: 'b', variant: 'normal', quantity: 3 }, { cardId: 'b', variant: 'normal', quantity: 1, valueUsd: 0 }] as CollectionEntry[];
  const slabs = [{ cardId: 'a', variant: 'normal' }, { cardId: 'b', variant: 'normal', pcPrice: 12 }] as GradedCopy[];
  const sealed = [{ quantity: 5, status: 'opened', pcPrice: 3 }] as SealedItem[];
  expect(valuationCoverage(entries, cards, slabs, sealed, Date.parse('2026-02-01'))).toEqual({ totalUnits: 8, pricedUnits: 5, unpricedUnits: 3, estimatedUnits: 1, staleUnits: 3, unknownFreshnessUnits: 1, manualUnits: 1 });
});
