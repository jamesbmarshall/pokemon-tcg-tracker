import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCollectionStats } from './useCollectionStats';
import { useCollectionStore } from '../store/collectionStore';
import { makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { indexGraded } from '../store/collectionStore';

const initial = useCollectionStore.getState();
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
const renderStats = () => renderHook(() => useCollectionStats(), { wrapper });
beforeEach(() => useCollectionStore.setState(initial, true));

describe('useCollectionStats', () => {
  it('is empty for an empty collection', () => {
    const { result } = renderStats();
    expect(result.current).toMatchObject({ valueUsd: 0, count: 0, unique: 0, owned: [], sets: [], completedSets: 0 });
  });

  it('aggregates owned cards and per-set progress, counting secret rares outside base', () => {
    const tiny = { printedTotal: 2, setId: 'tiny', setName: 'Tiny', series: 'Test' };
    useCollectionStore.setState({
      entries: new Map(
        [
          makeEntry({ cardId: 'sv03-001', variant: 'normal', quantity: 2, addedAt: '2025-01-01' }),
          makeEntry({ cardId: 'sv03-001', variant: 'reverseHolofoil', quantity: 1, addedAt: '2025-02-01' }),
          makeEntry({ cardId: 'sv03-223', variant: 'holofoil', quantity: 1 }),
          makeEntry({ cardId: 'tiny-1', variant: 'normal' }),
          makeEntry({ cardId: 'tiny-2', variant: 'normal' }),
          makeEntry({ cardId: 'ghost-1', variant: 'normal', quantity: 5 }),
        ].map((e) => [e.id, e]),
      ),
      cards: new Map(
        [
          makeSnapshot({ id: 'sv03-001', number: '1', prices: { normal: 1, reverseHolofoil: 4 } }),
          makeSnapshot({ id: 'sv03-223', number: '223', prices: { holofoil: 50 } }),
          makeSnapshot({ id: 'tiny-1', number: '1', prices: {}, ...tiny }),
          makeSnapshot({ id: 'tiny-2', number: '2', prices: {}, ...tiny }),
        ].map((c) => [c.id, c]),
      ),
      setStats: new Map([['sv03', { setId: 'sv03', masterTotal: 400, syncedAt: 'x' }]]),
    });
    const { result } = renderStats();
    const s = result.current;
    // ghost-1 has no snapshot: counted in totals but not in owned/sets
    expect(s).toMatchObject({ count: 11, unique: 5, valueUsd: 56, completedSets: 1 });
    expect(s.owned).toHaveLength(4);
    const charmander = s.owned.find((o) => o.card.id === 'sv03-001')!;
    expect(charmander).toMatchObject({ quantity: 3, valueUsd: 6, topPrice: 4, addedAt: '2025-02-01' });
    const obf = s.sets.find((x) => x.setId === 'sv03')!;
    expect(obf).toMatchObject({ baseOwned: 1, uniqueOwned: 2, slotsOwned: 3, masterTotal: 400, valueUsd: 56, printedTotal: 197 });
    expect(s.sets.find((x) => x.setId === 'tiny')).toMatchObject({ baseOwned: 2, uniqueOwned: 2, masterTotal: undefined });
  });

  it('adds slab value to cards and sets, but only counting slabs fill set progress', () => {
    const graded = new Map(
      [
        makeGraded({ id: 'a', cardId: 'sv03-001', variant: 'holofoil', valueUsd: 200, addedAt: '2025-06-01' }),
        makeGraded({ id: 'b', cardId: 'sv03-002', countsTowardSet: false }),
        makeGraded({ id: 'c', cardId: 'zz-9' }), // no snapshot
      ].map((g) => [g.id, g]),
    );
    useCollectionStore.setState({
      entries: new Map([makeEntry({ cardId: 'sv03-001', quantity: 1 })].map((e) => [e.id, e])),
      cards: new Map([makeSnapshot({ id: 'sv03-001', prices: { normal: 1 } }), makeSnapshot({ id: 'sv03-002', number: '2', prices: { normal: 3 } })].map((c) => [c.id, c])),
      graded,
      gradedByCard: indexGraded(graded),
    });
    const { result } = renderStats();
    expect(result.current).toMatchObject({ count: 4, unique: 3, valueUsd: 1 + 200 + 3 + 0 });
    const a = result.current.owned.find((o) => o.card.id === 'sv03-001')!;
    expect(a).toMatchObject({ quantity: 2, valueUsd: 201, topPrice: 200, addedAt: '2025-06-01' });
    expect(a.graded.map((g) => g.id)).toEqual(['a']);
    const b = result.current.owned.find((o) => o.card.id === 'sv03-002')!;
    expect(b).toMatchObject({ entries: [], quantity: 1, valueUsd: 3 });
    expect(result.current.sets).toEqual([expect.objectContaining({ setId: 'sv03', uniqueOwned: 1, baseOwned: 1, slotsOwned: 2, valueUsd: 204 })]);
  });

  it('reports cost basis for copies with a price paid, per card and overall', () => {
    localStorage.setItem('poketracker-fx', JSON.stringify({ rates: { USD: 1, GBP: 0.5, EUR: 1 }, at: Date.now() }));
    useCollectionStore.setState({
      entries: new Map(
        [
          makeEntry({ cardId: 'sv03-001', variant: 'normal', quantity: 2, paid: { amount: 1, currency: 'GBP' } }),
          makeEntry({ cardId: 'sv03-001', variant: 'reverseHolofoil', quantity: 1 }),
        ].map((e) => [e.id, e]),
      ),
      cards: new Map([['sv03-001', makeSnapshot({ id: 'sv03-001', prices: { normal: 3, reverseHolofoil: 10 } })]]),
      gradedByCard: new Map(),
    });
    const { result } = renderStats();
    expect(result.current.cost).toEqual({ costUsd: 4, valueUsd: 6, costed: 2 });
    expect(result.current.owned[0].cost).toEqual({ costUsd: 4, valueUsd: 6, costed: 2 });
    localStorage.removeItem('poketracker-fx');
  });
});
