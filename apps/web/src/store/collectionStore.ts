/**
 * Client-side cache of the active collection, with optimistic writes.
 *
 * The server is the source of truth. This store holds one collection at a time (the user's
 * personal one, a shared one, or a public share being viewed), applies every edit locally
 * straight away so the UI feels instant, then persists it through the current Backend and rolls
 * back with an error toast if the server refuses. Undo is built on top: removal actions return
 * what they removed, and the caller offers a toast that puts it back.
 *
 * Alongside the raw data it keeps derived indexes (byCard, gradedByCard, holdings) that every
 * card tile reads, so they are rebuilt whenever entries or graded copies change.
 */
import { create } from 'zustand';
import { entryKey } from '../utils/variants';
import { gradeRank } from '../utils/grading';
import { toSnapshot } from '../api/client';
import { isPaid } from '../utils/fx';
import { getBackend, type CollectionRole, type CollectionSummary, type CustomList } from '../api/backend';
import { ApiError } from '../api/http';
import { toast } from './toastStore';
import type { CardSnapshot, CollectionEntry, GradedCopy, GradedPhoto, PokemonCard, SetStat, ValuePoint, WishlistEntry } from '../api/types';
import { NOTE_MAX } from '@poketracker/shared/value';

export { computeValue, costBasis, gradedValue, NOTE_MAX, priceOf, type CostBasis } from '@poketracker/shared/value';

type CardLike = PokemonCard | CardSnapshot;
type VariantQty = Record<string, number>;

/** localStorage key for the last collection the user explicitly switched to. */
export const ACTIVE_COLLECTION_KEY = 'poketracker-collection';

interface CollectionState {
  isLoaded: boolean;
  /** Set when the collection couldn't be loaded */
  loadError: string | null;
  collectionId: string | null;
  role: CollectionRole | null;
  /**
   * Viewers and public share links can't change anything. Write actions become no-ops locally;
   * the server would refuse them anyway.
   */
  readOnly: boolean;
  /** Collections the signed-in user can open */
  collections: CollectionSummary[];
  /** Keyed by entryKey(cardId, variant): one entry per card printing, holding the quantity. */
  entries: Map<string, CollectionEntry>;
  /** cardId -> variant -> raw (ungraded) quantity */
  byCard: Map<string, VariantQty>;
  /** Graded copies by id */
  graded: Map<string, GradedCopy>;
  /** cardId -> graded copies, best grade first */
  gradedByCard: Map<string, GradedCopy[]>;
  /** cardId -> variant -> copies that count towards set progress (raw + included slabs) */
  holdings: Map<string, VariantQty>;
  /**
   * Catalogue snapshots for cards the user has touched. Kept across collection switches, since
   * it is reference data rather than user data; only reset() (sign-out) clears it.
   */
  cards: Map<string, CardSnapshot>;
  wishlist: Map<string, WishlistEntry>;
  /** cardId -> note text */
  notes: Map<string, string>;
  setStats: Map<string, SetStat>;
  history: ValuePoint[];
  lists: CustomList[];
  syncing: boolean;
  /** When the server last refreshed prices */
  lastSync: string | null;

