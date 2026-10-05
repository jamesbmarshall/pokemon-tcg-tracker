import { create } from 'zustand';
import { db } from '../db/dexie';
import { entryKey } from '../utils/variants';
import { todayKey } from '../utils/format';
import { gradeRank } from '../utils/grading';
import { getCardsByIds, setIdFromCardId, toSnapshot } from '../api/client';
import { markMigrated, migrateVariant, needsMigration, resolveLegacyIds } from '../api/migrate';
import { cacheImages, pruneImages } from '../db/imageCache';
import { currentRates, isPaid, paidUsd, type Rates } from '../utils/fx';
import type { CardNote, CardSnapshot, CollectionEntry, GradedCopy, GradedPhoto, PokemonCard, SetStat, ValuePoint, WishlistEntry } from '../api/types';

type CardLike = PokemonCard | CardSnapshot;
type VariantQty = Record<string, number>;

const PRICE_SYNC_KEY = 'poketracker-last-price-sync';
const PRICE_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
export const NOTE_MAX = 500;

interface CollectionState {
  isLoaded: boolean;
  entries: Map<string, CollectionEntry>;
  /** cardId -> variant -> raw (ungraded) quantity */
  byCard: Map<string, VariantQty>;
  /** Graded copies by id */
  graded: Map<string, GradedCopy>;
  /** cardId -> graded copies, best grade first */
  gradedByCard: Map<string, GradedCopy[]>;
  /** cardId -> variant -> copies that count towards set progress (raw + included slabs) */
  holdings: Map<string, VariantQty>;
  cards: Map<string, CardSnapshot>;
  wishlist: Map<string, WishlistEntry>;
  /** cardId -> note text */
  notes: Map<string, string>;
  setStats: Map<string, SetStat>;
  history: ValuePoint[];
  syncing: boolean;
  lastSync: string | null;

  load: () => Promise<void>;
  remember: (cards: CardLike[]) => Promise<void>;
  adjust: (card: CardLike, variant: string, delta: number) => Promise<void>;
  setQuantity: (cardId: string, variant: string, quantity: number) => Promise<void>;
  updateEntry: (cardId: string, variant: string, patch: Partial<Pick<CollectionEntry, 'condition' | 'notes' | 'paid'>>) => Promise<void>;
  removeCard: (cardId: string) => Promise<CollectionEntry[]>;
  restoreEntries: (entries: CollectionEntry[]) => Promise<void>;
  toggleWishlist: (card: CardLike) => Promise<boolean>;
  /** Saves (or, when blank, deletes) the note for a card. */
  setNote: (cardId: string, text: string) => Promise<void>;
  recordSetStat: (setId: string, masterTotal: number) => Promise<void>;
  /** Returns the number of cards refreshed, or -1 if the API was unreachable. */
  syncPrices: (force?: boolean) => Promise<number>;
  /** Remaps collections created with the old pokemontcg.io catalogue. Returns true if anything changed. */
  migrateLegacy: () => Promise<boolean>;
  recordValue: () => Promise<void>;
  /** Adds or updates a graded copy. Returns the saved copy. */
  saveGraded: (card: CardLike, copy: GradedInput) => Promise<GradedCopy>;
  /** Deletes a graded copy and its photos, returning them for undo. */
  removeGraded: (id: string) => Promise<{ copy: GradedCopy; photos: GradedPhoto[] } | undefined>;
  restoreGraded: (copy: GradedCopy, photos?: GradedPhoto[]) => Promise<void>;
  importData: (data: unknown) => Promise<number>;
  clearAll: () => Promise<void>;
}

export type GradedInput = Omit<GradedCopy, 'id' | 'cardId' | 'setId' | 'addedAt' | 'updatedAt'> & { id?: string };

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

