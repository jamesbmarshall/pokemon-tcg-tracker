import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardSnapshot } from '../api/types';
import { makeCard, makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';

const m = vi.hoisted(() => ({
  getCardsByIds: vi.fn(),
  resolveLegacyIds: vi.fn(),
  cacheImages: vi.fn(),
  pruneImages: vi.fn(),
}));
vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), getCardsByIds: m.getCardsByIds }));
vi.mock('../api/migrate', async (orig) => ({ ...(await orig<typeof import('../api/migrate')>()), resolveLegacyIds: m.resolveLegacyIds }));
vi.mock('../db/imageCache', () => ({ cacheImages: m.cacheImages, pruneImages: m.pruneImages }));

import { costBasis, computeValue, gradedValue, indexGraded, indexHoldings, NOTE_MAX, ownedTotal, priceOf, useCollectionStore, useGradedFor, useHoldings, useNote, useOwned, useWished, type GradedInput } from './collectionStore';
import { db } from '../db/dexie';
import { renderHook } from '@testing-library/react';

const initial = useCollectionStore.getState();
const store = () => useCollectionStore.getState();
const priced = (id: string, prices: Record<string, number> = { normal: 1, reverseHolofoil: 2 }, over: Partial<CardSnapshot> = {}) => makeSnapshot({ id, prices, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  useCollectionStore.setState({ ...initial, isLoaded: true }, true);
  m.getCardsByIds.mockReset().mockResolvedValue([]);
  m.resolveLegacyIds.mockReset().mockResolvedValue({ map: new Map(), failedSets: 0 });
  m.cacheImages.mockReset().mockResolvedValue(undefined);
  m.pruneImages.mockReset().mockResolvedValue(undefined);
  localStorage.setItem('poketracker-provider', 'tcgdex');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  // let any fire-and-forget hydrate()/sync settle before the next test clears the db
  await flush();
});

describe('pure helpers', () => {
  it('priceOf falls back to the first known price', () => {
    const c = priced('a-1', { holofoil: 5, reverseHolofoil: 3 });
    expect(priceOf(c, 'reverseHolofoil')).toBe(3);
    expect(priceOf(c, 'normal')).toBe(5);
    expect(priceOf(priced('a-1', {}), 'normal')).toBeUndefined();
    expect(priceOf(undefined, 'normal')).toBeUndefined();
  });

  it('computeValue totals copies, unique cards and value', () => {
    const cards = new Map([['sv03-001', priced('sv03-001')]]);
    const out = computeValue(
      [makeEntry({ quantity: 2 }), makeEntry({ variant: 'reverseHolofoil', quantity: 1 }), makeEntry({ cardId: 'zz-1', quantity: 4 })],
      cards,
    );
    expect(out).toEqual({ valueUsd: 4, count: 7, unique: 2 });
  });

  it('ownedTotal sums variant quantities', () => {
    expect(ownedTotal({ normal: 2, holofoil: 1 })).toBe(3);
    expect(ownedTotal(undefined)).toBe(0);
  });
});

