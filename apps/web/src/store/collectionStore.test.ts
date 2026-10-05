import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CardSnapshot } from '../api/types';
import { ApiError } from '../api/http';
import { setBackend } from '../api/backend';
import { makeCard, makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { MemoryBackend, TEST_COLLECTION } from '../test/memoryBackend';
import { useToasts } from './toastStore';

const m = { getCardsByIds: vi.fn() };

import { ACTIVE_COLLECTION_KEY, costBasis, computeValue, gradedValue, indexGraded, indexHoldings, NOTE_MAX, ownedTotal, priceOf, useCollectionStore, useGradedFor, useHoldings, useNote, useOwned, useReadOnly, useWished, type GradedInput } from './collectionStore';

const initial = useCollectionStore.getState();
const store = () => useCollectionStore.getState();
const priced = (id: string, prices: Record<string, number> = { normal: 1, reverseHolofoil: 2 }, over: Partial<CardSnapshot> = {}) => makeSnapshot({ id, prices, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));
const toasts = () => useToasts.getState().toasts;

/** The server for this test; a fresh one per test. */
let mem: MemoryBackend;

beforeEach(() => {
  mem = new MemoryBackend();
  mem.catalog = m.getCardsByIds;
  setBackend(mem);
  useCollectionStore.setState({ ...initial, isLoaded: true, collectionId: TEST_COLLECTION, role: 'owner', readOnly: false }, true);
  useToasts.setState({ toasts: [] });
  m.getCardsByIds.mockReset().mockResolvedValue([]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  // let any fire-and-forget hydrate()/recordValue settle before the next test
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
  it('adds a new card, persists the entry, and indexes by card', async () => {
    const card = priced('sv03-001');
    await store().adjust(card, 'normal', 1);
    const e = store().entries.get('sv03-001::normal')!;
    expect(e).toMatchObject({ cardId: 'sv03-001', setId: 'sv03', variant: 'normal', quantity: 1, condition: 'NM' });
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 1 });
    expect(mem.collection.get('sv03-001::normal')).toMatchObject({ quantity: 1 });
    expect(store().cards.get('sv03-001')).toMatchObject({ name: 'Charmander' });
    // priced snapshot: no hydrate round-trip
    expect(mem.calls).not.toContain('hydrate');
  });

  it('accepts a full PokemonCard and converts it to a snapshot', async () => {
    await store().adjust(makeCard({ id: 'sv03-223', number: '223' }), 'holofoil', 1);
    expect(store().cards.get('sv03-223')).toMatchObject({ setId: 'sv03', number: '223', printedTotal: 197 });
    expect(store().byCard.get('sv03-223')).toEqual({ holofoil: 1 });
  });

  it('asks the server to hydrate unpriced cards', async () => {
    m.getCardsByIds.mockResolvedValue([makeCard({ id: 'sv03-002', tcgplayer: { url: 'u', updatedAt: '', prices: { normal: { market: 7 } } } })]);
    await store().adjust(priced('sv03-002', {}), 'normal', 1);
    await vi.waitFor(() => expect(store().cards.get('sv03-002')?.prices).toEqual({ normal: 7 }));
    expect(m.getCardsByIds).toHaveBeenCalledWith(['sv03-002']);
  });

  it('swallows hydrate failures', async () => {
    m.getCardsByIds.mockRejectedValue(new Error('offline'));
    await store().adjust(priced('sv03-002', {}), 'normal', 1);
    await flush();
    expect(store().entries.size).toBe(1);
    expect(toasts()).toHaveLength(0);
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
    expect(mem.collection.size).toBe(0);
  });

  it('ignores removing a card that is not owned', async () => {
    await store().adjust(priced('sv03-001'), 'normal', -1);
    expect(store().entries.size).toBe(0);
    expect(mem.calls).not.toContain('deleteEntries');
  });

  it('asks the server to record the value 1.5s after the last change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mem.cards.set('sv03-001', priced('sv03-001'));
    useCollectionStore.setState({ recordValue: initial.recordValue });
    await store().adjust(priced('sv03-001'), 'normal', 1);
    await store().adjust(priced('sv03-001'), 'normal', 1);
    expect(store().history).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(store().history).toHaveLength(1));
    expect(store().history[0]).toMatchObject({ valueUsd: 2, cards: 2, unique: 1 });
    expect(mem.calls.filter((c) => c === 'recordValue')).toHaveLength(1);
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
    expect(store().cards.size).toBe(0);
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
    expect(mem.collection.get('sv03-001::normal')).toMatchObject({ condition: 'LP' });
    await store().updateEntry('nope-1', 'normal', { notes: 'x' });
    expect(store().entries.has('nope-1::normal')).toBe(false);
  });

  it('removeCard deletes every variant and restoreEntries undoes it', async () => {
    const removed = await store().removeCard('sv03-001');
    expect(removed).toHaveLength(2);
    expect(store().entries.size).toBe(0);
    expect(mem.collection.size).toBe(0);
    await store().restoreEntries(removed);
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 1, reverseHolofoil: 1 });
    expect(mem.collection.size).toBe(2);
  });
});

