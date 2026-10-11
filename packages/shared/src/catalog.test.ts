import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardVariants, getSetCards } from './catalog';

afterEach(() => vi.unstubAllGlobals());

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
