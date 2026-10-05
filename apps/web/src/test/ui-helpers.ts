import { vi } from 'vitest';
import { indexGraded, indexHoldings, useCollectionStore } from '../store/collectionStore';
import { useSettings } from '../store/settingsStore';
import { useToasts } from '../store/toastStore';
import { memory, TEST_COLLECTION } from './memoryBackend';
import type { CardSnapshot, CollectionEntry, GradedCopy, SetStat, ValuePoint, WishlistEntry } from '../api/types';

const initialCollection = useCollectionStore.getState();
const initialSettings = useSettings.getState();

/** USD→GBP at 0.5 makes expected money strings easy to work out: $1 → £0.50. */
export const TEST_RATES = { USD: 1, GBP: 0.5, EUR: 0.9 };

/**
 * Restores every store to its initial state, pointed at the (fresh) in-memory backend. `recordValue` is stubbed
 * because `commitEntries` schedules it on a 1.5s timer that can otherwise leak into later tests.
 */
export async function resetStores() {
  useCollectionStore.setState(initialCollection, true);
  useCollectionStore.setState({ recordValue: async () => {}, lastSync: null, collectionId: TEST_COLLECTION, role: 'owner', readOnly: false });
  useSettings.setState(initialSettings, true);
  useToasts.setState({ toasts: [] });
  localStorage.setItem('poketracker-fx', JSON.stringify({ rates: TEST_RATES, at: Date.now() }));
  return memory;
}

export function seedCollection({
  entries = [],
  cards = [],
  wishlist = [],
  history = [],
  setStats = [],
  graded = [],
  notes = {},
}: {
  entries?: CollectionEntry[];
  cards?: CardSnapshot[];
  wishlist?: WishlistEntry[];
  history?: ValuePoint[];
  setStats?: SetStat[];
  graded?: GradedCopy[];
  notes?: Record<string, string>;
} = {}) {
  const byCard = new Map<string, Record<string, number>>();
  for (const e of entries) byCard.set(e.cardId, { ...byCard.get(e.cardId), [e.variant]: e.quantity });
  const gradedMap = new Map(graded.map((g) => [g.id, g]));
  useCollectionStore.setState({
    isLoaded: true,
    collectionId: TEST_COLLECTION,
    entries: new Map(entries.map((e) => [e.id, e])),
    byCard,
    graded: gradedMap,
    gradedByCard: indexGraded(gradedMap),
    holdings: indexHoldings(byCard, gradedMap),
    cards: new Map(cards.map((c) => [c.id, c])),
    wishlist: new Map(wishlist.map((w) => [w.cardId, w])),
    notes: new Map(Object.entries(notes)),
    setStats: new Map(setStats.map((s) => [s.setId, s])),
    history,
  });
}

/** Minimal shape of a settled TanStack Query result for mocked hooks. */
export function queryResult<T>(data: T, over: Record<string, unknown> = {}) {
  return { data, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), ...over };
}

export function loadingResult(over: Record<string, unknown> = {}) {
  return { data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn(), ...over };
}

export function errorResult(message = 'Network down', over: Record<string, unknown> = {}) {
  return { data: undefined, isLoading: false, isFetching: false, error: new Error(message), refetch: vi.fn(), ...over };
}

/** Local YYYY-MM-DD for `days` from today, matching todayKey(). */
export function dayKey(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