describe('wishlist', () => {
  it('toggles on and off, persisting each time', async () => {
    const card = priced('sv03-050');
    expect(await store().toggleWishlist(card)).toBe(true);
    expect(store().wishlist.has('sv03-050')).toBe(true);
    expect(mem.wishlist.get('sv03-050')).toBeDefined();
    expect(store().cards.has('sv03-050')).toBe(true);
    expect(await store().toggleWishlist(card)).toBe(false);
    expect(store().wishlist.size).toBe(0);
    expect(mem.wishlist.size).toBe(0);
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
    expect(mem.calls.filter((c) => c === 'putSetStat')).toHaveLength(1);
    await store().recordSetStat('sv03', 410);
    expect(mem.setStats.get('sv03')!.masterTotal).toBe(410);
  });

  it('keeps the total locally but skips the server when read-only', async () => {
    useCollectionStore.setState({ readOnly: true });
    await store().recordSetStat('sv03', 400);
    expect(store().setStats.get('sv03')!.masterTotal).toBe(400);
    expect(mem.calls).not.toContain('putSetStat');
  });
});

describe('recordValue', () => {
  it('skips an empty collection with no history', async () => {
    await store().recordValue();
    expect(mem.valueHistory.size).toBe(0);
    expect(store().history).toEqual([]);
  });

  it('writes one point per day, replacing today', async () => {
    useCollectionStore.setState({ history: [{ date: '2000-01-01', valueUsd: 1, cards: 1, unique: 1 }] });
    mem.valueHistory.set('2000-01-01', { date: '2000-01-01', valueUsd: 1, cards: 1, unique: 1 });
    await store().recordValue();
    await store().recordValue();
    expect(store().history).toHaveLength(2);
    expect(store().history[1]).toMatchObject({ valueUsd: 0, cards: 0 });
  });

  it('rounds to the penny', async () => {
    mem.cards.set('a-1', priced('a-1', { normal: 0.333 }));
    mem.collection.set('a-1::normal', makeEntry({ id: 'a-1::normal', cardId: 'a-1', quantity: 3 }));
    await store().recordValue();
    expect(store().history[0].valueUsd).toBe(1);
  });

  it('leaves history alone when the server is unavailable', async () => {
    mem.fail = new Error('offline');
    await store().recordValue();
    expect(store().history).toEqual([]);
    expect(toasts()).toHaveLength(0);
  });
});

describe('syncPrices', () => {
  beforeEach(() => {
    mem.collection.set('a-1::normal', makeEntry({ id: 'a-1::normal', cardId: 'a-1' }));
    mem.wishlist.set('c-3', { cardId: 'c-3', addedAt: 'x' });
  });

  it('reloads from the server without asking for a refresh unless forced', async () => {
    mem.cards.set('a-1', priced('a-1'));
    mem.lastPriceSync = '2025-01-01T00:00:00.000Z';
    expect(await store().syncPrices()).toBe(1);
    expect(mem.calls).not.toContain('refreshPrices');
    expect(store().entries.has('a-1::normal')).toBe(true);
    expect(store().lastSync).toBe('2025-01-01T00:00:00.000Z');
    expect(store().syncing).toBe(false);
  });

  it('asks the server to refresh every tracked card when forced', async () => {
    m.getCardsByIds.mockResolvedValue([makeCard({ id: 'a-1' }), makeCard({ id: 'c-3' })]);
    expect(await store().syncPrices(true)).toBe(2);
    expect(m.getCardsByIds).toHaveBeenCalledWith(['a-1', 'c-3']);
    expect(store().lastSync).toBe(mem.lastPriceSync);
    expect(store().lastSync).not.toBeNull();
  });

  it("falls back to the server's latest prices when the user can't trigger a refresh", async () => {
    vi.spyOn(mem, 'refreshPrices').mockRejectedValue(new ApiError(403, 'Admins only', 'forbidden'));
    mem.cards.set('a-1', priced('a-1'));
    expect(await store().syncPrices(true)).toBe(1);
    expect(mem.calls).toContain('state');
  });

  it("doesn't ask for a refresh on a read-only collection", async () => {
    useCollectionStore.setState({ readOnly: true });
    await store().syncPrices(true);
    expect(mem.calls).not.toContain('refreshPrices');
  });

  it('returns 0 if a sync is already running', async () => {
    useCollectionStore.setState({ syncing: true });
    expect(await store().syncPrices(true)).toBe(0);
    expect(mem.calls).toHaveLength(0);
  });

  it('returns -1 when the server refresh fails', async () => {
    m.getCardsByIds.mockRejectedValue(new Error('offline'));
    expect(await store().syncPrices(true)).toBe(-1);
    expect(store().syncing).toBe(false);
    expect(store().lastSync).toBeNull();
  });
});

