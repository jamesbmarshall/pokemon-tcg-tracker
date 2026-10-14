import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardVariants, getSet, getSets } from './catalog';

afterEach(() => vi.unstubAllGlobals());

describe('set catalogue', () => {
  it('loads sets without requesting the REST-only abbreviation field', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(query.includes('abbreviation')
        ? { errors: [{ message: 'Cannot query field "abbreviation" on type "Set".' }] }
        : { data: { sets: [{ id: 'sv01', name: 'Scarlet & Violet', cardCount: { official: 198, total: 258 } }] } }));
    }));

    const sets = await getSets();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ id: 'sv01', ptcgoCode: 'SVI', printedTotal: 198, total: 258 });
  });

  it('still uses official abbreviations from REST set details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'new-set', name: 'New set', abbreviation: { official: 'NEW' },
    }))));
    expect(await getSet('new-set')).toMatchObject({ ptcgoCode: 'NEW' });
  });
});

describe('API-listed printings', () => {
  it.each(['swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'fr:swsh9tg', 'new-set'])('retains source records for %s without per-set deletion', (setId) => {
    expect(cardVariants({ id: `${setId}-TG23`, variants: ['holofoil', 'reverseHolofoil'] })).toEqual(['holofoil', 'reverseHolofoil']);
    expect(cardVariants({ id: `${setId}-TG23`, variants: [] })).toEqual([]);
  });
});