describe('adjust', () => {
  it('adds a new card, persists the entry and snapshot, and indexes by card', async () => {
    const card = priced('sv03-001');
    await store().adjust(card, 'normal', 1);
    const e = store().entries.get('sv03-001::normal')!;
    expect(e).toMatchObject({ cardId: 'sv03-001', setId: 'sv03', variant: 'normal', quantity: 1, condition: 'NM' });
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 1 });
    expect(await db.collection.get('sv03-001::normal')).toMatchObject({ quantity: 1 });
    expect(await db.cards.get('sv03-001')).toMatchObject({ name: 'Charmander' });
    // priced snapshot: just cache the image, no network hydrate
    expect(m.cacheImages).toHaveBeenCalledWith([expect.objectContaining({ id: 'sv03-001' })]);
    expect(m.getCardsByIds).not.toHaveBeenCalled();
  });

  it('accepts a full PokemonCard and converts it to a snapshot', async () => {
    await store().adjust(makeCard({ id: 'sv03-223', number: '223' }), 'holofoil', 1);
    expect(store().cards.get('sv03-223')).toMatchObject({ setId: 'sv03', number: '223', printedTotal: 197 });
    expect(store().byCard.get('sv03-223')).toEqual({ holofoil: 1 });
  });

  it('hydrates unpriced cards with full details and records value', async () => {
    m.getCardsByIds.mockResolvedValue([makeCard({ id: 'sv03-002', tcgplayer: { url: 'u', updatedAt: '', prices: { normal: { market: 7 } } } })]);
    await store().adjust(priced('sv03-002', {}), 'normal', 1);
    await vi.waitFor(() => expect(store().cards.get('sv03-002')?.prices).toEqual({ normal: 7 }));
    await vi.waitFor(() => expect(store().history.at(-1)).toMatchObject({ valueUsd: 7, cards: 1 }));
  });

  it('swallows hydrate failures', async () => {
    m.getCardsByIds.mockRejectedValue(new Error('offline'));
    await store().adjust(priced('sv03-002', {}), 'normal', 1);
    await flush();
    expect(store().entries.size).toBe(1);
  });

  it('increments, decrements and removes at zero; never goes negative', async () => {
    const card = priced('sv03-001');
    await store().adjust(card, 'normal', 1);
    await store().adjust(card, 'normal', 2);
    expect(store().entries.get('sv03-001::normal')).toMatchObject({ quantity: 3 });
    expect(store().entries.get('sv03-001::normal')!.updatedAt).toBeDefined();
    await store().adjust(card, 'normal', -5);
    expect(store().entries.has('sv03-001::normal')).toBe(false);
    expect(store().byCard.has('sv03-001')).toBe(false);
    expect(await db.collection.count()).toBe(0);
  });

  it('ignores removing a card that is not owned', async () => {
    await store().adjust(priced('sv03-001'), 'normal', -1);
    expect(store().entries.size).toBe(0);
  });

  it('records the collection value 1.5s after the last change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await store().adjust(priced('sv03-001'), 'normal', 2);
    expect(store().history).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(store().history).toHaveLength(1));
    expect(store().history[0]).toMatchObject({ valueUsd: 2, cards: 2, unique: 1 });
  });

  it('does not let a listing snapshot wipe stored prices', async () => {
    await store().remember([priced('sv03-001', { normal: 9 }, { tcgplayerUrl: 'tp' })]);
    await store().adjust(makeCard({ detailed: false }), 'normal', 1);
    expect(store().cards.get('sv03-001')).toMatchObject({ prices: { normal: 9 }, tcgplayerUrl: 'tp' });
  });
});

describe('remember', () => {
  it('is a no-op for an empty list', async () => {
    await store().remember([]);
    expect(await db.cards.count()).toBe(0);
  });
  it('replaces prices when the new snapshot has them', async () => {
    await store().remember([priced('a-1', { normal: 1 })]);
    await store().remember([priced('a-1', { normal: 2 })]);
    expect(store().cards.get('a-1')!.prices).toEqual({ normal: 2 });
  });
});

describe('setQuantity / updateEntry / removeCard / restoreEntries', () => {
  beforeEach(async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    await store().adjust(priced('sv03-001'), 'reverseHolofoil', 1);
  });

  it('setQuantity sets an exact count and removes at zero', async () => {
    await store().setQuantity('sv03-001', 'normal', 4);
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 4, reverseHolofoil: 1 });
    await store().setQuantity('sv03-001', 'normal', 0);
    expect(store().byCard.get('sv03-001')).toEqual({ reverseHolofoil: 1 });
    await store().setQuantity('sv03-001', 'holofoil', 3);
    expect(store().entries.size).toBe(1);
  });

  it('updateEntry patches condition and notes', async () => {
    await store().updateEntry('sv03-001', 'normal', { condition: 'LP', notes: 'Whitening' });
    expect(store().entries.get('sv03-001::normal')).toMatchObject({ condition: 'LP', notes: 'Whitening', quantity: 1 });
    expect(await db.collection.get('sv03-001::normal')).toMatchObject({ condition: 'LP' });
    await store().updateEntry('nope-1', 'normal', { notes: 'x' });
    expect(store().entries.has('nope-1::normal')).toBe(false);
  });

  it('removeCard deletes every variant and restoreEntries undoes it', async () => {
    const removed = await store().removeCard('sv03-001');
    expect(removed).toHaveLength(2);
    expect(store().entries.size).toBe(0);
    expect(await db.collection.count()).toBe(0);
    await store().restoreEntries(removed);
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 1, reverseHolofoil: 1 });
    expect(await db.collection.count()).toBe(2);
  });
});