describe('load', () => {
  beforeEach(() => useCollectionStore.setState({ ...initial }, true));

  it('reads the personal collection from the server', async () => {
    mem.collection.set('sv03-001::normal', makeEntry({ quantity: 2 }));
    mem.cards.set('sv03-001', priced('sv03-001'));
    mem.wishlist.set('sv03-009', { cardId: 'sv03-009', addedAt: 'x' });
    mem.setStats.set('sv03', { setId: 'sv03', masterTotal: 400, syncedAt: 'x' });
    mem.valueHistory.set('2025-01-02', { date: '2025-01-02', valueUsd: 2, cards: 1, unique: 1 });
    mem.valueHistory.set('2025-01-01', { date: '2025-01-01', valueUsd: 1, cards: 1, unique: 1 });
    mem.lastPriceSync = '2025-01-02T06:00:00.000Z';
    await store().load();
    expect(store()).toMatchObject({ isLoaded: true, loadError: null, collectionId: TEST_COLLECTION, role: 'owner', readOnly: false });
    expect(store().collections).toHaveLength(1);
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 2 });
    expect(store().cards.size).toBe(1);
    expect(store().wishlist.has('sv03-009')).toBe(true);
    expect(store().setStats.get('sv03')!.masterTotal).toBe(400);
    expect(store().history.map((h) => h.date)).toEqual(['2025-01-01', '2025-01-02']);
    await vi.waitFor(() => expect(store().lastSync).toBe('2025-01-02T06:00:00.000Z'));
  });

  it('opens a viewer collection read-only', async () => {
    mem.role = 'viewer';
    await store().load();
    expect(store()).toMatchObject({ role: 'viewer', readOnly: true });
    expect(renderHook(() => useReadOnly()).result.current).toBe(true);
  });

  it('opens the requested collection, else the last one used, else the personal one', async () => {
    const shared = new MemoryBackend();
    shared.catalog = m.getCardsByIds;
    shared.collectionId = 'c-shared';
    shared.role = 'editor';
    shared.collection.set('sv03-001::normal', makeEntry());
    vi.spyOn(mem, 'collections').mockResolvedValue([
      { id: 'c-shared', name: 'Family binder', kind: 'shared', role: 'editor', ownerName: 'Misty', mine: false },
      { id: TEST_COLLECTION, name: 'My collection', kind: 'personal', role: 'owner', ownerName: 'Ash', mine: true },
    ]);
    vi.spyOn(mem, 'state').mockImplementation((cid) => (cid === 'c-shared' ? shared.state(cid) : MemoryBackend.prototype.state.call(mem, cid)));

    await store().load();
    expect(store().collectionId).toBe(TEST_COLLECTION);

    await store().load('c-shared');
    expect(store()).toMatchObject({ collectionId: 'c-shared', role: 'editor', readOnly: false });
    expect(store().entries.size).toBe(1);
    expect(localStorage.getItem(ACTIVE_COLLECTION_KEY)).toBe('c-shared');

    await store().load();
    expect(store().collectionId).toBe('c-shared');

    await store().load('gone');
    expect(store().collectionId).toBe('c-shared');
  });

  it('only applies the latest of overlapping loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = mem.state.bind(mem);
    vi.spyOn(mem, 'state').mockImplementationOnce(async (cid) => {
      await gate;
      return { ...(await real(cid)), role: 'viewer' };
    });
    const slow = store().load();
    await store().load();
    release();
    await slow;
    expect(store().role).toBe('owner');
  });

  it('reports a load failure instead of hanging', async () => {
    mem.fail = new Error('offline');
    await store().load();
    expect(store()).toMatchObject({ isLoaded: true, loadError: 'offline' });
  });

  it('refresh() reloads the current collection', async () => {
    await store().load();
    mem.collection.set('sv03-001::normal', makeEntry());
    await store().refresh();
    expect(store().entries.size).toBe(1);
  });
});

