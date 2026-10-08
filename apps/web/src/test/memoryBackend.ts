import { getCardsByIds, setIdFromCardId, toSnapshot } from '../api/client';
import type { Backend, CollectionData, CollectionRole, CollectionSummary, CustomList, ImportResult, PcProduct, PhotoRef, ProviderHealthReport, SystemStatus } from '../api/backend';
import type { CardNote, CardPriceHistory, CardSnapshot, PokemonCard, CollectionEntry, GradedCopy, MoverCard, SealedItem, SetStat, ValuePoint, WishlistEntry } from '../api/types';
import { entryKey, GRADING_COMPANIES, isPaid, NOTE_MAX, valuePoint } from '@poketracker/shared/value';
import { currentRates } from '../utils/fx';

export const TEST_COLLECTION = 'c-personal';

interface StoredPhoto {
  id: string;
  gradedId: string;
  side: PhotoRef['side'];
  addedAt: string;
}

interface StoredSealedPhoto {
  id: string;
  sealedId: string;
  addedAt: string;
}

let seq = 0;
const id = () => `m${++seq}`;

/**
 * In-memory stand-in for the PokéTracker server with the same semantics as the real API:
 * soft-deleted slabs keep their photos, listings never wipe prices, and hydrate/refresh go
 * through the (fetch-mocked) catalogue just like the server does.
 */
export class MemoryBackend implements Backend {
  readOnly = false;
  role: CollectionRole = 'owner';
  collectionId = TEST_COLLECTION;
  collection = new Map<string, CollectionEntry>();
  cards = new Map<string, CardSnapshot>();
  wishlist = new Map<string, WishlistEntry>();
  valueHistory = new Map<string, ValuePoint>();
  setStats = new Map<string, SetStat>();
  graded = new Map<string, GradedCopy>();
  deletedGraded = new Set<string>();
  gradedPhotos = new Map<string, StoredPhoto>();
  sealed = new Map<string, SealedItem>();
  sealedPhotosStore = new Map<string, StoredSealedPhoto>();
  notes = new Map<string, CardNote>();
  lists: CustomList[] = [];
  lastPriceSync: string | null = null;
  /** Fake per-card price history, keyed by cardId. Tests seed this directly; defaults to no history. */
  priceHistories = new Map<string, CardPriceHistory>();
  /** When set, movers() returns this canned response instead of computing one from state. */
  moversResponse: { gainers: MoverCard[]; losers: MoverCard[] } | null = null;
  /** The catalogue the "server" hydrates from; swap in a mock to control prices. */
  catalog: (ids: string[]) => Promise<PokemonCard[]> = getCardsByIds;
  /** Controls pcConfigured()/pcAdminStatus(); tests flip this to show/hide PriceCharting UI. */
  pricechartingConfigured = false;
  /** What pcSearch() returns regardless of query, for tests to seed. */
  pcResults: PcProduct[] = [];
  /** Set to make every call reject, e.g. to test optimistic rollback */
  fail: Error | null = null;
  calls: string[] = [];