  /** Loads a collection: the given one, else the last one used, else the user's personal collection. */
  load: (collectionId?: string) => Promise<void>;
  /** Reloads the current collection from the server. */
  refresh: () => Promise<void>;
  /** Forgets everything held locally (on sign-out), without touching the server. */
  reset: () => void;
  /** Shows a collection loaded elsewhere (e.g. a public share), read-only. */
  show: (data: Partial<Pick<CollectionState, 'entries' | 'graded' | 'cards' | 'wishlist' | 'notes' | 'history' | 'lists' | 'setStats'>> & { collectionId: string }) => void;
  /** Caches card snapshots locally so owned/wishlisted cards can render without a catalogue fetch. */
  remember: (cards: CardLike[]) => Promise<void>;
  /** Changes a variant's raw quantity by `delta`, creating or deleting the entry as needed. */
  adjust: (card: CardLike, variant: string, delta: number) => Promise<void>;
  setQuantity: (cardId: string, variant: string, quantity: number) => Promise<void>;
  updateEntry: (cardId: string, variant: string, patch: Partial<Pick<CollectionEntry, 'condition' | 'notes' | 'paid'>>) => Promise<void>;
  /** Removes every variant of a card, returning the removed entries for undo (empty if nothing was removed). */
  removeCard: (cardId: string) => Promise<CollectionEntry[]>;
  restoreEntries: (entries: CollectionEntry[]) => Promise<void>;
  /** Returns whether the card is on the wishlist afterwards (unchanged if the save failed). */
  toggleWishlist: (card: CardLike) => Promise<boolean>;
  /** Saves (or, when blank, deletes) the note for a card. */
  setNote: (cardId: string, text: string) => Promise<void>;
  /** Stores a set's master total; skipped when unchanged so viewing a set doesn't write every time. */
  recordSetStat: (setId: string, masterTotal: number) => Promise<void>;
  /**
   * Refreshes prices. With `force`, owners/admins make the server fetch fresh prices first;
   * everyone else just reloads what the server already has. Returns the number of cards
   * with prices, or -1 if the server or card API was unreachable.
   */
  syncPrices: (force?: boolean) => Promise<number>;
  /** Asks the server to record today's collection value point for the history chart. */
  recordValue: () => Promise<void>;
  /** Adds or updates a graded copy. Returns the saved copy. */
  saveGraded: (card: CardLike, copy: GradedInput) => Promise<GradedCopy>;
  /**
   * Deletes a graded copy, returning it for undo. The server soft-deletes, so restoreGraded()
   * brings the photos back too; `photos` is always empty and only kept for the call signature.
   */
  removeGraded: (id: string) => Promise<{ copy: GradedCopy; photos: GradedPhoto[] } | undefined>;
  restoreGraded: (copy: GradedCopy, photos?: GradedPhoto[]) => Promise<void>;
  /** Imports a backup file server-side, then reloads. Returns the number of entries plus graded copies imported. */
  importData: (data: unknown) => Promise<number>;
  clearAll: () => Promise<void>;
  createList: (name: string, description?: string) => Promise<CustomList | undefined>;
  updateList: (id: string, patch: { name?: string; description?: string; order?: string[] }) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  /** Adds the card to the list, or removes it if it's already there. Returns whether it's now in the list. */
  toggleInList: (listId: string, card: CardLike) => Promise<boolean>;
}

export type GradedInput = Omit<GradedCopy, 'id' | 'cardId' | 'setId' | 'addedAt' | 'updatedAt'> & { id?: string };

// Full catalogue cards carry a nested `set` object; snapshots flatten it to setId.
const isSnapshot = (c: CardLike): c is CardSnapshot => !('set' in c);
const snap = (c: CardLike) => (isSnapshot(c) ? c : toSnapshot(c));

function indexEntries(entries: Map<string, CollectionEntry>) {
  const byCard = new Map<string, VariantQty>();
  for (const e of entries.values()) {
    const v = byCard.get(e.cardId) ?? {};
    v[e.variant] = e.quantity;
    byCard.set(e.cardId, v);
  }
  return byCard;
}

/**
 * Builds the per-variant counts that set progress uses: raw copies plus graded copies whose
 * owner ticked "counts towards set". Slabs bought purely as investments can stay out of it.
 */
export function indexHoldings(byCard: Map<string, VariantQty>, graded: Map<string, GradedCopy>) {
  const holdings = new Map<string, VariantQty>();
  for (const [id, v] of byCard) holdings.set(id, { ...v });
  for (const g of graded.values()) {
    if (!g.countsTowardSet) continue;
    const v = holdings.get(g.cardId) ?? {};
    v[g.variant] = (v[g.variant] ?? 0) + 1;
    holdings.set(g.cardId, v);
  }
  return holdings;
}

