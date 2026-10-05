/**
 * Read-only Backend used on public share pages (/s/:token).
 *
 * The share payload is loaded separately via sharing.publicShare(); this backend only exists so
 * components that talk to the collection store keep working. Refusing writes here is a courtesy
 * for the UI: the real protection is that public routes on the server have no write endpoints and
 * apply the share's privacy flags before returning anything.
 */
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
    // These are called as background side effects by normal pages, so they resolve quietly
    // instead of throwing and surfacing an error toast to a visitor.
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