  private async call<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    this.calls.push(name);
    await Promise.resolve();
    if (this.fail) throw this.fail;
    return fn();
  }

  private callIn<T>(cid: string, name: string, fn: () => T | Promise<T>): Promise<T> {
    return this.call(name, () => {
      this.check(cid);
      return fn();
    });
  }

  private check(cid: string) {
    if (cid !== this.collectionId) throw new Error(`Unknown collection ${cid}`);
  }

  collections(): Promise<CollectionSummary[]> {
    return this.call('collections', () => [{ id: this.collectionId, name: 'My collection', kind: 'personal', role: this.role, ownerName: 'Ash', mine: this.role === 'owner' }]);
  }

  state(cid: string) {
    return this.callIn(cid, 'state', (): CollectionData => {
      const graded = [...this.graded.values()].filter((g) => !this.deletedGraded.has(g.id));
      const ids = new Set([...[...this.collection.values()].map((e) => e.cardId), ...graded.map((g) => g.cardId), ...this.wishlist.keys(), ...this.lists.flatMap((l) => l.cards)]);
      return {
        role: this.role,
        entries: [...this.collection.values()],
        graded,
        sealed: [...this.sealed.values()],
        wishlist: [...this.wishlist.values()],
        notes: [...this.notes.values()],
        history: [...this.valueHistory.values()].sort((a, b) => a.date.localeCompare(b.date)),
        cards: [...this.cards.values()].filter((c) => ids.has(c.id)),
        setStats: [...this.setStats.values()],
        lists: this.lists.map((l) => ({ ...l, cards: [...l.cards] })),
      };
    });
  }

  putEntries(cid: string, entries: CollectionEntry[]) {
    return this.callIn(cid, 'putEntries', () => {
      for (const e of entries) this.collection.set(e.id, { ...e });
    });
  }

  deleteEntries(cid: string, ids: string[]) {
    return this.callIn(cid, 'deleteEntries', () => {
      ids.forEach((i) => this.collection.delete(i));
    });
  }

  putWishlist(cid: string, w: WishlistEntry) {
    return this.callIn(cid, 'putWishlist', () => void this.wishlist.set(w.cardId, { ...w }));
  }

  deleteWishlist(cid: string, cardId: string) {
    return this.callIn(cid, 'deleteWishlist', () => void this.wishlist.delete(cardId));
  }

  putNote(cid: string, cardId: string, text: string) {
    return this.callIn(cid, 'putNote', () => {
      const clean = text.trim().slice(0, NOTE_MAX);
      if (clean) this.notes.set(cardId, { cardId, text: clean, updatedAt: new Date().toISOString() });
      else this.notes.delete(cardId);
    });
  }

  putGraded(cid: string, copy: GradedCopy) {
    return this.callIn(cid, 'putGraded', () => {
      this.graded.set(copy.id, { ...copy });
      this.deletedGraded.delete(copy.id);
    });
  }

  deleteGraded(cid: string, gid: string) {
    return this.callIn(cid, 'deleteGraded', () => void this.deletedGraded.add(gid));
  }

  linkGraded(cid: string, gid: string, pcProductId: string) {
    return this.callIn(cid, 'linkGraded', (): GradedCopy => {
      const copy = this.graded.get(gid);
      if (!copy) throw new Error('Graded copy not found');
      const updated = { ...copy, pcProductId, pcPrice: 42, pcUpdatedAt: new Date().toISOString() };
      this.graded.set(gid, updated);
      return { ...updated };
    });
  }

  /** What the cleanup job does a day after a slab is deleted. */
  purgeDeleted() {
    for (const gid of this.deletedGraded) {
      this.graded.delete(gid);
      for (const [pid, p] of this.gradedPhotos) if (p.gradedId === gid) this.gradedPhotos.delete(pid);
    }
    this.deletedGraded.clear();
  }

  photos(cid: string, gid: string) {
    return this.callIn(cid, 'photos', () =>
      [...this.gradedPhotos.values()]
        .filter((p) => p.gradedId === gid)
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
        .map((p) => ({ id: p.id, side: p.side, addedAt: p.addedAt, url: `/api/collections/${cid}/photos/${p.id}` })),
    );
  }

  addPhotos(cid: string, gid: string, files: Blob[], side: PhotoRef['side']) {
    return this.callIn(cid, 'addPhotos', () => {
      if (!this.graded.has(gid)) throw new Error('Save the graded copy first');
      return files.map(() => {
        const p = { id: id(), gradedId: gid, side, addedAt: new Date().toISOString() };
        this.gradedPhotos.set(p.id, p);
        return { ...p, url: `/api/collections/${cid}/photos/${p.id}` };
      });
    });
  }

  deletePhoto(cid: string, pid: string) {
    return this.callIn(cid, 'deletePhoto', () => void this.gradedPhotos.delete(pid));
  }

  putSealed(cid: string, item: SealedItem) {
    return this.callIn(cid, 'putSealed', () => {
      this.sealed.set(item.id, { ...item });
      return { ...item };
    });
  }

  deleteSealed(cid: string, sid: string) {
    return this.callIn(cid, 'deleteSealed', () => {
      this.sealed.delete(sid);
      for (const [pid, p] of this.sealedPhotosStore) if (p.sealedId === sid) this.sealedPhotosStore.delete(pid);
    });
  }

  openSealed(cid: string, sid: string) {
    return this.callIn(cid, 'openSealed', (): SealedItem => {
      const item = this.sealed.get(sid);
      if (!item) throw new Error('Sealed item not found');
      const updated: SealedItem = { ...item, status: 'opened', openedAt: new Date().toISOString() };
      this.sealed.set(sid, updated);
      return { ...updated };
    });
  }

  linkSealed(cid: string, sid: string, pcProductId: string) {
    return this.callIn(cid, 'linkSealed', (): SealedItem => {
      const item = this.sealed.get(sid);
      if (!item) throw new Error('Sealed item not found');
      const updated = { ...item, pcProductId, pcPrice: 42, pcUpdatedAt: new Date().toISOString() };
      this.sealed.set(sid, updated);
      return { ...updated };
    });
  }

  sealedPhotos(cid: string, sid: string) {
    return this.callIn(cid, 'sealedPhotos', () =>
      [...this.sealedPhotosStore.values()]
        .filter((p) => p.sealedId === sid)
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
        .map((p) => ({ id: p.id, side: 'other' as const, addedAt: p.addedAt, url: `/api/collections/${cid}/photos/sealed/${p.id}` })),
    );
  }

  addSealedPhotos(cid: string, sid: string, files: Blob[]) {
    return this.callIn(cid, 'addSealedPhotos', () => {
      if (!this.sealed.has(sid)) throw new Error('Save the sealed item first');
      return files.map(() => {
        const p = { id: id(), sealedId: sid, addedAt: new Date().toISOString() };
        this.sealedPhotosStore.set(p.id, p);
        return { id: p.id, side: 'other' as const, addedAt: p.addedAt, url: `/api/collections/${cid}/photos/sealed/${p.id}` };
      });
    });
  }

  deleteSealedPhoto(cid: string, pid: string) {
    return this.callIn(cid, 'deleteSealedPhoto', () => void this.sealedPhotosStore.delete(pid));
  }

  pcConfigured() {
    return this.call('pcConfigured', () => this.pricechartingConfigured);
  }

  /** Ignores the query; tests seed canned results via `pcResults` instead. */
  pcSearch(query: string) {
    void query;
    return this.call('pcSearch', () => this.pcResults);
  }

  pcAdminStatus() {
    return this.call('pcAdminStatus', () => this.pricechartingConfigured);
  }

  /** Ignores the key's value; what matters for tests is that a key becomes "configured". */
  pcSetKey(key: string) {
    void key;
    return this.call('pcSetKey', () => void (this.pricechartingConfigured = true));
  }

  pcClearKey() {
    return this.call('pcClearKey', () => void (this.pricechartingConfigured = false));
  }

  pcTest() {
    return this.call('pcTest', () => undefined);
  }

  recordValue(cid: string) {
    return this.callIn(cid, 'recordValue', () => {
      const graded = [...this.graded.values()].filter((g) => !this.deletedGraded.has(g.id));
      const point = valuePoint(this.collection.values(), this.cards, graded, currentRates(), this.valueHistory.size > 0);
      if (!point) return null;
      this.valueHistory.set(point.date, point);
      return point;
    });
  }

  importData(cid: string, data: unknown) {
    return this.callIn(cid, 'importData', (): ImportResult => {
      const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(obj.collection) ? obj.collection : [];
      let entries = 0;
      for (const r of raw) {
        const e = r as Partial<CollectionEntry>;
        if (typeof e?.cardId !== 'string' || typeof e.variant !== 'string') continue;
        const key = entryKey(e.cardId, e.variant);
        this.collection.set(key, {
          id: key,
          cardId: e.cardId,
          setId: e.setId ?? setIdFromCardId(e.cardId),
          variant: e.variant,
          quantity: Math.max(1, Math.floor(Number(e.quantity) || 1)),
          condition: e.condition,
          notes: e.notes,
          paid: isPaid(e.paid) ? { amount: e.paid.amount, currency: e.paid.currency } : undefined,
          addedAt: e.addedAt ?? new Date().toISOString(),
        });
        entries++;
      }
      let graded = 0;
      for (const r of Array.isArray(obj.graded) ? obj.graded : []) {
        const g = r as Partial<GradedCopy>;
        if (typeof g?.cardId !== 'string' || typeof g.variant !== 'string' || typeof g.grade !== 'string' || !GRADING_COMPANIES.has(g.company as string)) continue;
        const copy = { ...g, id: typeof g.id === 'string' ? g.id : id(), setId: g.setId ?? setIdFromCardId(g.cardId), countsTowardSet: g.countsTowardSet !== false, addedAt: g.addedAt ?? new Date().toISOString() } as GradedCopy;
        this.graded.set(copy.id, copy);
        graded++;
      }
      let sealed = 0;
      for (const r of Array.isArray(obj.sealed) ? obj.sealed : []) {
        const sp = r as Partial<SealedItem>;
        if (typeof sp?.name !== 'string' || !sp.name.trim() || typeof sp.productType !== 'string') continue;
        const item = { ...sp, id: typeof sp.id === 'string' ? sp.id : id(), quantity: Math.max(1, Math.floor(Number(sp.quantity) || 1)), status: sp.status === 'opened' ? 'opened' : 'sealed', addedAt: sp.addedAt ?? new Date().toISOString() } as SealedItem;
        this.sealed.set(item.id, item);
        sealed++;
      }
      let notes = 0;
      for (const r of Array.isArray(obj.notes) ? obj.notes : []) {
        const n = r as Partial<CardNote>;
        if (typeof n?.cardId !== 'string' || typeof n.text !== 'string' || !n.text.trim()) continue;
        this.notes.set(n.cardId, { cardId: n.cardId, text: n.text.trim().slice(0, NOTE_MAX), updatedAt: n.updatedAt ?? new Date().toISOString() });
        notes++;
      }
      let wishlist = 0;
      for (const r of Array.isArray(obj.wishlist) ? obj.wishlist : []) {
        const w = r as Partial<WishlistEntry>;
        if (typeof w?.cardId !== 'string') continue;
        this.wishlist.set(w.cardId, { cardId: w.cardId, addedAt: w.addedAt ?? new Date().toISOString() });
        wishlist++;
      }
      return { entries, graded, sealed, wishlist, notes, history: 0, photos: 0, remapped: 0 };
    });
  }

  clear(cid: string) {
    return this.callIn(cid, 'clear', () => {
      for (const m of [this.collection, this.wishlist, this.valueHistory, this.graded, this.gradedPhotos, this.sealed, this.sealedPhotosStore, this.notes]) m.clear();
      this.deletedGraded.clear();
      this.lists = [];
    });
  }

  private async fetchCards(ids: string[]) {
    let refreshed = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i += 40) {
      try {
        for (const c of await this.catalog(ids.slice(i, i + 40))) {
          this.cards.set(c.id, toSnapshot(c));
          refreshed++;
        }
      } catch {
        failed++;
      }
    }
    if (refreshed === 0 && failed > 0) throw new Error('Card API unavailable');
    return refreshed;
  }

  hydrate(ids: string[]) {
    return this.call('hydrate', async () => {
      const missing = ids.filter((i) => !Object.keys(this.cards.get(i)?.prices ?? {}).length);
      if (missing.length) await this.fetchCards(missing);
      return ids.map((i) => this.cards.get(i)).filter((c): c is CardSnapshot => !!c);
    });
  }

  putSetStat(setId: string, masterTotal: number) {
    return this.call('putSetStat', () => void this.setStats.set(setId, { setId, masterTotal, syncedAt: new Date().toISOString() }));
  }

  createList(cid: string, name: string, description?: string) {
    return this.callIn(cid, 'createList', () => {
      const t = new Date().toISOString();
      const list: CustomList = { id: id(), name, description, createdAt: t, updatedAt: t, cards: [] };
      this.lists.push(list);
      return { ...list, cards: [] };
    });
  }

  updateList(cid: string, listId: string, patch: { name?: string; description?: string; order?: string[] }) {
    return this.callIn(cid, 'updateList', () => {
      const l = this.lists.find((x) => x.id === listId);
      if (!l) throw new Error('List not found');
      if (patch.name !== undefined) l.name = patch.name;
      if (patch.description !== undefined) l.description = patch.description || undefined;
      if (patch.order) l.cards = [...patch.order.filter((c) => l.cards.includes(c)), ...l.cards.filter((c) => !patch.order!.includes(c))];
    });
  }

  deleteList(cid: string, listId: string) {
    return this.callIn(cid, 'deleteList', () => void (this.lists = this.lists.filter((l) => l.id !== listId)));
  }

  addToList(cid: string, listId: string, cardId: string) {
    return this.callIn(cid, 'addToList', () => {
      const l = this.lists.find((x) => x.id === listId);
      if (l && !l.cards.includes(cardId)) l.cards.push(cardId);
    });
  }

  removeFromList(cid: string, listId: string, cardId: string) {
    return this.callIn(cid, 'removeFromList', () => {
      const l = this.lists.find((x) => x.id === listId);
      if (l) l.cards = l.cards.filter((c) => c !== cardId);
    });
  }

  status() {
    return this.call('status', (): SystemStatus => ({ version: 'test', lastPriceSync: this.lastPriceSync, fxAt: null, catalogDegraded: false }));
  }

  providerHealth() {
    return this.call('providerHealth', (): ProviderHealthReport => ({
      tcgdex: { name: 'tcgdex', state: 'closed', consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastError: null, staleServedCount: 0, openedAt: null },
      pricecharting: { name: 'pricecharting', state: 'closed', consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastError: null, staleServedCount: 0, openedAt: null, configured: false },
    }));
  }

  refreshPrices() {
    return this.call('refreshPrices', async () => {
      const tracked = new Set([...[...this.collection.values()].map((e) => e.cardId), ...this.wishlist.keys(), ...[...this.graded.values()].map((g) => g.cardId), ...this.lists.flatMap((l) => l.cards)]);
      await this.fetchCards([...tracked]);
      this.lastPriceSync = new Date().toISOString();
    });
  }

  priceHistory(cardId: string) {
    return this.call('priceHistory', (): CardPriceHistory => this.priceHistories.get(cardId) ?? { cardId, series: [] });
  }

  /**
   * Mirrors the server's biggestMovers(): a card needs both a current price and a price-history
   * row at or before the cutoff to count. Tests can instead set moversResponse for a canned result.
   */
  movers(cid: string, days: 7 | 30) {
    return this.callIn(cid, 'movers', () => {
      if (this.moversResponse) return { days, gainers: this.moversResponse.gainers, losers: this.moversResponse.losers };
      const byCard = new Map<string, string>();
      for (const e of this.collection.values()) if (!byCard.has(e.cardId)) byCard.set(e.cardId, e.variant);
      for (const g of this.graded.values()) if (!this.deletedGraded.has(g.id) && !byCard.has(g.cardId)) byCard.set(g.cardId, g.variant);
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const movers: MoverCard[] = [];
      for (const [cardId, variant] of byCard) {
        const card = this.cards.get(cardId);
        const nowPrice = card?.prices[variant];
        if (!nowPrice) continue;
        const series = this.priceHistories.get(cardId)?.series.find((s) => s.variant === variant && s.source === 'tcgplayer');
        const row = [...(series?.points ?? [])].filter((p) => p.date <= cutoff).sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!row || row.price <= 0) continue;
        const changeUsd = nowPrice - row.price;
        if (Math.abs(changeUsd) < 0.01) continue;
        movers.push({ cardId, name: card!.name, image: card!.image, setName: card!.setName, variant, valueUsd: nowPrice, previousValueUsd: row.price, changeUsd, changePct: (changeUsd / row.price) * 100 });
      }
      const gainers = movers.filter((m) => m.changeUsd > 0).sort((a, b) => b.changeUsd - a.changeUsd).slice(0, 5);
      const losers = movers.filter((m) => m.changeUsd < 0).sort((a, b) => a.changeUsd - b.changeUsd).slice(0, 5);
      return { days, gainers, losers };
    });
  }
}

/** The backend installed for the current test (fresh for every test). */
export let memory = new MemoryBackend();

export function resetMemoryBackend() {
  memory = new MemoryBackend();
  return memory;
}