export function indexGraded(graded: Map<string, GradedCopy>) {
  const out = new Map<string, GradedCopy[]>();
  for (const g of graded.values()) out.set(g.cardId, [...(out.get(g.cardId) ?? []), g]);
  for (const list of out.values()) list.sort((a, b) => gradeRank(b.grade) - gradeRank(a.grade) || a.addedAt.localeCompare(b.addedAt));
  return out;
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const GRADING_COMPANIES = new Set(['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'Other']);

export function priceOf(card: CardSnapshot | undefined, variant: string) {
  if (!card) return undefined;
  return card.prices[variant] ?? Object.values(card.prices)[0];
}

/** A slab is worth the owner's valuation, else the raw market price of its printing. */
export function gradedValue(g: GradedCopy, cards: Map<string, CardSnapshot>) {
  return g.valueUsd ?? priceOf(cards.get(g.cardId), g.variant) ?? 0;
}

export function computeValue(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy> = []) {
  let valueUsd = 0;
  let count = 0;
  const unique = new Set<string>();
  for (const e of entries) {
    count += e.quantity;
    unique.add(e.cardId);
    const price = priceOf(cards.get(e.cardId), e.variant);
    if (price) valueUsd += price * e.quantity;
  }
  for (const g of graded) {
    count++;
    unique.add(g.cardId);
    valueUsd += gradedValue(g, cards);
  }
  return { valueUsd, count, unique: unique.size };
}

export interface CostBasis {
  /** What was paid (USD at the given rates) for copies with a recorded price */
  costUsd: number;
  /** Today's market value of those same copies */
  valueUsd: number;
  /** Copies with a recorded price */
  costed: number;
}

/** Cost basis vs. market value, counting only copies whose purchase price is known. */
export function costBasis(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy>, rates: Rates): CostBasis {
  const out = { costUsd: 0, valueUsd: 0, costed: 0 };
  for (const e of entries) {
    const each = paidUsd(e.paid, rates);
    if (each == null) continue;
    out.costUsd += each * e.quantity;
    out.valueUsd += (priceOf(cards.get(e.cardId), e.variant) ?? 0) * e.quantity;
    out.costed += e.quantity;
  }
  for (const g of graded) {
    const cost = paidUsd(g.paid, rates);
    if (cost == null) continue;
    out.costUsd += cost;
    out.valueUsd += gradedValue(g, cards);
    out.costed++;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Listing cards (sets, search) carry no prices; never let them wipe a priced snapshot. */
function merge(prev: CardSnapshot | undefined, next: CardSnapshot): CardSnapshot {
  if (!prev || Object.keys(next.prices).length) return next;
  return { ...next, prices: prev.prices, tcgplayerUrl: prev.tcgplayerUrl, cardmarketUrl: prev.cardmarketUrl };
}

async function readAll() {
  const [entries, cards, wishlist, setStats, history, gradedRows, notes] = await Promise.all([
    db.collection.toArray(),
    db.cards.toArray(),
    db.wishlist.toArray(),
    db.setStats.toArray(),
    db.valueHistory.orderBy('date').toArray(),
    db.graded.toArray(),
    db.notes.toArray(),
  ]);
  const map = new Map(entries.map((e) => [e.id, e]));
  const byCard = indexEntries(map);
  const graded = new Map(gradedRows.map((g) => [g.id, g]));
  return {
    isLoaded: true,
    entries: map,
    byCard,
    graded,
    gradedByCard: indexGraded(graded),
    holdings: indexHoldings(byCard, graded),
    cards: new Map(cards.map((c) => [c.id, c])),
    wishlist: new Map(wishlist.map((w) => [w.cardId, w])),
    notes: new Map(notes.map((n) => [n.cardId, n.text])),
    setStats: new Map(setStats.map((s) => [s.setId, s])),
    history,
  };
}

let valueTimer: ReturnType<typeof setTimeout> | undefined;

export const useCollectionStore = create<CollectionState>((set, get) => {
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

  /** Fetch full details (prices) and cache the image for a newly owned / wishlisted card. */
  const hydrate = (s: CardSnapshot) => {
    if (Object.keys(s.prices).length) {
      void cacheImages([s]);
      return;
    }
    void getCardsByIds([s.id])
      .then(async (full) => {
        await get().remember(full);
        await cacheImages(full.map(toSnapshot));
        await get().recordValue();
      })
      .catch(() => undefined);
  };

  return {
    isLoaded: false,
    entries: new Map(),
    byCard: new Map(),
    graded: new Map(),
    gradedByCard: new Map(),
    holdings: new Map(),
    cards: new Map(),
    wishlist: new Map(),
    notes: new Map(),
    setStats: new Map(),
    history: [],
    syncing: false,
    lastSync: localStorage.getItem(PRICE_SYNC_KEY),

    load: async () => {
      set(await readAll());
      if (needsMigration()) {
        try {
          if (await get().migrateLegacy()) set(await readAll());
          if (!needsMigration()) {
            void get().syncPrices(true);
            return;
          }
        } catch (err) {
          console.warn('Collection migration failed; will retry next launch', err);
        }
      }
      const last = get().lastSync;
      const stale = !last || Date.now() - new Date(last).getTime() > PRICE_SYNC_INTERVAL;
      void get().syncPrices(stale);
    },

    remember: async (input) => {
      if (!input.length) return;
      const current = get().cards;
      const snaps = input.map((c) => merge(current.get(c.id), snap(c)));
      await db.cards.bulkPut(snaps);
      set((s) => {
        const cards = new Map(s.cards);
        for (const c of snaps) cards.set(c.id, c);
        return { cards };
      });
    },

    adjust: async (card, variant, delta) => {
      const s = snap(card);
      if (!isSnapshot(card) || !get().cards.has(s.id)) await get().remember([s]);
      const key = entryKey(s.id, variant);
      const existing = get().entries.get(key);
      const quantity = Math.max(0, (existing?.quantity ?? 0) + delta);
      const entries = new Map(get().entries);
      if (quantity === 0) {
        if (!existing) return;
        entries.delete(key);
        await db.collection.delete(key);
      } else {
        const now = new Date().toISOString();
        const entry: CollectionEntry = existing
          ? { ...existing, quantity, updatedAt: now }
          : { id: key, cardId: s.id, setId: s.setId, variant, quantity, addedAt: now, condition: 'NM' };
        entries.set(key, entry);
        await db.collection.put(entry);
        if (!existing) hydrate(get().cards.get(s.id) ?? s);
      }
      commitEntries(entries);
    },

    setQuantity: async (cardId, variant, quantity) => {
      const key = entryKey(cardId, variant);
      const existing = get().entries.get(key);
      if (!existing) return;
      const entries = new Map(get().entries);
      if (quantity <= 0) {
        entries.delete(key);
        await db.collection.delete(key);
      } else {
        const entry = { ...existing, quantity, updatedAt: new Date().toISOString() };
        entries.set(key, entry);
        await db.collection.put(entry);
      }
      commitEntries(entries);
    },

    updateEntry: async (cardId, variant, patch) => {
      const key = entryKey(cardId, variant);
      const existing = get().entries.get(key);
      if (!existing) return;
      const entry = { ...existing, ...patch };
      if ('paid' in patch && !isPaid(patch.paid)) {
        if (patch.paid === undefined) delete entry.paid;
        else entry.paid = existing.paid;
      }
      await db.collection.put(entry);
      const entries = new Map(get().entries);
      entries.set(key, entry);
      commitEntries(entries);
    },

    removeCard: async (cardId) => {
      const removed = Array.from(get().entries.values()).filter((e) => e.cardId === cardId);
      await db.collection.bulkDelete(removed.map((e) => e.id));
      const entries = new Map(get().entries);
      for (const e of removed) entries.delete(e.id);
      commitEntries(entries);
      return removed;
    },

    restoreEntries: async (restore) => {
      await db.collection.bulkPut(restore);
      const entries = new Map(get().entries);
      for (const e of restore) entries.set(e.id, e);
      commitEntries(entries);
    },

    toggleWishlist: async (card) => {
      const s = snap(card);
      const wishlist = new Map(get().wishlist);
      if (wishlist.has(s.id)) {
        wishlist.delete(s.id);
        await db.wishlist.delete(s.id);
        set({ wishlist });
        return false;
      }
      if (!isSnapshot(card) || !get().cards.has(s.id)) await get().remember([s]);
      const entry = { cardId: s.id, addedAt: new Date().toISOString() };
      wishlist.set(s.id, entry);
      await db.wishlist.put(entry);
      set({ wishlist });
      hydrate(get().cards.get(s.id) ?? s);
      return true;
    },

    recordSetStat: async (setId, masterTotal) => {
      if (get().setStats.get(setId)?.masterTotal === masterTotal) return;
      const stat = { setId, masterTotal, syncedAt: new Date().toISOString() };
      await db.setStats.put(stat);
      set((s) => ({ setStats: new Map(s.setStats).set(setId, stat) }));
    },

    syncPrices: async (force = false) => {
      if (get().syncing) return 0;
      const { entries, wishlist, cards, graded } = get();
      const wanted = new Set<string>([...Array.from(entries.values(), (e) => e.cardId), ...wishlist.keys(), ...Array.from(graded.values(), (g) => g.cardId)]);
      const ids = Array.from(wanted).filter((id) => force || !cards.has(id));
      if (!ids.length) {
        await get().recordValue();
        return 0;
      }
      set({ syncing: true });
      try {
        let refreshed = 0;
        let failed = 0;
        for (let i = 0; i < ids.length; i += 40) {
          try {
            const fresh = await getCardsByIds(ids.slice(i, i + 40));
            await get().remember(fresh);
            refreshed += fresh.length;
          } catch (err) {
            failed++;
            console.warn('Price sync batch failed', err);
          }
        }
        if (refreshed === 0 && failed > 0) throw new Error('Card API unavailable');
        const latest = get().cards;
        void cacheImages(Array.from(wanted, (id) => latest.get(id)).filter((c): c is CardSnapshot => !!c));
        if (force) {
          void pruneImages(wanted);
          const now = new Date().toISOString();
          localStorage.setItem(PRICE_SYNC_KEY, now);
          set({ lastSync: now });
        }
        await get().recordValue();
        return refreshed;
      } catch (err) {
        console.warn('Price sync failed', err);
        return -1;
      } finally {
        set({ syncing: false });
      }
    },

    migrateLegacy: async () => {
      const { entries, wishlist, cards } = get();
      const ids = Array.from(new Set([...Array.from(entries.values(), (e) => e.cardId), ...wishlist.keys()]));
      if (!ids.length) {
        markMigrated();
        return false;
      }
      const names = new Map(Array.from(cards.values(), (c) => [c.id, c.name]));
      const { map, failedSets } = await resolveLegacyIds(ids, names);
      const to = (id: string) => map.get(id) ?? id;
      const changed = ids.some((id) => to(id) !== id) || Array.from(entries.values()).some((e) => migrateVariant(e.variant) !== e.variant);
      if (changed) {
        await db.transaction('rw', db.collection, db.wishlist, db.cards, async () => {
          const merged = new Map<string, CollectionEntry>();
          for (const e of entries.values()) {
            const cardId = to(e.cardId);
            const variant = migrateVariant(e.variant);
            const id = entryKey(cardId, variant);
            const prev = merged.get(id);
            merged.set(id, prev ? { ...prev, quantity: prev.quantity + e.quantity } : { ...e, id, cardId, variant, setId: setIdFromCardId(cardId) });
          }
          await db.collection.clear();
          await db.collection.bulkPut(Array.from(merged.values()));
          const wl = new Map(Array.from(wishlist.values(), (w) => [to(w.cardId), { ...w, cardId: to(w.cardId) }]));
          await db.wishlist.clear();
          await db.wishlist.bulkPut(Array.from(wl.values()));
          await db.cards.bulkDelete(Array.from(cards.keys()).filter((id) => to(id) !== id));
        });
      }
      if (failedSets === 0) markMigrated();
      return changed;
    },

    setNote: async (cardId, text) => {
      const clean = text.trim().slice(0, NOTE_MAX);
      const notes = new Map(get().notes);
      if (clean) {
        notes.set(cardId, clean);
        await db.notes.put({ cardId, text: clean, updatedAt: new Date().toISOString() });
      } else {
        notes.delete(cardId);
        await db.notes.delete(cardId);
      }
      set({ notes });
    },

    recordValue: async () => {
      const { entries, cards, history, graded } = get();
      const { valueUsd, count, unique } = computeValue(entries.values(), cards, graded.values());
      if (count === 0 && history.length === 0) return;
      const point: ValuePoint = { date: todayKey(), valueUsd: round2(valueUsd), cards: count, unique };
      const cost = costBasis(entries.values(), cards, graded.values(), currentRates());
      if (cost.costed) Object.assign(point, { costUsd: round2(cost.costUsd), costedValueUsd: round2(cost.valueUsd) });
      await db.valueHistory.put(point);
      set((s) => ({ history: [...s.history.filter((p) => p.date !== point.date), point] }));
    },

    importData: async (data) => {
      const obj = data as { collection?: unknown[]; wishlist?: unknown[] } | null;
      const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(obj?.collection) ? obj.collection : [];
      const valid: CollectionEntry[] = [];
      for (const r of raw) {
        const e = r as Partial<CollectionEntry>;
        if (typeof e?.cardId !== 'string' || typeof e.variant !== 'string') continue;
        valid.push({
          id: entryKey(e.cardId, e.variant),
          cardId: e.cardId,
          setId: e.setId ?? setIdFromCardId(e.cardId),
          variant: e.variant,
          quantity: Math.max(1, Math.floor(Number(e.quantity) || 1)),
          condition: e.condition,
          notes: e.notes,
          paid: isPaid(e.paid) ? { amount: e.paid.amount, currency: e.paid.currency } : undefined,
          addedAt: e.addedAt ?? new Date().toISOString(),
        });
      }
      const gradedIn = Array.isArray((obj as { graded?: unknown })?.graded) ? ((obj as { graded: unknown[] }).graded) : [];
      const validGraded: GradedCopy[] = [];
      for (const r of gradedIn) {
        const g = r as Partial<GradedCopy>;
        if (typeof g?.cardId !== 'string' || typeof g.variant !== 'string' || typeof g.grade !== 'string' || !GRADING_COMPANIES.has(g.company as string)) continue;
        validGraded.push({
          ...g,
          id: typeof g.id === 'string' ? g.id : newId(),
          cardId: g.cardId,
          setId: g.setId ?? setIdFromCardId(g.cardId),
          variant: g.variant,
          company: g.company!,
          grade: g.grade,
          countsTowardSet: g.countsTowardSet !== false,
          valueUsd: typeof g.valueUsd === 'number' && g.valueUsd >= 0 ? g.valueUsd : undefined,
          paid: isPaid(g.paid) ? { amount: g.paid.amount, currency: g.paid.currency } : undefined,
          addedAt: g.addedAt ?? new Date().toISOString(),
        });
      }
      const notesIn = Array.isArray((obj as { notes?: unknown })?.notes) ? (obj as { notes: unknown[] }).notes : [];
      const validNotes: CardNote[] = [];
      for (const r of notesIn) {
        const n = r as Partial<CardNote>;
        if (typeof n?.cardId !== 'string' || typeof n.text !== 'string' || !n.text.trim()) continue;
        validNotes.push({ cardId: n.cardId, text: n.text.trim().slice(0, NOTE_MAX), updatedAt: n.updatedAt ?? new Date().toISOString() });
      }
      if (!valid.length && !validGraded.length && !validNotes.length && !Array.isArray(obj?.wishlist)) throw new Error('No collection entries found in file');
      await db.collection.bulkPut(valid);
      if (validGraded.length) await db.graded.bulkPut(validGraded);
      if (validNotes.length) await db.notes.bulkPut(validNotes);
      if (Array.isArray(obj?.wishlist)) {
        await db.wishlist.bulkPut(
          (obj.wishlist as WishlistEntry[])
            .filter((w) => typeof w?.cardId === 'string')
            .map((w) => ({ cardId: w.cardId, addedAt: w.addedAt ?? new Date().toISOString() })),
        );
      }
      // Imported files may predate the TCGdex switch; load() remaps them if so.
      localStorage.removeItem('poketracker-provider');
      await get().load();
      return valid.length + validGraded.length;
    },

    saveGraded: async (card, input) => {
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
      await db.graded.put(copy);
      commitGraded(new Map(get().graded).set(copy.id, copy));
      if (!prev) hydrate(get().cards.get(s.id) ?? s);
      return copy;
    },

    removeGraded: async (id) => {
      const copy = get().graded.get(id);
      if (!copy) return undefined;
      const photos = await db.gradedPhotos.where('gradedId').equals(id).toArray();
      await db.transaction('rw', db.graded, db.gradedPhotos, async () => {
        await db.graded.delete(id);
        await db.gradedPhotos.bulkDelete(photos.map((p) => p.id));
      });
      const graded = new Map(get().graded);
      graded.delete(id);
      commitGraded(graded);
      return { copy, photos };
    },

    restoreGraded: async (copy, photos = []) => {
      await db.transaction('rw', db.graded, db.gradedPhotos, async () => {
        await db.graded.put(copy);
        if (photos.length) await db.gradedPhotos.bulkPut(photos);
      });
      commitGraded(new Map(get().graded).set(copy.id, copy));
    },

    clearAll: async () => {
      await Promise.all([db.collection.clear(), db.wishlist.clear(), db.valueHistory.clear(), db.graded.clear(), db.gradedPhotos.clear(), db.notes.clear()]);
      set({ entries: new Map(), byCard: new Map(), graded: new Map(), gradedByCard: new Map(), holdings: new Map(), wishlist: new Map(), notes: new Map(), history: [] });
    },
  };
});

export function useOwned(cardId: string) {
  return useCollectionStore((s) => s.byCard.get(cardId));
}

/** Copies that count towards set progress: raw plus slabs marked as counting. */
export function useHoldings(cardId: string) {
  return useCollectionStore((s) => s.holdings.get(cardId));
}

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

export function ownedTotal(v?: VariantQty) {
  return v ? Object.values(v).reduce((a, b) => a + b, 0) : 0;
}