/** Groups graded copies by card, best grade first, then oldest first so the order is stable. */
export function indexGraded(graded: Map<string, GradedCopy>) {
  const out = new Map<string, GradedCopy[]>();
  for (const g of graded.values()) out.set(g.cardId, [...(out.get(g.cardId) ?? []), g]);
  for (const list of out.values()) list.sort((a, b) => gradeRank(b.grade) - gradeRank(a.grade) || a.addedAt.localeCompare(b.addedAt));
  return out;
}

// randomUUID is missing on plain-http origins (not a secure context), which a LAN install may use.
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Listing cards (sets, search) carry no prices; never let them wipe a priced snapshot. */
function merge(prev: CardSnapshot | undefined, next: CardSnapshot): CardSnapshot {
  if (!prev || Object.keys(next.prices).length) return next;
  return { ...next, prices: prev.prices, tcgplayerUrl: prev.tcgplayerUrl, cardmarketUrl: prev.cardmarketUrl };
}

const EMPTY = {
  entries: new Map<string, CollectionEntry>(),
  byCard: new Map<string, VariantQty>(),
  graded: new Map<string, GradedCopy>(),
  gradedByCard: new Map<string, GradedCopy[]>(),
  holdings: new Map<string, VariantQty>(),
  wishlist: new Map<string, WishlistEntry>(),
  notes: new Map<string, string>(),
  history: [] as ValuePoint[],
  lists: [] as CustomList[],
};

// ApiError messages come from the server and are written for users; anything else is a
// network or programming error, so show a generic message instead.
function failed(err: unknown) {
  const msg = err instanceof ApiError ? err.message : "Couldn't save that change. Check your connection and try again.";
  toast(msg, { tone: 'error' });
}

let valueTimer: ReturnType<typeof setTimeout> | undefined;
// Incremented on every load() and reset(), so a slow response for a collection the user has
// already switched away from (or signed out of) is dropped instead of overwriting newer state.
let loadSeq = 0;