describe('wishlist', () => {
  it('toggles on and off, persisting each time', async () => {
    const card = priced('sv03-050');
    expect(await store().toggleWishlist(card)).toBe(true);
    expect(store().wishlist.has('sv03-050')).toBe(true);
    expect(await db.wishlist.get('sv03-050')).toBeDefined();
    expect(store().cards.has('sv03-050')).toBe(true);
    expect(await store().toggleWishlist(card)).toBe(false);
    expect(store().wishlist.size).toBe(0);
    expect(await db.wishlist.count()).toBe(0);
  });

  it('useWished and useOwned reflect the store', async () => {
    const { result, rerender } = renderHook(() => [useWished('sv03-001'), useOwned('sv03-001')] as const);
    expect(result.current).toEqual([false, undefined]);
    await store().toggleWishlist(priced('sv03-001'));
    await store().adjust(priced('sv03-001'), 'normal', 2);
    rerender();
    expect(result.current).toEqual([true, { normal: 2 }]);
  });
});

describe('recordSetStat', () => {
  it('stores master totals and skips unchanged values', async () => {
    await store().recordSetStat('sv03', 400);
    const first = store().setStats.get('sv03')!;
    expect(first.masterTotal).toBe(400);
    await store().recordSetStat('sv03', 400);
    expect(store().setStats.get('sv03')).toBe(first);
    await store().recordSetStat('sv03', 410);
    expect((await db.setStats.get('sv03'))!.masterTotal).toBe(410);
  });
});

describe('recordValue', () => {
  it('skips an empty collection with no history', async () => {
    await store().recordValue();
    expect(await db.valueHistory.count()).toBe(0);
  });

  it('writes one point per day, replacing today', async () => {
    useCollectionStore.setState({ history: [{ date: '2000-01-01', valueUsd: 1, cards: 1, unique: 1 }] });
    await store().recordValue();
    await store().recordValue();
    expect(store().history).toHaveLength(2);
    expect(store().history[1]).toMatchObject({ valueUsd: 0, cards: 0 });
  });

  it('rounds to the penny', async () => {
    await store().remember([priced('a-1', { normal: 0.333 })]);
    useCollectionStore.setState({ entries: new Map([['a-1::normal', makeEntry({ cardId: 'a-1', quantity: 3 })]]) });
    await store().recordValue();
    expect(store().history[0].valueUsd).toBe(1);
  });
});

describe('syncPrices', () => {
  it('fetches only cards without snapshots unless forced', async () => {
    await store().remember([priced('a-1')]);
    useCollectionStore.setState({
      entries: new Map([['a-1::normal', makeEntry({ cardId: 'a-1' })], ['b-2::normal', makeEntry({ cardId: 'b-2' })]]),
      wishlist: new Map([['c-3', { cardId: 'c-3', addedAt: 'x' }]]),
    });
    m.getCardsByIds.mockResolvedValue([makeCard({ id: 'b-2' })]);
    expect(await store().syncPrices()).toBe(1);
    expect(m.getCardsByIds).toHaveBeenCalledWith(['b-2', 'c-3']);
    expect(store().lastSync).toBeNull();
    expect(m.pruneImages).not.toHaveBeenCalled();

    m.getCardsByIds.mockResolvedValue([makeCard({ id: 'a-1' }), makeCard({ id: 'b-2' })]);
    expect(await store().syncPrices(true)).toBe(2);
    expect(m.getCardsByIds).toHaveBeenLastCalledWith(['a-1', 'b-2', 'c-3']);
    expect(store().lastSync).not.toBeNull();
    expect(localStorage.getItem('poketracker-last-price-sync')).toBe(store().lastSync);
    expect(m.pruneImages).toHaveBeenCalledWith(new Set(['a-1', 'b-2', 'c-3']));
    expect(m.cacheImages).toHaveBeenCalled();
    expect(store().syncing).toBe(false);
  });

  it('returns 0 and still records value when nothing needs fetching', async () => {
    expect(await store().syncPrices()).toBe(0);
    expect(m.getCardsByIds).not.toHaveBeenCalled();
  });

  it('returns 0 if a sync is already running', async () => {
    useCollectionStore.setState({ syncing: true, entries: new Map([['a-1::normal', makeEntry({ cardId: 'a-1' })]]) });
    expect(await store().syncPrices(true)).toBe(0);
  });

  it('batches requests in 40s and tolerates partial failures', async () => {
    const entries = new Map(Array.from({ length: 85 }, (_, i) => [`x-${i}::normal`, makeEntry({ cardId: `x-${i}` })]));
    useCollectionStore.setState({ entries });
    m.getCardsByIds.mockImplementationOnce(async (ids: string[]) => ids.map((id) => makeCard({ id }))).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce([]);
    expect(await store().syncPrices()).toBe(40);
    expect(m.getCardsByIds.mock.calls.map(([ids]) => ids.length)).toEqual([40, 40, 5]);
  });

  it('returns -1 when the API is unreachable', async () => {
    useCollectionStore.setState({ entries: new Map([['a-1::normal', makeEntry({ cardId: 'a-1' })]]) });
    m.getCardsByIds.mockRejectedValue(new Error('offline'));
    expect(await store().syncPrices(true)).toBe(-1);
    expect(store().syncing).toBe(false);
    expect(store().lastSync).toBeNull();
  });
});