describe('importData', () => {
  it('sends the file to the server and reloads', async () => {
    const file = { collection: [{ cardId: 'sv03-001', variant: 'normal', quantity: 3 }], wishlist: [{ cardId: 'sv03-010' }], graded: [{ cardId: 'sv03-002', variant: 'normal', company: 'PSA', grade: '10' }] };
    expect(await store().importData(file)).toBe(2);
    expect(mem.calls).toEqual(expect.arrayContaining(['importData', 'state']));
    expect(store().entries.get('sv03-001::normal')).toMatchObject({ quantity: 3 });
    expect([...store().wishlist.keys()]).toEqual(['sv03-010']);
    expect(store().graded.size).toBe(1);
  });

  it('accepts a wishlist-only file', async () => {
    expect(await store().importData({ collection: [], wishlist: [{ cardId: 'a-1', addedAt: 'x' }] })).toBe(0);
    expect(store().wishlist.has('a-1')).toBe(true);
  });

  it.each([[{}], [null], [[{ foo: 1 }]], ['text']])('rejects %o', async (bad) => {
    await expect(store().importData(bad)).rejects.toThrow('No collection entries found in file');
  });

  it('surfaces server errors', async () => {
    mem.fail = new ApiError(400, 'No collection entries found in that file', 'bad_request');
    await expect(store().importData({ collection: [] })).rejects.toThrow('No collection entries found in that file');
  });

  it("refuses to import into a collection you can only view", async () => {
    useCollectionStore.setState({ readOnly: true });
    await expect(store().importData({ collection: [] })).rejects.toThrow(/only view/);
    expect(mem.calls).toHaveLength(0);
  });
});

