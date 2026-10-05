import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLegacyIds = vi.hoisted(() => vi.fn());
vi.mock('@poketracker/shared/migrate', async (orig) => ({ ...(await orig<typeof import('@poketracker/shared/migrate')>()), resolveLegacyIds }));

import { personalId, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
  resolveLegacyIds.mockReset();
  s = await startServer();
});
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

describe('importing pokemontcg.io-era backups', () => {
  it('remaps legacy ids and variants, merging entries that collide', async () => {
    resolveLegacyIds.mockResolvedValue({ map: new Map([['sv3pt5-6', 'sv03.5-006'], ['sv3pt5-7', 'sv03.5-007']]), failedSets: 0 });
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    const res = await c.post(`/api/collections/${id}/import`, {
      collection: [
        { cardId: 'base1-4', variant: 'holofoil', quantity: 1 },
        { cardId: 'base1-4', variant: 'unlimitedHolofoil', quantity: 2 },
        { cardId: 'sv3pt5-6', variant: 'normal', quantity: 1, name: 'Charmander' },
      ],
      wishlist: [{ cardId: 'sv3pt5-7' }],
    });
    expect(res.json()).toMatchObject({ entries: 2, wishlist: 1, remapped: 3 });
    // Only legacy-looking set codes are looked up, with names to break number ties.
    expect(resolveLegacyIds).toHaveBeenCalledWith(['sv3pt5-6', 'sv3pt5-7'], new Map([['sv3pt5-6', 'Charmander']]));
    const st = (await c.get(`/api/collections/${id}/state`)).json();
    expect(st.entries.map((e: { id: string; quantity: number; setId: string }) => [e.id, e.quantity, e.setId]).sort()).toEqual([
      ['base1-4::holofoil', 3, 'base1'],
      ['sv03.5-006::normal', 1, 'sv03.5'],
    ]);
    expect(st.wishlist.map((w: { cardId: string }) => w.cardId)).toEqual(['sv03.5-007']);
  });

  it('still imports, unmapped, when the catalogue is unreachable', async () => {
    resolveLegacyIds.mockRejectedValue(new Error('offline'));
    const c = await setupOwner(s.app);
    const id = await personalId(c);
    expect((await c.post(`/api/collections/${id}/import`, [{ cardId: 'sv3pt5-6', variant: 'normal' }])).json()).toMatchObject({ entries: 1, remapped: 0 });
  });

  it('makes no lookups for modern exports', async () => {
    const c = await setupOwner(s.app);
    await c.post(`/api/collections/${await personalId(c)}/import`, [{ cardId: 'sv03.5-006', variant: 'normal' }]);
    expect(resolveLegacyIds).not.toHaveBeenCalled();
  });
});
