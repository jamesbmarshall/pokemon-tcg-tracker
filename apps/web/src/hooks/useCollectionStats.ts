import { useMemo } from 'react';
import { computeValue, costBasis, gradedValue, priceOf, useCollectionStore, type CostBasis } from '../store/collectionStore';
import { useFx } from './useMoney';
import type { CardSnapshot, CollectionEntry, GradedCopy } from '../api/types';

export interface SetSummary {
  setId: string;
  setName: string;
  series: string;
  releaseDate: string;
  printedTotal: number;
  baseOwned: number;
  uniqueOwned: number;
  slotsOwned: number;
  masterTotal?: number;
  valueUsd: number;
}

export interface OwnedCard {
  card: CardSnapshot;
  entries: CollectionEntry[];
  /** Slabbed copies of this card, best first */
  graded: GradedCopy[];
  /** Raw copies plus slabs */
  quantity: number;
  valueUsd: number;
  topPrice: number;
  addedAt: string;
  /** Purchase cost vs. market value of the copies with a recorded price */
  cost: CostBasis;
}

const NO_COST: CostBasis = { costUsd: 0, valueUsd: 0, costed: 0 };

export function useCollectionStats() {
  const entries = useCollectionStore((s) => s.entries);
  const cards = useCollectionStore((s) => s.cards);
  const setStats = useCollectionStore((s) => s.setStats);
  const graded = useCollectionStore((s) => s.graded);
  const gradedByCard = useCollectionStore((s) => s.gradedByCard);
  const { rates } = useFx();

  return useMemo(() => {
    const value = computeValue(entries.values(), cards, graded.values());
    const ownedCards = new Map<string, OwnedCard>();
    for (const e of entries.values()) {
      const card = cards.get(e.cardId);
      if (!card) continue;
      const price = priceOf(card, e.variant) ?? 0;
      const o = ownedCards.get(e.cardId) ?? { card, entries: [], graded: [], quantity: 0, valueUsd: 0, topPrice: 0, addedAt: e.addedAt, cost: NO_COST };
      o.entries.push(e);
      o.quantity += e.quantity;
      o.valueUsd += price * e.quantity;
      o.topPrice = Math.max(o.topPrice, price);
      if (e.addedAt > o.addedAt) o.addedAt = e.addedAt;
      ownedCards.set(e.cardId, o);
    }
    for (const [cardId, slabs] of gradedByCard) {
      const card = cards.get(cardId);
      if (!card) continue;
      const o = ownedCards.get(cardId) ?? { card, entries: [], graded: [], quantity: 0, valueUsd: 0, topPrice: 0, addedAt: slabs[0].addedAt, cost: NO_COST };
      o.graded = slabs;
      for (const g of slabs) {
        const v = gradedValue(g, cards);
        o.quantity++;
        o.valueUsd += v;
        o.topPrice = Math.max(o.topPrice, v);
        if (g.addedAt > o.addedAt) o.addedAt = g.addedAt;
      }
      ownedCards.set(cardId, o);
    }

    const sets = new Map<string, SetSummary>();
    for (const o of ownedCards.values()) {
      const c = o.card;
      const held = new Set([...o.entries.map((e) => e.variant), ...o.graded.filter((g) => g.countsTowardSet).map((g) => g.variant)]);
      const s = sets.get(c.setId) ?? {
        setId: c.setId,
        setName: c.setName,
        series: c.series,
        releaseDate: c.releaseDate,
        printedTotal: c.printedTotal,
        baseOwned: 0,
        uniqueOwned: 0,
        slotsOwned: 0,
        masterTotal: setStats.get(c.setId)?.masterTotal,
        valueUsd: 0,
      };
      s.valueUsd += o.valueUsd;
      // Slabs kept out of the binder add value but don't fill a set slot.
      if (held.size) {
        s.uniqueOwned++;
        s.slotsOwned += held.size;
        if (/^\d+$/.test(c.number) && Number(c.number) <= c.printedTotal) s.baseOwned++;
      }
      sets.set(c.setId, s);
    }

    for (const o of ownedCards.values()) o.cost = costBasis(o.entries, cards, o.graded, rates);
    const owned = Array.from(ownedCards.values());
    return {
      ...value,
      cost: costBasis(entries.values(), cards, graded.values(), rates),
      owned,
      sets: Array.from(sets.values()),
      completedSets: Array.from(sets.values()).filter((s) => s.printedTotal > 0 && s.baseOwned >= s.printedTotal).length,
    };
  }, [entries, cards, setStats, graded, gradedByCard, rates]);
}