describe('clearAll', () => {
  it('empties the collection, wishlist and history on the server but keeps card snapshots', async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    await store().toggleWishlist(priced('sv03-002'));
    useCollectionStore.setState({ history: [{ date: '2025-01-01', valueUsd: 1, cards: 1, unique: 1 }] });
    await store().clearAll();
    expect(store().entries.size + store().wishlist.size + store().history.length).toBe(0);
    expect(mem.collection.size + mem.wishlist.size + mem.valueHistory.size).toBe(0);
    expect(store().cards.size).toBe(2);
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
    expect(mem.graded.get(saved.id)).toEqual(saved);
    expect(store().graded.get(saved.id)).toEqual(saved);
    expect(store().gradedByCard.get('sv03-001')).toEqual([saved]);
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 1 });
    expect(store().byCard.has('sv03-001')).toBe(false);
    expect(store().cards.has('sv03-001')).toBe(true);
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

  it('removeGraded soft-deletes on the server so restoreGraded brings back the slab and its photos', async () => {
    const g = await store().saveGraded(card, input());
    await mem.addPhotos(TEST_COLLECTION, g.id, [new Blob(['x'])], 'front');
    const removed = await store().removeGraded(g.id);
    expect(removed?.copy).toEqual(g);
    expect(store().graded.size).toBe(0);
    expect(store().holdings.has('sv03-001')).toBe(false);
    expect(mem.deletedGraded.has(g.id)).toBe(true);
    expect(mem.gradedPhotos.size).toBe(1);

    await store().restoreGraded(removed!.copy, removed!.photos);
    expect(store().graded.get(g.id)).toEqual(g);
    expect(mem.deletedGraded.size).toBe(0);
    expect(await mem.photos(TEST_COLLECTION, g.id)).toHaveLength(1);
    expect(await store().removeGraded('missing')).toBeUndefined();
  });

  it('load reads slabs back and derives the indexes', async () => {
    mem.graded.set('z', makeGraded({ id: 'z' }));
    await store().load();
    expect(store().graded.has('z')).toBe(true);
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 1 });
  });

  it('a forced price refresh includes cards only owned as slabs', async () => {
    mem.graded.set('z', makeGraded({ id: 'z', cardId: 'sv03-050' }));
    await store().syncPrices(true);
    expect(m.getCardsByIds.mock.calls.flat(2)).toContain('sv03-050');
  });

  it('clearAll wipes slabs and photos too', async () => {
    const g = await store().saveGraded(card, input());
    await mem.addPhotos(TEST_COLLECTION, g.id, [new Blob(['x'])], 'front');
    await store().clearAll();
    expect(store().graded.size).toBe(0);
    expect(store().holdings.size).toBe(0);
    expect(mem.graded.size + mem.gradedPhotos.size).toBe(0);
  });

  it('saveGraded throws (and rolls back) when the server refuses', async () => {
    mem.fail = new ApiError(400, 'Invalid grade', 'bad_request');
    await expect(store().saveGraded(card, input())).rejects.toThrow("Couldn't save the graded copy");
    expect(store().graded.size).toBe(0);
    expect(toasts()[0]).toMatchObject({ message: 'Invalid grade', tone: 'error' });
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
    expect(mem.notes.get('sv03-001')).toMatchObject({ text: 'From a car boot sale' });
    await store().setNote('sv03-001', 'x'.repeat(NOTE_MAX + 50));
    expect(store().notes.get('sv03-001')).toHaveLength(NOTE_MAX);
    await store().setNote('sv03-001', '   ');
    expect(store().notes.has('sv03-001')).toBe(false);
    expect(mem.notes.size).toBe(0);
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

  it('imports a notes-only file', async () => {
    expect(await store().importData({ notes: [{ cardId: 'sv03-001', text: ' Trade with Sam ' }] })).toBe(0);
    expect(Array.from(store().notes)).toEqual([['sv03-001', 'Trade with Sam']]);
  });

  it('clearAll removes notes', async () => {
    await store().setNote('sv03-001', 'gone soon');
    await store().clearAll();
    expect(store().notes.size).toBe(0);
    expect(mem.notes.size).toBe(0);
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
    expect(mem.collection.get('sv03-001::normal')!.paid).toEqual(gbp(2.5));
    await store().updateEntry('sv03-001', 'normal', { paid: { amount: -1, currency: 'GBP' } });
    expect(store().entries.get('sv03-001::normal')!.paid).toEqual(gbp(2.5));
    await store().updateEntry('sv03-001', 'normal', { paid: undefined });
    expect(store().entries.get('sv03-001::normal')).not.toHaveProperty('paid');
  });

  it('recordValue snapshots cost and costed value when prices are recorded', async () => {
    localStorage.setItem('poketracker-fx', JSON.stringify({ rates, at: Date.now() }));
    mem.cards.set('a-1', priced('a-1', { normal: 3 }));
    mem.cards.set('b-1', priced('b-1', { normal: 7 }));
    mem.collection.set('a-1::normal', makeEntry({ id: 'a-1::normal', cardId: 'a-1', quantity: 2, paid: gbp(1) }));
    mem.collection.set('b-1::normal', makeEntry({ id: 'b-1::normal', cardId: 'b-1' }));
    await store().recordValue();
    expect(store().history[0]).toMatchObject({ valueUsd: 13, costUsd: 4, costedValueUsd: 6 });
    mem.collection.delete('a-1::normal');
    await store().recordValue();
    expect(store().history[0]).not.toHaveProperty('costUsd');
    localStorage.removeItem('poketracker-fx');
  });

  it('saveGraded keeps a valid price and discards a bad one', async () => {
    const card = priced('sv03-001');
    const ok = await store().saveGraded(card, { variant: 'normal', company: 'PSA', grade: '10', countsTowardSet: true, paid: gbp(60) });
    expect(ok.paid).toEqual(gbp(60));
    const bad = await store().saveGraded(card, { variant: 'normal', company: 'PSA', grade: '9', countsTowardSet: true, paid: { amount: 5, currency: 'XYZ' as 'GBP' } });
    expect(bad.paid).toBeUndefined();
  });
});