describe('migrateLegacy', () => {
  it('marks an empty collection as migrated', async () => {
    localStorage.removeItem('poketracker-provider');
    expect(await store().migrateLegacy()).toBe(false);
    expect(localStorage.getItem('poketracker-provider')).toBe('tcgdex');
    expect(m.resolveLegacyIds).not.toHaveBeenCalled();
  });

  it('remaps ids and variants, merging quantities that collide', async () => {
    localStorage.removeItem('poketracker-provider');
    await db.cards.put(makeSnapshot({ id: 'base1-4', name: 'Charizard' }));
    useCollectionStore.setState({
      cards: new Map([['base1-4', makeSnapshot({ id: 'base1-4', name: 'Charizard' })]]),
      entries: new Map([
        ['base1-4::holofoil', makeEntry({ cardId: 'base1-4', variant: 'holofoil', quantity: 1 })],
        ['base1-4::unlimitedHolofoil', makeEntry({ cardId: 'base1-4', variant: 'unlimitedHolofoil', quantity: 2 })],
        ['sv3pt5-6::normal', makeEntry({ cardId: 'sv3pt5-6', variant: 'normal', quantity: 1 })],
      ]),
      wishlist: new Map([['sv3pt5-7', { cardId: 'sv3pt5-7', addedAt: 'x' }]]),
    });
    m.resolveLegacyIds.mockResolvedValue({ map: new Map([['base1-4', 'base1-4'], ['sv3pt5-6', 'sv03.5-006'], ['sv3pt5-7', 'sv03.5-007']]), failedSets: 0 });

    expect(await store().migrateLegacy()).toBe(true);
    expect(m.resolveLegacyIds.mock.calls[0][1].get('base1-4')).toBe('Charizard');
    const rows = await db.collection.toArray();
    expect(rows.map((r) => [r.id, r.quantity, r.setId]).sort()).toEqual([
      ['base1-4::holofoil', 3, 'base1'],
      ['sv03.5-006::normal', 1, 'sv03.5'],
    ]);
    expect((await db.wishlist.toArray()).map((w) => w.cardId)).toEqual(['sv03.5-007']);
    expect(await db.cards.get('base1-4')).toBeDefined();
    expect(localStorage.getItem('poketracker-provider')).toBe('tcgdex');
  });

  it('leaves the flag unset when some sets failed so it retries', async () => {
    localStorage.removeItem('poketracker-provider');
    useCollectionStore.setState({ entries: new Map([['a-1::normal', makeEntry({ cardId: 'a-1' })]]) });
    m.resolveLegacyIds.mockResolvedValue({ map: new Map(), failedSets: 1 });
    expect(await store().migrateLegacy()).toBe(false);
    expect(localStorage.getItem('poketracker-provider')).toBeNull();
  });
});

