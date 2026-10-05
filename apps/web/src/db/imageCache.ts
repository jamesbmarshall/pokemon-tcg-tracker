import { db } from './dexie';
import type { CardSnapshot } from '../api/types';

/**
 * Keeps a local copy of the image for every owned or wishlisted card, so the collection
 * still renders if the image CDN changes or goes away.
 */
const urls = new Map<string, string>();
const lookups = new Map<string, Promise<string | undefined>>();

export const cachedImageUrl = (id: string) => urls.get(id);

export function loadCachedImage(id: string): Promise<string | undefined> {
  let p = lookups.get(id);
  if (!p) {
    p = db.images
      .get(id)
      .then((row) => {
        if (!row) {
          lookups.delete(id);
          return undefined;
        }
        const url = URL.createObjectURL(row.blob);
        urls.set(id, url);
        return url;
      })
      .catch(() => undefined);
    lookups.set(id, p);
  }
  return p;
}

let queue = Promise.resolve();

export function cacheImages(cards: CardSnapshot[]) {
  queue = queue.then(async () => {
    const wanted = cards.filter((c) => c.image.startsWith('https://assets.tcgdex.net/'));
    if (!wanted.length) return;
    const have = await db.images.bulkGet(wanted.map((c) => c.id));
    const missing = wanted.filter((_, i) => !have[i]);
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(
        missing.slice(i, i + 4).map(async (c) => {
          try {
            const res = await fetch(c.image);
            if (!res.ok) return;
            const blob = await res.blob();
            if (blob.type.startsWith('image/')) await db.images.put({ id: c.id, blob, savedAt: new Date().toISOString() });
          } catch {
            /* offline or blocked — try again next sync */
          }
        }),
      );
    }
  });
  return queue;
}

export async function pruneImages(keep: Set<string>) {
  const ids = (await db.images.toCollection().primaryKeys()) as string[];
  const drop = ids.filter((id) => !keep.has(id));
  if (drop.length) await db.images.bulkDelete(drop);
  for (const id of drop) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
    lookups.delete(id);
  }
}

export const countCachedImages = () => db.images.count();
