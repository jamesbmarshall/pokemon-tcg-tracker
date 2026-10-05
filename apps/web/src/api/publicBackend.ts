import type { Backend } from './backend';
import { sharing } from './sharing';

const refuse = async (): Promise<never> => {
  throw new Error('This is a read-only shared view');
};

/** Backs the store on public share pages: reads photos through the share token, refuses every write. */
export function publicBackend(token: string): Backend {
  return {
    readOnly: true,
    collections: async () => [],
    state: refuse,
    putEntries: refuse,
    deleteEntries: refuse,
    putWishlist: refuse,
    deleteWishlist: refuse,
    putNote: refuse,
    putGraded: refuse,
    deleteGraded: refuse,
    photos: (_cid, gradedId) => sharing.publicPhotos(token, gradedId),
    addPhotos: refuse,
    deletePhoto: refuse,
    recordValue: async () => null,
    importData: refuse,
    clear: refuse,
    hydrate: async () => [],
    putSetStat: async () => undefined,
    createList: refuse,
    updateList: refuse,
    deleteList: refuse,
    addToList: refuse,
    removeFromList: refuse,
    status: async () => ({ version: '', lastPriceSync: null, fxAt: null }),
    refreshPrices: refuse,
  };
}
