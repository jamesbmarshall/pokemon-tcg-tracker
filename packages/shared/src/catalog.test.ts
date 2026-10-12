import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardVariants, getSet, getSetCards, getSets } from './catalog';

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

describe('Trainer Gallery variants', () => {
  it.each(['swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'fr:swsh9tg'])('removes reverse holo from %s, including cached cards', (setId) => {
    expect(cardVariants({ id: `${setId}-TG23`, variants: ['holofoil', 'reverseHolofoil'] })).toEqual(['holofoil']);
    expect(cardVariants({ id: `${setId}-TG23`, variants: ['reverseHolofoil'] })).toEqual(['holofoil']);
  });

  it('preserves reverse holo on main-set cards', () => {
    expect(cardVariants({ id: 'swsh9-132', variants: ['normal', 'reverseHolofoil'] })).toEqual(['normal', 'reverseHolofoil']);
  });

  it('counts 30 master variants when two Brilliant Stars Trainers have erroneous reverse flags', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
      ? { data: { cards: Array.from({ length: 30 }, (_, i) => ({
        id: `swsh9tg-TG${String(i + 1).padStart(2, '0')}`,
        localId: `TG${String(i + 1).padStart(2, '0')}`,
        name: 'Gallery card',
        category: i === 22 || i === 23 ? 'Trainer' : 'Pokemon',
        variants: { holo: true, reverse: i === 22 || i === 23 },
      })) } }
      : { id: 'swsh9tg', name: 'Brilliant Stars Trainer Gallery', cardCount: { official: 30, total: 30 } }), { status: 200 })));

    const cards = await getSetCards('swsh9tg');
    expect(cards).toHaveLength(30);
    expect(cards.every((card) => card.variants.join() === 'holofoil')).toBe(true);
    expect(cards.reduce((total, card) => total + cardVariants(card).length, 0)).toBe(30);
  });
});