describe('load', () => {
  it('reads everything from IndexedDB', async () => {
    await db.collection.put(makeEntry({ quantity: 2 }));
    await db.cards.put(priced('sv03-001'));
    await db.wishlist.put({ cardId: 'sv03-009', addedAt: 'x' });
    await db.setStats.put({ setId: 'sv03', masterTotal: 400, syncedAt: 'x' });
    await db.valueHistory.bulkPut([
      { date: '2025-01-02', valueUsd: 2, cards: 1, unique: 1 },
      { date: '2025-01-01', valueUsd: 1, cards: 1, unique: 1 },
    ]);
    useCollectionStore.setState({ ...initial }, true);
    localStorage.setItem('poketracker-last-price-sync', new Date().toISOString());
    useCollectionStore.setState({ lastSync: localStorage.getItem('poketracker-last-price-sync') });
    await store().load();
    expect(store().isLoaded).toBe(true);
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 2 });
    expect(store().cards.size).toBe(1);
    expect(store().wishlist.has('sv03-009')).toBe(true);
    expect(store().setStats.get('sv03')!.masterTotal).toBe(400);
    expect(store().history.slice(0, 2).map((h) => h.date)).toEqual(['2025-01-01', '2025-01-02']);
    // recent sync → only missing cards are fetched (sv03-009 has no snapshot)
    await vi.waitFor(() => expect(m.getCardsByIds).toHaveBeenCalledWith(['sv03-009']));
  });

  it('forces a full sync when the last one is stale', async () => {
    await db.collection.put(makeEntry());
    await db.cards.put(priced('sv03-001'));
    useCollectionStore.setState({ lastSync: '2000-01-01T00:00:00Z' });
    await store().load();
    await vi.waitFor(() => expect(m.getCardsByIds).toHaveBeenCalledWith(['sv03-001']));
  });

  it('runs the legacy migration, reloads, then force-syncs', async () => {
    localStorage.removeItem('poketracker-provider');
    await db.collection.put(makeEntry({ cardId: 'sv3pt5-6', id: 'sv3pt5-6::normal', setId: 'sv3pt5' }));
    m.resolveLegacyIds.mockResolvedValue({ map: new Map([['sv3pt5-6', 'sv03.5-006']]), failedSets: 0 });
    await store().load();
    expect([...store().entries.keys()]).toEqual(['sv03.5-006::normal']);
    await vi.waitFor(() => expect(m.getCardsByIds).toHaveBeenCalledWith(['sv03.5-006']));
  });

  it('keeps going when migration throws', async () => {
    localStorage.removeItem('poketracker-provider');
    await db.collection.put(makeEntry());
    m.resolveLegacyIds.mockRejectedValue(new Error('boom'));
    await store().load();
    expect(store().entries.size).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('migration failed'), expect.any(Error));
  });
});

describe('importData', () => {
  it('imports an export file with wishlist, normalising entries', async () => {
    const n = await store().importData({
      collection: [
        { cardId: 'sv03-001', variant: 'normal', quantity: '3', condition: 'LP', notes: 'n', addedAt: '2024-01-01' },
        { cardId: 'sv03-002', variant: 'holofoil', quantity: 0 },
        { cardId: 'sv03-003', variant: 'normal', quantity: 2.7, setId: 'custom' },
        { cardId: 42, variant: 'normal' },
        null,
      ],
      wishlist: [{ cardId: 'sv03-010' }, { nope: true }],
    });
    expect(n).toBe(3);
    expect(store().entries.get('sv03-001::normal')).toMatchObject({ quantity: 3, condition: 'LP', notes: 'n', addedAt: '2024-01-01', setId: 'sv03' });
    expect(store().entries.get('sv03-002::holofoil')!.quantity).toBe(1);
    expect(store().entries.get('sv03-003::normal')).toMatchObject({ quantity: 2, setId: 'custom' });
    expect([...store().wishlist.keys()]).toEqual(['sv03-010']);
  });

  it('accepts a bare array and clears the provider flag so legacy ids are remapped', async () => {
    await store().importData([{ cardId: 'sv3pt5-6', variant: 'normal' }]);
    expect(m.resolveLegacyIds).toHaveBeenCalled();
  });

  it('accepts a wishlist-only file', async () => {
    expect(await store().importData({ collection: [], wishlist: [{ cardId: 'a-1', addedAt: 'x' }] })).toBe(0);
    expect(store().wishlist.has('a-1')).toBe(true);
  });

  it.each([[{}], [null], [[{ foo: 1 }]], ['text']])('rejects %o', async (bad) => {
    await expect(store().importData(bad)).rejects.toThrow('No collection entries found in file');
  });
});

describe('clearAll', () => {
  it('empties the collection, wishlist and history but keeps card snapshots', async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    await store().toggleWishlist(priced('sv03-002'));
    await store().recordValue();
    await store().clearAll();
    expect(store().entries.size + store().wishlist.size + store().history.length).toBe(0);
    expect(await db.collection.count()).toBe(0);
    expect(await db.wishlist.count()).toBe(0);
    expect(await db.valueHistory.count()).toBe(0);
    expect(await db.cards.count()).toBe(2);
  });
});

