import { getCardsByIds, setIdFromCardId, toSnapshot } from '../api/client';
import type { Backend, CollectionData, CollectionRole, CollectionSummary, CustomList, ImportResult, PhotoRef, SystemStatus } from '../api/backend';
import type { CardNote, CardSnapshot, PokemonCard, CollectionEntry, GradedCopy, SetStat, ValuePoint, WishlistEntry } from '../api/types';
import { entryKey, GRADING_COMPANIES, isPaid, NOTE_MAX, valuePoint } from '@poketracker/shared/value';
import { currentRates } from '../utils/fx';

export const TEST_COLLECTION = 'c-personal';

interface StoredPhoto {
  id: string;
  gradedId: string;
  side: PhotoRef['side'];
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
  notes = new Map<string, CardNote>();
  lists: CustomList[] = [];
  lastPriceSync: string | null = null;
  /** The catalogue the "server" hydrates from; swap in a mock to control prices. */
  catalog: (ids: string[]) => Promise<PokemonCard[]> = getCardsByIds;
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
      return { entries, graded, wishlist, notes, history: 0, photos: 0, remapped: 0 };
    });
  }

  clear(cid: string) {
    return this.callIn(cid, 'clear', () => {
      for (const m of [this.collection, this.wishlist, this.valueHistory, this.graded, this.gradedPhotos, this.notes]) m.clear();
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
    return this.call('status', (): SystemStatus => ({ version: 'test', lastPriceSync: this.lastPriceSync, fxAt: null }));
  }

  refreshPrices() {
    return this.call('refreshPrices', async () => {
      const tracked = new Set([...[...this.collection.values()].map((e) => e.cardId), ...this.wishlist.keys(), ...[...this.graded.values()].map((g) => g.cardId), ...this.lists.flatMap((l) => l.cards)]);
      await this.fetchCards([...tracked]);
      this.lastPriceSync = new Date().toISOString();
    });
  }
}

/** The backend installed for the current test (fresh for every test). */
export let memory = new MemoryBackend();

export function resetMemoryBackend() {
  memory = new MemoryBackend();
  return memory;
}
