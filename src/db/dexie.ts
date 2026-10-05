import Dexie, { type EntityTable } from 'dexie';
import type { CardNote, CardSnapshot, CollectionEntry, GradedCopy, GradedPhoto, SetStat, ValuePoint, WishlistEntry } from '../api/types';
import { setIdFromCardId } from '../api/client';

const db = new Dexie('PokeTrackerDB') as Dexie & {
  collection: EntityTable<CollectionEntry, 'id'>;
  cards: EntityTable<CardSnapshot, 'id'>;
  wishlist: EntityTable<WishlistEntry, 'cardId'>;
  valueHistory: EntityTable<ValuePoint, 'date'>;
  setStats: EntityTable<SetStat, 'setId'>;
  images: EntityTable<CachedImage, 'id'>;
  graded: EntityTable<GradedCopy, 'id'>;
  gradedPhotos: EntityTable<GradedPhoto, 'id'>;
  notes: EntityTable<CardNote, 'cardId'>;
};

export interface CachedImage {
  id: string;
  blob: Blob;
  savedAt: string;
}

db.version(1).stores({
  collection: 'id, cardId, variant, addedAt',
});

db.version(2)
  .stores({
    collection: 'id, cardId, setId, variant, addedAt',
    cards: 'id, setId, name',
    wishlist: 'cardId, addedAt',
    valueHistory: 'date',
    setStats: 'setId',
  })
  .upgrade((tx) =>
    tx
      .table('collection')
      .toCollection()
      .modify((e: CollectionEntry) => {
        e.setId ??= setIdFromCardId(e.cardId);
      }),
  );

// v3: switched catalogue to TCGdex. Card ids are remapped at runtime (needs the network);
// master-set totals are recomputed because variant detection changed.
db.version(3)
  .stores({ images: 'id' })
  .upgrade((tx) => tx.table('setStats').clear());

// v4: graded (slabbed) copies and their photos.
db.version(4).stores({ graded: 'id, cardId, setId, addedAt', gradedPhotos: 'id, gradedId' });

// v5: per-card free-text notes.
db.version(5).stores({ notes: 'cardId' });

export { db };
