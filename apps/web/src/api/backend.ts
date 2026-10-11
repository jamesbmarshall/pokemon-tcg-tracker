/**
 * Persistence contract for the collection store, plus the default HTTP implementation.
 *
 * The server is the source of truth; collectionStore keeps an optimistic in-memory copy
 * and calls these methods to persist each change. Keeping the store behind this interface
 * lets tests run against an in-memory fake and lets public share pages swap in a read-only
 * backend without the store knowing the difference.
 */
import { api } from './http';
import type { CardPriceHistory, CardSnapshot, CollectionEntry, GradedCopy, GradedPhoto, MoverCard, SealedItem, SetStat, ValuePoint, WishlistEntry } from './types';
import type { CardNote } from './types';
import type { DeckTextLine } from '@poketracker/shared/decks/ptcgl';

/** A PriceCharting search result. Only id/name/consoleName are used client-side; `raw` is ignored. */
export interface PcProduct {
  id: string;
  name: string;
  consoleName?: string;
}

/** The caller's role on a collection. The server enforces it; the UI only uses it to hide edit controls. */
export type CollectionRole = 'owner' | 'editor' | 'viewer';

export type DeckFormat = 'standard' | 'expanded' | 'unlimited';

export interface CustomList {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Card ids in display order */
  cards: string[];
  kind: 'list' | 'deck';
  /** Only set when kind is 'deck'. */
  format?: DeckFormat;
  /** cardId -> quantity in the list. For plain lists every present card is implicitly qty 1. */
  cardQtys: Record<string, number>;
}

/** Response shape of POST /api/decks/resolve. */
export interface DeckResolveResult {
  resolved: (DeckTextLine & { card: CardSnapshot })[];
  unresolved: DeckTextLine[];
  totalCards?: number;
}

export interface DeckSettings {
  regulationMarks: { standard: string[]; expanded: string[] };
  bannedCardIds: string[];
}

/** One entry in the collection switcher: the user's personal collection or one shared with them. */
export interface CollectionSummary {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  role: CollectionRole;
  ownerName: string;
  /** True when the caller owns it, as opposed to being a member via sharing. */
  mine: boolean;
}

/**
 * Full snapshot of a collection, returned in one request when the user opens or switches
 * collection. `cards` holds catalogue snapshots for every referenced card so pages can render
 * without a round trip per card.
 */
export interface CollectionData {
  role: CollectionRole;
  entries: CollectionEntry[];
  graded: GradedCopy[];
  sealed: SealedItem[];
  wishlist: WishlistEntry[];
  notes: CardNote[];
  history: ValuePoint[];
  cards: CardSnapshot[];
  setStats: SetStat[];
  lists: CustomList[];
}

/** A graded-copy photo. `url` is built client-side and is only fetchable with a valid session or share token. */
export interface PhotoRef {
  id: string;
  side: GradedPhoto['side'];
  addedAt: string;
  url: string;
}

/** Per-kind counts from an import. `remapped` counts legacy card ids translated to current TCGdex ids. */
export interface ImportResult {
  entries: number;
  graded: number;
  sealed: number;
  wishlist: number;
  notes: number;
  history: number;
  photos: number;
  remapped: number;
}

export interface SystemStatus {
  version: string;
  lastPriceSync: string | null;
  /** Epoch ms of the last FX rate fetch, or null if rates have never been loaded. */
  fxAt: number | null;
  /** Non-sensitive: true when the TCGdex breaker isn't closed, so the UI can show a banner. */
  catalogDegraded: boolean;
  /** Only reported to owners and admins; members get the base status without update details. */
  updateAvailable?: boolean;
  latest?: string | null;
}

export type BreakerState = 'closed' | 'open' | 'half-open';

/** Health for one upstream provider, as shown in the admin "Providers" panel. */
export interface ProviderHealth {
  name: string;
  state: BreakerState;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  staleServedCount: number;
  openedAt: number | null;
}

export interface ProviderHealthReport {
  tcgdex: ProviderHealth;
  pricecharting: ProviderHealth & { configured: boolean };
}