describe('graded copies', () => {
  const card = priced('sv03-001', { normal: 2, reverseHolofoil: 6 });
  const input = (over: Partial<GradedInput> = {}): GradedInput => ({ variant: 'normal', company: 'PSA', grade: '10', countsTowardSet: true, ...over });

  it('computeValue counts slabs at their own valuation or the raw price', () => {
    const cards = new Map([['sv03-001', card]]);
    const out = computeValue([makeEntry({ quantity: 1 })], cards, [makeGraded({ valueUsd: 300 }), makeGraded({ id: 'b', variant: 'reverseHolofoil', valueUsd: undefined }), makeGraded({ id: 'c', cardId: 'sv03-002' })]);
    expect(out).toEqual({ valueUsd: 2 + 300 + 6, count: 4, unique: 2 });
    expect(gradedValue(makeGraded({ valueUsd: 0 }), cards)).toBe(0);
  });

  it('indexHoldings merges raw copies with slabs that count, ignoring display slabs', () => {
    const byCard = new Map([['sv03-001', { normal: 1 }]]);
    const graded = new Map([
      ['a', makeGraded({ id: 'a', variant: 'normal' })],
      ['b', makeGraded({ id: 'b', variant: 'reverseHolofoil', countsTowardSet: false })],
      ['c', makeGraded({ id: 'c', cardId: 'sv03-009', variant: 'holofoil' })],
    ]);
    const h = indexHoldings(byCard, graded);
    expect(h.get('sv03-001')).toEqual({ normal: 2 });
    expect(h.get('sv03-009')).toEqual({ holofoil: 1 });
    expect(byCard.get('sv03-001')).toEqual({ normal: 1 }); // not mutated
  });

  it('indexGraded groups by card, best grade first', () => {
    const g = indexGraded(new Map([
      ['a', makeGraded({ id: 'a', grade: '9' })],
      ['b', makeGraded({ id: 'b', grade: 'Authentic' })],
      ['c', makeGraded({ id: 'c', grade: '10' })],
    ]));
    expect(g.get('sv03-001')!.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('saveGraded adds a slab, persists it, tidies blanks and updates holdings but not raw byCard', async () => {
    const saved = await store().saveGraded(card, input({ certNumber: '  123 ', label: ' ', notes: '', companyName: 'ignored' }));
    expect(saved).toMatchObject({ cardId: 'sv03-001', setId: 'sv03', certNumber: '123', label: undefined, notes: undefined, companyName: undefined });
    expect(saved.id).toBeTruthy();
    expect(saved.updatedAt).toBeUndefined();
    expect(await db.graded.get(saved.id)).toEqual(saved);
    expect(store().graded.get(saved.id)).toEqual(saved);
    expect(store().gradedByCard.get('sv03-001')).toEqual([saved]);
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 1 });
    expect(store().byCard.has('sv03-001')).toBe(false);
    expect(store().cards.has('sv03-001')).toBe(true);
    expect(m.cacheImages).toHaveBeenCalled();
  });

  it('excluded slabs add value but leave holdings alone', async () => {
    await store().adjust(card, 'normal', 1);
    await store().saveGraded(card, input({ countsTowardSet: false, valueUsd: 100 }));
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 1 });
    expect(computeValue(store().entries.values(), store().cards, store().graded.values()).valueUsd).toBe(102);
  });

  it('saveGraded with an id updates in place, keeping addedAt and stamping updatedAt', async () => {
    const first = await store().saveGraded(card, input());
    const again = await store().saveGraded(card, input({ id: first.id, grade: '9', countsTowardSet: false }));
    expect(again.id).toBe(first.id);
    expect(again.addedAt).toBe(first.addedAt);
    expect(again.updatedAt).toBeDefined();
    expect(store().graded.size).toBe(1);
    expect(store().holdings.has('sv03-001')).toBe(false);
  });

  it('keeps the name only for Other graders', async () => {
    const g = await store().saveGraded(card, input({ company: 'Other', companyName: '  GMA ' }));
    expect(g.companyName).toBe('GMA');
  });

  it('removeGraded deletes the slab and its photos, and restoreGraded puts both back', async () => {
    const g = await store().saveGraded(card, input());
    await db.gradedPhotos.bulkPut([
      { id: 'p1', gradedId: g.id, side: 'front', blob: new Blob(['x']), addedAt: 'a' },
      { id: 'p2', gradedId: 'other', side: 'front', blob: new Blob(['y']), addedAt: 'a' },
    ]);
    const removed = await store().removeGraded(g.id);
    expect(removed?.copy).toEqual(g);
    expect(removed?.photos.map((p) => p.id)).toEqual(['p1']);
    expect(store().graded.size).toBe(0);
    expect(store().holdings.has('sv03-001')).toBe(false);
    expect(await db.graded.count()).toBe(0);
    expect((await db.gradedPhotos.toArray()).map((p) => p.id)).toEqual(['p2']);

    await store().restoreGraded(removed!.copy, removed!.photos);
    expect(store().graded.get(g.id)).toEqual(g);
    expect(await db.gradedPhotos.count()).toBe(2);
    expect(await store().removeGraded('missing')).toBeUndefined();
  });

  it('load reads slabs back and derives the indexes', async () => {
    await db.graded.put(makeGraded({ id: 'z' }));
    await store().load();
    expect(store().graded.has('z')).toBe(true);
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 1 });
  });

  it('syncPrices also refreshes cards only owned as slabs', async () => {
    await db.graded.put(makeGraded({ id: 'z', cardId: 'sv03-050' }));
    await store().load(); // kicks off a sync for cards without snapshots
    await vi.waitFor(() => expect(m.getCardsByIds.mock.calls.flat(2)).toContain('sv03-050'));
  });

  it('importData accepts valid slabs and skips junk', async () => {
    const n = await store().importData({
      collection: [],
      graded: [
        { cardId: 'sv03-001', variant: 'normal', company: 'CGC', grade: '9.5', valueUsd: -4 },
        { cardId: 'sv03-002', variant: 'normal', company: 'Nope', grade: '9' },
        { cardId: 'sv03-003', variant: 'normal', company: 'PSA', grade: '10', countsTowardSet: false, id: 'keep-id', setId: 'sv03' },
        null,
      ],
    });
    expect(n).toBe(2);
    const rows = await db.graded.toArray();
    expect(rows).toHaveLength(2);
    const cgc = rows.find((r) => r.company === 'CGC')!;
    expect(cgc).toMatchObject({ setId: 'sv03', countsTowardSet: true, valueUsd: undefined });
    expect(rows.find((r) => r.id === 'keep-id')?.countsTowardSet).toBe(false);
    expect(store().graded.size).toBe(2);
  });

  it('clearAll wipes slabs and photos too', async () => {
    const g = await store().saveGraded(card, input());
    await db.gradedPhotos.put({ id: 'p', gradedId: g.id, side: 'front', blob: new Blob(['x']), addedAt: 'a' });
    await store().clearAll();
    expect(store().graded.size).toBe(0);
    expect(store().holdings.size).toBe(0);
    expect(await db.graded.count()).toBe(0);
    expect(await db.gradedPhotos.count()).toBe(0);
  });

  it('useHoldings and useGradedFor expose the per-card views', async () => {
    const a = renderHook(() => useHoldings('sv03-001'));
    const b = renderHook(() => useGradedFor('sv03-001'));
    expect(a.result.current).toBeUndefined();
    expect(b.result.current).toEqual([]);
    const g = await store().saveGraded(card, input());
    a.rerender();
    b.rerender();
    expect(a.result.current).toEqual({ normal: 1 });
    expect(b.result.current).toEqual([g]);
  });
});

