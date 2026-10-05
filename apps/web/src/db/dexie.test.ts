import { describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';

describe('database schema', () => {
  it('upgrades a v1 collection: backfills setId and adds the newer tables', async () => {
    await Dexie.delete('PokeTrackerDB');
    const v1 = new Dexie('PokeTrackerDB');
    v1.version(1).stores({ collection: 'id, cardId, variant, addedAt' });
    await v1.table('collection').bulkAdd([
      { id: 'sv03.5-006::normal', cardId: 'sv03.5-006', variant: 'normal', quantity: 1, addedAt: '2024-01-01' },
      { id: 'base1-4::holofoil', cardId: 'base1-4', setId: 'kept', variant: 'holofoil', quantity: 2, addedAt: '2024-01-02' },
    ]);
    v1.close();

    vi.resetModules();
    const { db } = await import('./dexie');
    const rows = await db.collection.orderBy('addedAt').toArray();
    expect(rows.map((r) => r.setId)).toEqual(['sv03.5', 'kept']);
    expect(await db.collection.where('setId').equals('sv03.5').count()).toBe(1);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['cards', 'collection', 'graded', 'gradedPhotos', 'images', 'notes', 'setStats', 'valueHistory', 'wishlist']);
    expect(db.verno).toBe(5);
    db.close();
  });

  it('clears stale master-set totals when upgrading from v2', async () => {
    await Dexie.delete('PokeTrackerDB');
    const v2 = new Dexie('PokeTrackerDB');
    v2.version(1).stores({ collection: 'id, cardId, variant, addedAt' });
    v2.version(2).stores({ collection: 'id, cardId, setId, variant, addedAt', cards: 'id, setId, name', wishlist: 'cardId, addedAt', valueHistory: 'date', setStats: 'setId' });
    await v2.table('setStats').put({ setId: 'sv03', masterTotal: 400 });
    await v2.table('wishlist').put({ cardId: 'sv03-001', addedAt: 'x' });
    v2.close();

    vi.resetModules();
    const { db } = await import('./dexie');
    expect(await db.setStats.count()).toBe(0);
    expect(await db.wishlist.count()).toBe(1);
    db.close();
  });
});