/**
 * Everything the collection store needs from persistence. The app uses the HTTP server;
 * tests use an in-memory implementation with the same semantics; public share pages use a
 * read-only one.
 */
export interface Backend {
  /** When set, the store skips writes up front instead of attempting them and rolling back. */
  readonly readOnly?: boolean;
  collections(): Promise<CollectionSummary[]>;
  state(collectionId: string): Promise<CollectionData>;
  putEntries(collectionId: string, entries: CollectionEntry[]): Promise<void>;
  deleteEntries(collectionId: string, ids: string[]): Promise<void>;
  putWishlist(collectionId: string, entry: WishlistEntry): Promise<void>;
  deleteWishlist(collectionId: string, cardId: string): Promise<void>;
  putNote(collectionId: string, cardId: string, text: string): Promise<void>;
  putGraded(collectionId: string, copy: GradedCopy): Promise<void>;
  /** Soft delete: putGraded with the same copy restores it along with its photos. */
  deleteGraded(collectionId: string, id: string): Promise<void>;
  photos(collectionId: string, gradedId: string): Promise<PhotoRef[]>;
  addPhotos(collectionId: string, gradedId: string, files: Blob[], side: GradedPhoto['side']): Promise<PhotoRef[]>;
  deletePhoto(collectionId: string, photoId: string): Promise<void>;
  /** Links a slab to a PriceCharting product; returns the updated copy with pcProductId/pcPrice/pcUpdatedAt set. */
  linkGraded(collectionId: string, gradedId: string, pcProductId: string): Promise<GradedCopy>;
  putSealed(collectionId: string, item: SealedItem): Promise<SealedItem>;
  deleteSealed(collectionId: string, id: string): Promise<void>;
  /** Marks a sealed item opened (excluded from value, kept for history). Returns the updated item. */
  openSealed(collectionId: string, id: string): Promise<SealedItem>;
  /** Links a sealed item to a PriceCharting product and fetches its price. */
  linkSealed(collectionId: string, id: string, pcProductId: string): Promise<SealedItem>;
  sealedPhotos(collectionId: string, sealedId: string): Promise<PhotoRef[]>;
  addSealedPhotos(collectionId: string, sealedId: string, files: Blob[]): Promise<PhotoRef[]>;
  deleteSealedPhoto(collectionId: string, photoId: string): Promise<void>;
  /** Whether PriceCharting is configured, so the UI knows whether to show its search/link controls. */
  pcConfigured(): Promise<boolean>;
  pcSearch(query: string): Promise<PcProduct[]>;
  pcAdminStatus(): Promise<boolean>;
  pcSetKey(key: string): Promise<void>;
  pcClearKey(): Promise<void>;
  pcTest(): Promise<void>;
  recordValue(collectionId: string): Promise<ValuePoint | null>;
  importData(collectionId: string, data: unknown): Promise<ImportResult>;
  clear(collectionId: string): Promise<void>;
  /** Asks the server for full card details (prices), fetching them upstream if needed. */
  hydrate(ids: string[]): Promise<CardSnapshot[]>;
  /** Records a set's master-set size (all variants) so progress can be computed without refetching the set. */
  putSetStat(setId: string, masterTotal: number): Promise<void>;
  createList(collectionId: string, name: string, description?: string, opts?: { kind?: 'list' | 'deck'; format?: DeckFormat }): Promise<CustomList>;
  updateList(collectionId: string, listId: string, patch: { name?: string; description?: string; order?: string[]; format?: DeckFormat }): Promise<void>;
  deleteList(collectionId: string, listId: string): Promise<void>;
  addToList(collectionId: string, listId: string, cardId: string): Promise<void>;
  removeFromList(collectionId: string, listId: string, cardId: string): Promise<void>;
  /** Sets a card's quantity in a list (deck), adding it if not already present. */
  setListCardQty(collectionId: string, listId: string, cardId: string, qty: number): Promise<void>;
  /** Parses and resolves pasted PTCGL/Limitless deck text to real cards. */
  resolveDeckText(text: string): Promise<DeckResolveResult>;
  /** Current deck-legality rules (regulation marks, banned cards). Any signed-in user may read these. */
  getDeckSettings(): Promise<DeckSettings>;
  /** Updates the deck-legality rules (owner/admin only). */
  putDeckSettings(patch: { regulationMarks?: { standard: string[]; expanded: string[] }; bannedCardIds?: string[] }): Promise<DeckSettings>;
  status(): Promise<SystemStatus>;
  /** Runs the server's price refresh and waits for it (owner/admin only). */
  refreshPrices(): Promise<void>;
  /** Per-variant, per-source daily price history for a card's chart. `days` defaults to 90 server-side. */
  priceHistory(cardId: string, days?: number): Promise<CardPriceHistory>;
  /** The biggest value movers in a collection over the window, split into gainers and losers. */
  movers(collectionId: string, days: 7 | 30): Promise<{ days: number; gainers: MoverCard[]; losers: MoverCard[] }>;
}

