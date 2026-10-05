import { api } from './http';
import type { CardSnapshot, CollectionEntry, GradedCopy, GradedPhoto, SetStat, ValuePoint, WishlistEntry } from './types';
import type { CardNote } from './types';

export type CollectionRole = 'owner' | 'editor' | 'viewer';

export interface CustomList {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Card ids in display order */
  cards: string[];
}

export interface CollectionSummary {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  role: CollectionRole;
  ownerName: string;
  mine: boolean;
}

export interface CollectionData {
  role: CollectionRole;
  entries: CollectionEntry[];
  graded: GradedCopy[];
  wishlist: WishlistEntry[];
  notes: CardNote[];
  history: ValuePoint[];
  cards: CardSnapshot[];
  setStats: SetStat[];
  lists: CustomList[];
}

export interface PhotoRef {
  id: string;
  side: GradedPhoto['side'];
  addedAt: string;
  url: string;
}

export interface ImportResult {
  entries: number;
  graded: number;
  wishlist: number;
  notes: number;
  history: number;
  photos: number;
  remapped: number;
}

export interface SystemStatus {
  version: string;
  lastPriceSync: string | null;
  fxAt: number | null;
  updateAvailable?: boolean;
  latest?: string | null;
}

/**
 * Everything the collection store needs from persistence. The app uses the HTTP server;
 * tests use an in-memory implementation with the same semantics; public share pages use a
 * read-only one.
 */
export interface Backend {
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
  recordValue(collectionId: string): Promise<ValuePoint | null>;
  importData(collectionId: string, data: unknown): Promise<ImportResult>;
  clear(collectionId: string): Promise<void>;
  /** Asks the server for full card details (prices), fetching them upstream if needed. */
  hydrate(ids: string[]): Promise<CardSnapshot[]>;
  putSetStat(setId: string, masterTotal: number): Promise<void>;
  createList(collectionId: string, name: string, description?: string): Promise<CustomList>;
  updateList(collectionId: string, listId: string, patch: { name?: string; description?: string; order?: string[] }): Promise<void>;
  deleteList(collectionId: string, listId: string): Promise<void>;
  addToList(collectionId: string, listId: string, cardId: string): Promise<void>;
  removeFromList(collectionId: string, listId: string, cardId: string): Promise<void>;
  status(): Promise<SystemStatus>;
  /** Runs the server's price refresh and waits for it (owner/admin only). */
  refreshPrices(): Promise<void>;
}

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
  photos: async (id, gid) => {
    const rows = await api<Omit<PhotoRef, 'url'>[]>(`${c(id)}/graded/${enc(gid)}/photos`);
    return rows.map((p) => ({ ...p, url: `${c(id)}/photos/${enc(p.id)}` }));
  },
  addPhotos: async (id, gid, files, side) => {
    const form = new FormData();
    form.append('side', side);
    files.forEach((f, i) => form.append('file', f, `photo-${i}.jpg`));
    const rows = await api<{ id: string; side: PhotoRef['side'] }[]>(`${c(id)}/graded/${enc(gid)}/photos`, { method: 'POST', body: form });
    const at = new Date().toISOString();
    return rows.map((p) => ({ ...p, addedAt: at, url: `${c(id)}/photos/${enc(p.id)}` }));
  },
  deletePhoto: async (id, pid) => void (await api(`${c(id)}/photos/${enc(pid)}`, { method: 'DELETE' })),
  recordValue: async (id) => (await api<{ point: ValuePoint | null }>(`${c(id)}/value`, { method: 'POST' })).point,
  importData: (id, data) => api(`${c(id)}/import`, { method: 'POST', body: data }),
  clear: async (id) => void (await api(`${c(id)}/clear`, { method: 'POST' })),
  hydrate: (ids) => api('/api/cards/hydrate', { method: 'POST', body: { ids } }),
  putSetStat: async (setId, masterTotal) => void (await api(`/api/set-stats/${enc(setId)}`, { method: 'PUT', body: { masterTotal } })),
  createList: (id, name, description) => api(`${c(id)}/lists`, { method: 'POST', body: { name, description } }),
  updateList: async (id, listId, patch) => void (await api(`${c(id)}/lists/${enc(listId)}`, { method: 'PATCH', body: patch })),
  deleteList: async (id, listId) => void (await api(`${c(id)}/lists/${enc(listId)}`, { method: 'DELETE' })),
  addToList: async (id, listId, cardId) => void (await api(`${c(id)}/lists/${enc(listId)}/cards/${enc(cardId)}`, { method: 'PUT' })),
  removeFromList: async (id, listId, cardId) => void (await api(`${c(id)}/lists/${enc(listId)}/cards/${enc(cardId)}`, { method: 'DELETE' })),
  status: () => api('/api/system/status'),
  refreshPrices: async () => void (await api('/api/admin/jobs/prices/run?wait=1', { method: 'POST' })),
};

let current: Backend = httpBackend;

export const getBackend = () => current;

/** Swaps the persistence layer (tests, public share pages). */
export function setBackend(b: Backend) {
  current = b;
}