describe('card notes', () => {
  it('saves trimmed notes, caps their length and deletes blank ones', async () => {
    await store().setNote('sv03-001', '  From a car boot sale  ');
    expect(store().notes.get('sv03-001')).toBe('From a car boot sale');
    expect(await db.notes.get('sv03-001')).toMatchObject({ text: 'From a car boot sale' });
    await store().setNote('sv03-001', 'x'.repeat(NOTE_MAX + 50));
    expect(store().notes.get('sv03-001')).toHaveLength(NOTE_MAX);
    await store().setNote('sv03-001', '   ');
    expect(store().notes.has('sv03-001')).toBe(false);
    expect(await db.notes.count()).toBe(0);
  });

  it('keeps a note when every copy is removed, and loads it back', async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    await store().setNote('sv03-001', 'Pulled on my birthday');
    await store().removeCard('sv03-001');
    await store().load();
    expect(store().notes.get('sv03-001')).toBe('Pulled on my birthday');
    const { result } = renderHook(() => useNote('sv03-001'));
    expect(result.current).toBe('Pulled on my birthday');
    expect(renderHook(() => useNote('nope')).result.current).toBe('');
  });

  it('imports valid notes (even on their own) and skips junk', async () => {
    const n = await store().importData({ notes: [{ cardId: 'sv03-001', text: ' Trade with Sam ' }, { cardId: 'x', text: '  ' }, { text: 'orphan' }, null] });
    expect(n).toBe(0);
    expect(Array.from(store().notes)).toEqual([['sv03-001', 'Trade with Sam']]);
  });

  it('clearAll removes notes', async () => {
    await store().setNote('sv03-001', 'gone soon');
    await store().clearAll();
    expect(store().notes.size).toBe(0);
    expect(await db.notes.count()).toBe(0);
  });
});