// Every id goes into the path through encodeURIComponent so an id containing reserved
// characters can never change which endpoint is hit.
const enc = encodeURIComponent;
const c = (id: string) => `/api/collections/${enc(id)}`;

export const httpBackend: Backend = {
  collections: () => api('/api/collections'),
  state: (id) => api(`${c(id)}/state`),
  putEntries: async (id, entries) => void (await api(`${c(id)}/entries`, { method: 'PUT', body: { entries } })),
  deleteEntries: async (id, ids) => void (await api(`${c(id)}/entries/delete`, { method: 'POST', body: { ids } })),
  putWishlist: async (id, w) => void (await api(`${c(id)}/wishlist/${enc(w.cardId)}`, { method: 'PUT', body: { addedAt: w.addedAt } })),
  deleteWishlist: async (id, cardId) => void (await api(`${c(id)}/wishlist/${enc(cardId)}`, { method: 'DELETE' })),
  putNote: async (id, cardId, text) => void (await api(`${c(id)}/notes/${enc(cardId)}`, { method: 'PUT', body: { text } })),
  putGraded: async (id, copy) => void (await api(`${c(id)}/graded/${enc(copy.id)}`, { method: 'PUT', body: copy })),
  deleteGraded: async (id, gid) => void (await api(`${c(id)}/graded/${enc(gid)}`, { method: 'DELETE' })),
  // Photo bytes are served by a separate authenticated route, so the list endpoint returns
  // metadata only and the URL is derived here.
  photos: async (id, gid) => {
    const rows = await api<Omit<PhotoRef, 'url'>[]>(`${c(id)}/graded/${enc(gid)}/photos`);
    return rows.map((p) => ({ ...p, url: `${c(id)}/photos/${enc(p.id)}` }));
  },
  addPhotos: async (id, gid, files, side) => {
    const form = new FormData();
    form.append('side', side);
    files.forEach((f, i) => form.append('file', f, `photo-${i}.jpg`));
    const rows = await api<{ id: string; side: PhotoRef['side'] }[]>(`${c(id)}/graded/${enc(gid)}/photos`, { method: 'POST', body: form });
    // The upload response omits timestamps; the local clock is close enough for display ordering.
    const at = new Date().toISOString();
    return rows.map((p) => ({ ...p, addedAt: at, url: `${c(id)}/photos/${enc(p.id)}` }));
  },
  deletePhoto: async (id, pid) => void (await api(`${c(id)}/photos/${enc(pid)}`, { method: 'DELETE' })),
  linkGraded: (id, gid, pcProductId) => api(`${c(id)}/graded/${enc(gid)}/link`, { method: 'POST', body: { pcProductId } }),
  putSealed: (id, item) => api(`${c(id)}/sealed/${enc(item.id)}`, { method: 'PUT', body: item }),
  deleteSealed: async (id, sid) => void (await api(`${c(id)}/sealed/${enc(sid)}`, { method: 'DELETE' })),
  openSealed: (id, sid) => api(`${c(id)}/sealed/${enc(sid)}/open`, { method: 'POST' }),
  linkSealed: (id, sid, pcProductId) => api(`${c(id)}/sealed/${enc(sid)}/link`, { method: 'POST', body: { pcProductId } }),
  sealedPhotos: async (id, sid) => {
    const rows = await api<{ id: string; addedAt: string }[]>(`${c(id)}/sealed/${enc(sid)}/photos`);
    return rows.map((p) => ({ ...p, side: 'other' as const, url: `${c(id)}/photos/sealed/${enc(p.id)}` }));
  },
  addSealedPhotos: async (id, sid, files) => {
    const form = new FormData();
    files.forEach((f, i) => form.append('file', f, `photo-${i}.jpg`));
    const rows = await api<{ id: string; mime: string }[]>(`${c(id)}/sealed/${enc(sid)}/photos`, { method: 'POST', body: form });
    const at = new Date().toISOString();
    return rows.map((p) => ({ id: p.id, side: 'other' as const, addedAt: at, url: `${c(id)}/photos/sealed/${enc(p.id)}` }));
  },
  deleteSealedPhoto: async (id, pid) => void (await api(`${c(id)}/photos/sealed/${enc(pid)}`, { method: 'DELETE' })),
  pcConfigured: async () => (await api<{ pricecharting: { configured: boolean } }>('/api/integrations')).pricecharting.configured,
  pcSearch: async (query) => (await api<{ results: PcProduct[] }>(`/api/pricecharting/search?q=${enc(query)}`)).results,
  pcAdminStatus: async () => (await api<{ pricecharting: { configured: boolean } }>('/api/admin/integrations')).pricecharting.configured,
  pcSetKey: async (key) => void (await api('/api/admin/integrations/pricecharting', { method: 'PUT', body: { key } })),
  pcClearKey: async () => void (await api('/api/admin/integrations/pricecharting', { method: 'DELETE' })),
  pcTest: async () => void (await api('/api/admin/integrations/pricecharting/test', { method: 'POST' })),
  recordValue: async (id) => (await api<{ point: ValuePoint | null }>(`${c(id)}/value`, { method: 'POST' })).point,
  importData: (id, data) => api(`${c(id)}/import`, { method: 'POST', body: data }),
  clear: async (id) => void (await api(`${c(id)}/clear`, { method: 'POST' })),
  hydrate: (ids) => api('/api/cards/hydrate', { method: 'POST', body: { ids } }),
  putSetStat: async (setId, masterTotal) => void (await api(`/api/set-stats/${enc(setId)}`, { method: 'PUT', body: { masterTotal } })),
  createList: (id, name, description, opts) => api(`${c(id)}/lists`, { method: 'POST', body: { name, description, ...opts } }),
  updateList: async (id, listId, patch) => void (await api(`${c(id)}/lists/${enc(listId)}`, { method: 'PATCH', body: patch })),
  deleteList: async (id, listId) => void (await api(`${c(id)}/lists/${enc(listId)}`, { method: 'DELETE' })),
  addToList: async (id, listId, cardId) => void (await api(`${c(id)}/lists/${enc(listId)}/cards/${enc(cardId)}`, { method: 'PUT' })),
  removeFromList: async (id, listId, cardId) => void (await api(`${c(id)}/lists/${enc(listId)}/cards/${enc(cardId)}`, { method: 'DELETE' })),
  setListCardQty: async (id, listId, cardId, qty) => void (await api(`${c(id)}/lists/${enc(listId)}/cards/${enc(cardId)}`, { method: 'PUT', body: { qty } })),
  resolveDeckText: (text) => api('/api/decks/resolve', { method: 'POST', body: { text } }),
  getDeckSettings: () => api('/api/decks/settings'),
  putDeckSettings: (patch) => api('/api/admin/deck-settings', { method: 'PUT', body: patch }),
  status: () => api('/api/system/status'),
  refreshPrices: async () => void (await api('/api/admin/jobs/prices/run?wait=1', { method: 'POST' })),
  priceHistory: (cardId, days) => api(`/api/cards/${enc(cardId)}/prices/history${days ? `?days=${days}` : ''}`),
  movers: (id, days) => api(`${c(id)}/movers?days=${days}`),
};

// Module-level rather than React context because the zustand store is created outside React.
let current: Backend = httpBackend;

export const getBackend = () => current;

/** Swaps the persistence layer (tests, public share pages). */
export function setBackend(b: Backend) {
  current = b;
}