describe('optimistic writes', () => {
  it('rolls back and explains when the server rejects a change', async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    mem.fail = new ApiError(403, "You can't edit this collection", 'forbidden');
    await store().adjust(priced('sv03-001'), 'normal', 1);
    expect(store().entries.get('sv03-001::normal')!.quantity).toBe(1);
    expect(store().byCard.get('sv03-001')).toEqual({ normal: 1 });
    expect(toasts()[0]).toMatchObject({ message: "You can't edit this collection", tone: 'error' });
  });

  it('uses a generic message for network failures', async () => {
    mem.fail = new Error('fetch failed');
    expect(await store().toggleWishlist(priced('sv03-050'))).toBe(false);
    expect(store().wishlist.size).toBe(0);
    expect(toasts()[0].message).toMatch(/Couldn't save that change/);
  });

  it('removeCard returns nothing to undo when the delete fails', async () => {
    await store().adjust(priced('sv03-001'), 'normal', 1);
    mem.fail = new Error('offline');
    expect(await store().removeCard('sv03-001')).toEqual([]);
    expect(store().entries.size).toBe(1);
  });

  it('rolls back notes and list changes too', async () => {
    const list = (await store().createList('Trade binder'))!;
    mem.fail = new Error('offline');
    await store().setNote('sv03-001', 'nope');
    expect(store().notes.size).toBe(0);
    await store().deleteList(list.id);
    expect(store().lists).toHaveLength(1);
  });
});

describe('read-only collections', () => {
  beforeEach(() => useCollectionStore.setState({ readOnly: true, role: 'viewer' }));

  it('ignores every write without calling the server', async () => {
    const card = priced('sv03-001');
    await store().adjust(card, 'normal', 1);
    await store().setQuantity('sv03-001', 'normal', 2);
    await store().updateEntry('sv03-001', 'normal', { condition: 'LP' });
    expect(await store().removeCard('sv03-001')).toEqual([]);
    await store().restoreEntries([makeEntry()]);
    expect(await store().toggleWishlist(card)).toBe(false);
    await store().setNote('sv03-001', 'x');
    await store().recordValue();
    await store().clearAll();
    expect(await store().createList('x')).toBeUndefined();
    expect(await store().removeGraded('x')).toBeUndefined();
    expect(store().entries.size + store().wishlist.size + store().notes.size).toBe(0);
    expect(mem.calls).toEqual([]);
  });
});

describe('custom lists', () => {
  it('creates, renames, reorders and deletes lists', async () => {
    const list = (await store().createList('Trade binder', 'For league night'))!;
    expect(store().lists).toEqual([expect.objectContaining({ id: list.id, name: 'Trade binder', description: 'For league night', cards: [] })]);
    await store().updateList(list.id, { name: 'Trades', description: '' });
    expect(store().lists[0]).toMatchObject({ name: 'Trades', description: undefined });
    expect(mem.lists[0]).toMatchObject({ name: 'Trades', description: undefined });
    await store().deleteList(list.id);
    expect(store().lists).toEqual([]);
    expect(mem.lists).toEqual([]);
  });

  it('toggles cards in and out, keeping their snapshot and server order', async () => {
    const list = (await store().createList('Chase cards'))!;
    expect(await store().toggleInList(list.id, priced('sv03-001'))).toBe(true);
    expect(await store().toggleInList(list.id, makeCard({ id: 'sv03-002' }))).toBe(true);
    expect(store().cards.has('sv03-002')).toBe(true);
    expect(mem.lists[0].cards).toEqual(['sv03-001', 'sv03-002']);
    await store().updateList(list.id, { order: ['sv03-002'] });
    expect(store().lists[0].cards).toEqual(['sv03-002', 'sv03-001']);
    expect(mem.lists[0].cards).toEqual(['sv03-002', 'sv03-001']);
    expect(await store().toggleInList(list.id, priced('sv03-002'))).toBe(false);
    expect(mem.lists[0].cards).toEqual(['sv03-001']);
    expect(await store().toggleInList('missing', priced('sv03-002'))).toBe(false);
  });

  it('reports a failed create', async () => {
    mem.fail = new ApiError(400, 'Name is required', 'bad_request');
    expect(await store().createList('')).toBeUndefined();
    expect(toasts()[0].message).toBe('Name is required');
  });
});

describe('show', () => {
  it('displays shared data read-only with derived indexes', () => {
    store().show({
      collectionId: 'share',
      entries: new Map([['sv03-001::normal', makeEntry({ quantity: 2 })]]),
      graded: new Map([['g', makeGraded({ id: 'g' })]]),
    });
    expect(store()).toMatchObject({ isLoaded: true, readOnly: true, role: 'viewer', collectionId: 'share' });
    expect(store().holdings.get('sv03-001')).toEqual({ normal: 3 });
    expect(store().wishlist.size).toBe(0);
  });
});
