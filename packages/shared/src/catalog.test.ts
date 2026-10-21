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

  it('fetches set cards with a bounded pool of twelve concurrent requests', async () => {
    const id = 'parallel-test';
    const cards = Array.from({ length: 24 }, (_, i) => ({
      id: `${id}-${i + 1}`,
      localId: String(i + 1),
      name: `Card ${i + 1}`,
      category: 'Pokemon',
      variants: { normal: true },
      set: { id, name: 'Parallel Test' },
    }));
    const set = { id, name: 'Parallel Test', releaseDate: '2026-10-01', cardCount: { official: cards.length, total: cards.length } };
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ data: { cards: cards.map(({ id: cardId }) => ({ id: cardId })) } });
      if (String(url).includes('/sets/')) return Response.json(set);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return Response.json(cards.find((card) => String(url).endsWith(`/cards/${card.id}`)));
    }));

    expect(await getSetCards(id)).toHaveLength(cards.length);
    expect(maxActive).toBe(12);
  });
});

describe('API-listed printings', () => {
  it.each(['swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'fr:swsh9tg', 'new-set'])('retains source records for %s without per-set deletion', (setId) => {
    expect(cardVariants({ id: `${setId}-TG23`, variants: ['holofoil', 'reverseHolofoil'] })).toEqual(['holofoil', 'reverseHolofoil']);
    expect(cardVariants({ id: `${setId}-TG23`, variants: [] })).toEqual([]);
  });
});