export const useCollectionStore = create<CollectionState>((set, get) => {
  // Debounced so a burst of quantity clicks records one value point, not one per click.
  const scheduleValue = () => {
    clearTimeout(valueTimer);
    valueTimer = setTimeout(() => void get().recordValue(), 1500);
  };
  const commitEntries = (entries: Map<string, CollectionEntry>) => {
    const byCard = indexEntries(entries);
    set({ entries, byCard, holdings: indexHoldings(byCard, get().graded) });
    scheduleValue();
  };
  const commitGraded = (graded: Map<string, GradedCopy>) => {
    set({ graded, gradedByCard: indexGraded(graded), holdings: indexHoldings(get().byCard, graded) });
    scheduleValue();
  };

  /** The collection to write to; undefined (and nothing happens) when read-only. */
  const writable = () => {
    const { collectionId, readOnly } = get();
    return !readOnly && collectionId ? collectionId : undefined;
  };

  /**
   * Applies an optimistic change, persists it, and reverts if the server refuses.
   *
   * Rollback restores a snapshot of all editable state taken just before `apply`, then rebuilds
   * the derived indexes from it. Callers prepare their new Map/array before calling, never
   * mutating the current one, so the snapshot stays intact. Returns false on failure, after the
   * user has already been shown an error toast.
   */
  async function persist(apply: () => void, save: () => Promise<unknown>) {
    const before = { entries: get().entries, graded: get().graded, wishlist: get().wishlist, notes: get().notes, lists: get().lists };
    apply();
    try {
      await save();
      return true;
    } catch (err) {
      const byCard = indexEntries(before.entries);
      set({ ...before, byCard, gradedByCard: indexGraded(before.graded), holdings: indexHoldings(byCard, before.graded) });
      failed(err);
      return false;
    }
  }

  /**
   * Ask the server for full details (prices) of a newly owned / wishlisted card. Fire and forget:
   * the card is already saved, and a missing price only affects the value total until the next sync.
   */
  const hydrate = (s: CardSnapshot) => {
    if (Object.keys(s.prices).length) return;
    void getBackend()
      .hydrate([s.id])
      .then(async (full) => {
        await get().remember(full);
        scheduleValue();
      })
      .catch(() => undefined);
  };

  const apply = (data: Awaited<ReturnType<ReturnType<typeof getBackend>['state']>>, collectionId: string) => {
    const entries = new Map(data.entries.map((e) => [e.id, e]));
    const byCard = indexEntries(entries);
    const graded = new Map(data.graded.map((g) => [g.id, g]));
    const cards = new Map(get().cards);
    for (const c of data.cards) cards.set(c.id, merge(cards.get(c.id), c));
    set({
      isLoaded: true,
      loadError: null,
      collectionId,
      role: data.role,
      // Either the user's role or the backend itself (public shares) can make the view read-only.
      readOnly: data.role === 'viewer' || !!getBackend().readOnly,
      entries,
      byCard,
      graded,
      gradedByCard: indexGraded(graded),
      holdings: indexHoldings(byCard, graded),
      cards,
      wishlist: new Map(data.wishlist.map((w) => [w.cardId, w])),
      notes: new Map(data.notes.map((n) => [n.cardId, n.text])),
      setStats: new Map(data.setStats.map((s) => [s.setId, s])),
      history: [...data.history].sort((a, b) => a.date.localeCompare(b.date)),
      lists: data.lists,
    });
  };

  return {
    isLoaded: false,
    loadError: null,
    collectionId: null,
    role: null,
    readOnly: false,
    collections: [],
    ...EMPTY,
    cards: new Map(),
    setStats: new Map(),
    syncing: false,
    lastSync: null,

    load: async (requested) => {
      const seq = ++loadSeq;
      const backend = getBackend();
      try {
        const collections = await backend.collections();
        const saved = localStorage.getItem(ACTIVE_COLLECTION_KEY);
        const pick =
          collections.find((c) => c.id === requested) ??
          collections.find((c) => c.id === saved) ??
          collections.find((c) => c.kind === 'personal' && c.mine) ??
          collections[0];
        if (!pick) throw new Error('No collection available');
        const data = await backend.state(pick.id);
        if (seq !== loadSeq) return;
        // Switching collection: clear the old data first so nothing from it lingers in fields
        // apply() doesn't overwrite.
        if (pick.id !== get().collectionId) set({ ...EMPTY });
        set({ collections });
        apply(data, pick.id);
        // Only remember explicit choices, so a fallback pick (e.g. after losing access to a
        // shared collection) doesn't overwrite the user's preference.
        if (requested) localStorage.setItem(ACTIVE_COLLECTION_KEY, pick.id);
      } catch (err) {
        if (seq !== loadSeq) return;
        set({ isLoaded: true, loadError: err instanceof Error ? err.message : 'Could not load your collection' });
        return;
      }
      // Non-essential: the "prices last updated" label can wait and may fail without consequence.
      void backend
        .status()
        .then((s) => set({ lastSync: s.lastPriceSync }))
        .catch(() => undefined);
    },

    reset: () => {
      loadSeq++;
      clearTimeout(valueTimer);
      set({ ...EMPTY, isLoaded: false, loadError: null, collectionId: null, role: null, readOnly: false, collections: [], cards: new Map(), setStats: new Map(), syncing: false, lastSync: null });
    },

    refresh: async () => {
      const id = get().collectionId;
      if (!id) return get().load();
      const data = await getBackend().state(id);
      // Discard if the user switched collection while this was in flight.
      if (id === get().collectionId) apply(data, id);
    },

    show: (data) => {
      const entries = data.entries ?? new Map();
      const graded = data.graded ?? new Map();
      const byCard = indexEntries(entries);
      set({
        ...EMPTY,
        ...data,
        isLoaded: true,
        loadError: null,
        role: 'viewer',
        readOnly: true,
        byCard,
        gradedByCard: indexGraded(graded),
        holdings: indexHoldings(byCard, graded),
      });
    },

    remember: async (input) => {
      if (!input.length) return;
      set((s) => {
        const cards = new Map(s.cards);
        for (const c of input) cards.set(c.id, merge(cards.get(c.id), snap(c)));
        return { cards };
      });
    },

    adjust: async (card, variant, delta) => {
      const cid = writable();
      if (!cid) return;
      const s = snap(card);
      // Cache the card first so the new entry has something to render, even before hydrate() adds prices.
      if (!isSnapshot(card) || !get().cards.has(s.id)) await get().remember([s]);
      const key = entryKey(s.id, variant);
      const existing = get().entries.get(key);
      const quantity = Math.max(0, (existing?.quantity ?? 0) + delta);
      const entries = new Map(get().entries);
      // Reaching zero deletes the entry rather than storing a zero-quantity row.
      if (quantity === 0) {
        if (!existing) return;
        entries.delete(key);
        await persist(() => commitEntries(entries), () => getBackend().deleteEntries(cid, [key]));
        return;
      }
      const now = new Date().toISOString();
      const entry: CollectionEntry = existing
        ? { ...existing, quantity, updatedAt: now }
        : { id: key, cardId: s.id, setId: s.setId, variant, quantity, addedAt: now, condition: 'NM' };
      entries.set(key, entry);
      const ok = await persist(() => commitEntries(entries), () => getBackend().putEntries(cid, [entry]));
      if (ok && !existing) hydrate(get().cards.get(s.id) ?? s);
    },

    setQuantity: async (cardId, variant, quantity) => {
      const cid = writable();
      const key = entryKey(cardId, variant);
      const existing = get().entries.get(key);
      if (!cid || !existing) return;
      const entries = new Map(get().entries);
      if (quantity <= 0) {
        entries.delete(key);
        await persist(() => commitEntries(entries), () => getBackend().deleteEntries(cid, [key]));
      } else {
        const entry = { ...existing, quantity, updatedAt: new Date().toISOString() };
        entries.set(key, entry);
        await persist(() => commitEntries(entries), () => getBackend().putEntries(cid, [entry]));
      }
    },

    updateEntry: async (cardId, variant, patch) => {
      const cid = writable();
      const key = entryKey(cardId, variant);
      const existing = get().entries.get(key);
      if (!cid || !existing) return;
      const entry = { ...existing, ...patch };
      // An explicit undefined clears the price paid; any other invalid value (NaN, negative, a
      // half-typed amount) is ignored and the previous value kept.
      if ('paid' in patch && !isPaid(patch.paid)) {
        if (patch.paid === undefined) delete entry.paid;
        else entry.paid = existing.paid;
      }
      const entries = new Map(get().entries);
      entries.set(key, entry);
      await persist(() => commitEntries(entries), () => getBackend().putEntries(cid, [entry]));
    },

    removeCard: async (cardId) => {
      const cid = writable();
      if (!cid) return [];
      const removed = Array.from(get().entries.values()).filter((e) => e.cardId === cardId);
      if (!removed.length) return [];
      const entries = new Map(get().entries);
      for (const e of removed) entries.delete(e.id);
      const ok = await persist(() => commitEntries(entries), () => getBackend().deleteEntries(cid, removed.map((e) => e.id)));
      return ok ? removed : [];
    },

    restoreEntries: async (restore) => {
      const cid = writable();
      if (!cid || !restore.length) return;
      const entries = new Map(get().entries);
      for (const e of restore) entries.set(e.id, e);
      await persist(() => commitEntries(entries), () => getBackend().putEntries(cid, restore));
    },

    toggleWishlist: async (card) => {
      const cid = writable();
      const s = snap(card);
      if (!cid) return get().wishlist.has(s.id);
      const wishlist = new Map(get().wishlist);
      if (wishlist.has(s.id)) {
        wishlist.delete(s.id);
        const ok = await persist(() => set({ wishlist }), () => getBackend().deleteWishlist(cid, s.id));
        // Still wished-for only if the removal failed.
        return !ok;
      }
      if (!isSnapshot(card) || !get().cards.has(s.id)) await get().remember([s]);
      const entry = { cardId: s.id, addedAt: new Date().toISOString() };
      wishlist.set(s.id, entry);
      const ok = await persist(() => set({ wishlist }), () => getBackend().putWishlist(cid, entry));
      if (ok) hydrate(get().cards.get(s.id) ?? s);
      return ok;
    },

    recordSetStat: async (setId, masterTotal) => {
      if (get().setStats.get(setId)?.masterTotal === masterTotal) return;
      const stat = { setId, masterTotal, syncedAt: new Date().toISOString() };
      // Updated locally even when read-only: the total is catalogue data and helps the progress bars
      // on a shared view, it just isn't saved.
      set((s) => ({ setStats: new Map(s.setStats).set(setId, stat) }));
      if (get().readOnly) return;
      await getBackend()
        .putSetStat(setId, masterTotal)
        .catch(() => undefined);
    },

    syncPrices: async (force = false) => {
      // A sync is already running; don't queue another server-side price refresh.
      if (get().syncing) return 0;
      set({ syncing: true });
      const backend = getBackend();
      try {
        if (force && !get().readOnly) {
          try {
            await backend.refreshPrices();
          } catch (err) {
            // Members can't trigger a refresh; they still get the server's latest prices.
            if (!(err instanceof ApiError && err.status === 403)) throw err;
          }
        }
        await get().refresh();
        const status = await backend.status().catch(() => undefined);
        if (status) set({ lastSync: status.lastPriceSync });
        return Array.from(get().cards.values()).filter((c) => Object.keys(c.prices).length).length;
      } catch (err) {
        console.warn('Price refresh failed', err);
        return -1;
      } finally {
        set({ syncing: false });
      }
    },

    recordValue: async () => {
      const cid = writable();
      if (!cid) return;
      try {
        const point = await getBackend().recordValue(cid);
        // One point per day: today's point replaces any earlier one for the same date.
        if (point) set((s) => ({ history: [...s.history.filter((p) => p.date !== point.date), point].sort((a, b) => a.date.localeCompare(b.date)) }));
      } catch {
        /* the nightly job records it anyway */
      }
    },

    setNote: async (cardId, text) => {
      const cid = writable();
      if (!cid) return;
      // Truncated to the server's limit here so the optimistic copy matches what is stored.
      const clean = text.trim().slice(0, NOTE_MAX);
      const notes = new Map(get().notes);
      if (clean) notes.set(cardId, clean);
      else notes.delete(cardId);
      await persist(() => set({ notes }), () => getBackend().putNote(cid, cardId, clean));
    },

    importData: async (data) => {
      const cid = writable();
      if (!cid) throw new Error("You can't import into a collection you can only view");
      if (!data || typeof data !== 'object') throw new Error('No collection entries found in file');
      const result = await getBackend().importData(cid, data);
      // A file containing an empty wishlist array is a valid (if empty) backup, not a wrong file.
      if (!result.entries && !result.graded && !result.wishlist && !result.notes && !Array.isArray((data as { wishlist?: unknown }).wishlist)) {
        throw new Error('No collection entries found in file');
      }
      await get().refresh();
      return result.entries + result.graded;
    },

    saveGraded: async (card, input) => {
      const cid = writable();
      const s = snap(card);
      if (!isSnapshot(card) || !get().cards.has(s.id)) await get().remember([s]);
      const prev = input.id ? get().graded.get(input.id) : undefined;
      const now = new Date().toISOString();
      const copy: GradedCopy = {
        ...input,
        id: prev?.id ?? input.id ?? newId(),
        cardId: s.id,
        setId: s.setId,
        certNumber: input.certNumber?.trim() || undefined,
        label: input.label?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        paid: isPaid(input.paid) ? input.paid : undefined,
        companyName: input.company === 'Other' ? input.companyName?.trim() || undefined : undefined,
        addedAt: prev?.addedAt ?? now,
        ...(prev ? { updatedAt: now } : {}),
      };
      // Read-only: hand back the normalised copy without saving, so callers needn't special-case it.
      if (!cid) return copy;
      const ok = await persist(() => commitGraded(new Map(get().graded).set(copy.id, copy)), () => getBackend().putGraded(cid, copy));
      // Throws (unlike most actions) so the caller can keep its form open with the user's input.
      if (!ok) throw new Error("Couldn't save the graded copy");
      if (!prev) hydrate(get().cards.get(s.id) ?? s);
      return copy;
    },

    removeGraded: async (id) => {
      const cid = writable();
      const copy = get().graded.get(id);
      if (!cid || !copy) return undefined;
      const graded = new Map(get().graded);
      graded.delete(id);
      const ok = await persist(() => commitGraded(graded), () => getBackend().deleteGraded(cid, id));
      return ok ? { copy, photos: [] } : undefined;
    },

    restoreGraded: async (copy) => {
      const cid = writable();
      if (!cid) return;
      await persist(() => commitGraded(new Map(get().graded).set(copy.id, copy)), () => getBackend().putGraded(cid, copy));
    },

    // Not optimistic: wiping everything is destructive enough to wait for the server to confirm.
    clearAll: async () => {
      const cid = writable();
      if (!cid) return;
      await getBackend().clear(cid);
      set({ ...EMPTY });
    },

    // Not optimistic: the list id comes from the server.
    createList: async (name, description) => {
      const cid = writable();
      if (!cid) return undefined;
      try {
        const list = await getBackend().createList(cid, name, description);
        set((s) => ({ lists: [...s.lists, list] }));
        return list;
      } catch (err) {
        failed(err);
        return undefined;
      }
    },

    updateList: async (id, patch) => {
      const cid = writable();
      if (!cid) return;
      const lists = get().lists.map((l) =>
        l.id === id
          ? {
              ...l,
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.description !== undefined ? { description: patch.description || undefined } : {}),
              // The new order may come from a filtered view, so cards it doesn't mention keep
              // their relative order at the end instead of being dropped.
              ...(patch.order ? { cards: [...patch.order, ...l.cards.filter((c) => !patch.order!.includes(c))] } : {}),
              updatedAt: new Date().toISOString(),
            }
          : l,
      );
      await persist(() => set({ lists }), () => getBackend().updateList(cid, id, patch));
    },

    deleteList: async (id) => {
      const cid = writable();
      if (!cid) return;
      const lists = get().lists.filter((l) => l.id !== id);
      await persist(() => set({ lists }), () => getBackend().deleteList(cid, id));
    },

    toggleInList: async (listId, card) => {
      const cid = writable();
      const list = get().lists.find((l) => l.id === listId);
      if (!cid || !list) return false;
      const s = snap(card);
      const has = list.cards.includes(s.id);
      if (!has && (!isSnapshot(card) || !get().cards.has(s.id))) await get().remember([s]);
      const cards = has ? list.cards.filter((c) => c !== s.id) : [...list.cards, s.id];
      const lists = get().lists.map((l) => (l.id === listId ? { ...l, cards, updatedAt: new Date().toISOString() } : l));
      const ok = await persist(
        () => set({ lists }),
        () => (has ? getBackend().removeFromList(cid, listId, s.id) : getBackend().addToList(cid, listId, s.id)),
      );
      if (ok && !has) hydrate(get().cards.get(s.id) ?? s);
      return ok ? !has : has;
    },
  };
});

/** Raw (ungraded) quantities per variant for a card, or undefined if none are owned. */
export function useOwned(cardId: string) {
  return useCollectionStore((s) => s.byCard.get(cardId));
}

/** Copies that count towards set progress: raw plus slabs marked as counting. */
export function useHoldings(cardId: string) {
  return useCollectionStore((s) => s.holdings.get(cardId));
}

// Shared empty array: returning a fresh [] from a selector would re-render on every store change.
const NO_SLABS: GradedCopy[] = [];
export function useGradedFor(cardId: string) {
  return useCollectionStore((s) => s.gradedByCard.get(cardId) ?? NO_SLABS);
}

export function useNote(cardId: string) {
  return useCollectionStore((s) => s.notes.get(cardId) ?? '');
}

export function useWished(cardId: string) {
  return useCollectionStore((s) => s.wishlist.has(cardId));
}

export function useReadOnly() {
  return useCollectionStore((s) => s.readOnly);
}

export function ownedTotal(v?: VariantQty) {
  return v ? Object.values(v).reduce((a, b) => a + b, 0) : 0;
}