describe('purchase prices', () => {
  const rates = { USD: 1, GBP: 0.5, EUR: 1 };
  const gbp = (amount: number) => ({ amount, currency: 'GBP' as const });

  it('costBasis compares cost with value only for copies that have a price', () => {
    const cards = new Map([['sv03-001', priced('sv03-001', { normal: 3, reverseHolofoil: 10 })]]);
    const entries = [makeEntry({ quantity: 2, paid: gbp(1) }), makeEntry({ id: 'x', variant: 'reverseHolofoil' })];
    const slabs = [makeGraded({ valueUsd: 100, paid: gbp(40) }), makeGraded({ id: 'g2', valueUsd: 50 })];
    expect(costBasis(entries, cards, slabs, rates)).toEqual({ costUsd: 2 * 2 + 80, valueUsd: 2 * 3 + 100, costed: 3 });
    expect(costBasis([], cards, [], rates)).toEqual({ costUsd: 0, valueUsd: 0, costed: 0 });
  });

  it('updateEntry stores a valid price, drops an invalid one and clears on undefined', async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    await store().updateEntry('sv03-001', 'normal', { paid: gbp(2.5) });
    expect(store().entries.get('sv03-001::normal')!.paid).toEqual(gbp(2.5));
    expect((await db.collection.get('sv03-001::normal'))!.paid).toEqual(gbp(2.5));
    await store().updateEntry('sv03-001', 'normal', { paid: { amount: -1, currency: 'GBP' } });
    expect(store().entries.get('sv03-001::normal')!.paid).toEqual(gbp(2.5));
    await store().updateEntry('sv03-001', 'normal', { paid: undefined });
    expect(store().entries.get('sv03-001::normal')).not.toHaveProperty('paid');
  });

  it('recordValue snapshots cost and costed value when prices are recorded', async () => {
    localStorage.setItem('poketracker-fx', JSON.stringify({ rates, at: Date.now() }));
    await store().remember([priced('a-1', { normal: 3 }), priced('b-1', { normal: 7 })]);
    useCollectionStore.setState({
      entries: new Map([
        ['a-1::normal', makeEntry({ id: 'a-1::normal', cardId: 'a-1', quantity: 2, paid: gbp(1) })],
        ['b-1::normal', makeEntry({ id: 'b-1::normal', cardId: 'b-1' })],
      ]),
    });
    await store().recordValue();
    expect(store().history[0]).toMatchObject({ valueUsd: 13, costUsd: 4, costedValueUsd: 6 });
    useCollectionStore.setState({ entries: new Map([['b-1::normal', makeEntry({ id: 'b-1::normal', cardId: 'b-1' })]]) });
    await store().recordValue();
    expect(store().history[0]).not.toHaveProperty('costUsd');
    localStorage.removeItem('poketracker-fx');
  });

  it('saveGraded and importData keep valid prices and discard bad ones', async () => {
    const card = priced('sv03-001');
    const ok = await store().saveGraded(card, { variant: 'normal', company: 'PSA', grade: '10', countsTowardSet: true, paid: gbp(60) });
    expect(ok.paid).toEqual(gbp(60));
    const bad = await store().saveGraded(card, { variant: 'normal', company: 'PSA', grade: '9', countsTowardSet: true, paid: { amount: 5, currency: 'XYZ' as 'GBP' } });
    expect(bad.paid).toBeUndefined();

    await store().importData({
      collection: [
        { cardId: 'a-1', variant: 'normal', paid: { amount: 4, currency: 'EUR' } },
        { cardId: 'b-1', variant: 'normal', paid: { amount: 'lots', currency: 'EUR' } },
      ],
      graded: [
        { id: 'g1', cardId: 'a-1', setId: 'a', variant: 'normal', company: 'CGC', grade: '9.5', countsTowardSet: false, addedAt: 'x', paid: { amount: 30, currency: 'USD' } },
        { id: 'g2', cardId: 'a-1', setId: 'a', variant: 'normal', company: 'CGC', grade: '9', countsTowardSet: false, addedAt: 'x', paid: 'free' },
      ],
    });
    expect(store().entries.get('a-1::normal')!.paid).toEqual({ amount: 4, currency: 'EUR' });
    expect(store().entries.get('b-1::normal')!.paid).toBeUndefined();
    expect(store().graded.get('g1')!.paid).toEqual({ amount: 30, currency: 'USD' });
    expect(store().graded.get('g2')!.paid).toBeUndefined();
  });
});
