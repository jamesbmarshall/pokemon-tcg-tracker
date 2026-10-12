import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCard, getSetCards, toSnapshot } from './catalog';
import { resolvePrintings, standardVariants } from './printings';
import { setProgress } from './completion';
import { priceOf } from './value';
import type { PokemonCard } from './types';

afterEach(() => vi.unstubAllGlobals());
const raw = [
  { type: 'normal', size: 'standard' },
  { type: 'holo', size: 'standard', foil: 'cosmos' },
  { type: 'reverse', size: 'standard' },
];
function card(id = 'sv03-016'): PokemonCard {
  const printings = resolvePrintings(id, ['normal', 'holofoil', 'reverseHolofoil'], raw);
  return { id, name: 'Bounsweet', number: '016', supertype: 'Pokémon', variants: printings.map((p) => p.id), printings,
    images: { small: '', large: '' }, set: { id: 'sv03', name: 'Obsidian Flames', series: 'Scarlet & Violet', printedTotal: 197, total: 230, releaseDate: '', updatedAt: '', images: { symbol: '', logo: '' } } };
}

describe('physical printing classification', () => {
  it.each(['sv03-016', 'sv03-017'])('keeps %s Cosmos Holo collectible outside standard completion', (id) => {
    const c = card(id);
    const exclusive = c.printings![1];
    expect(exclusive).toMatchObject({ label: 'Cosmos Holo', distribution: 'exclusive', status: 'verified', sourceProduct: 'Tsareena ex Premium Collection', legacyAliases: ['holofoil'] });
    expect(standardVariants(c)).toEqual(['normal', 'reverseHolofoil']);
    const p = setProgress([c], new Map([[id, { [exclusive.id]: 1 }]]));
    expect(p.base).toEqual({ owned: 0, total: 1 });
    expect(p.full.owned).toBe(0);
    expect(p.master).toEqual({ owned: 0, total: 2 });
    expect(p.all).toEqual({ owned: 1, total: 3 });
  });
  it('normalises upstream enum casing without losing the source attributes', () => {
    const [printing] = resolvePrintings('fr:sv03-016', [], [{ type: 'Normal', size: 'Standard' }]);
    expect(printing).toMatchObject({ id: 'normal', distribution: 'expansion', raw: { type: 'Normal', size: 'Standard' } });
  });
  it('does not apply English product corrections to another language', () => {
    expect(card('fr:sv03-016').printings![1]).toMatchObject({ distribution: 'unknown', status: 'unverified' });
  });
  it('keeps printing IDs stable when providers add, reorder or rename records', () => {
    const initial = resolvePrintings('sv03-016', [], raw);
    const changed = resolvePrintings('sv03-016', [], [...raw, { type: 'holo', size: 'jumbo' }].reverse());
    for (const p of initial) expect(changed.find((q) => q.label === p.label)?.id).toBe(p.id);
    expect(changed.find((p) => p.label === 'Cosmos Holo')?.legacyAliases).toEqual([]);
  });
  it('does not collapse finishes, stamps or sizes, including new upstream types', () => {
    const printings = resolvePrintings('future-001', [], [...raw, { type: 'holo', foil: 'new-treatment', size: 'standard' }, { type: 'holo', foil: 'cosmos', size: 'jumbo' }, { type: 'normal', stamp: ['retailer'] }, { type: 'future-treatment' }]);
    expect(new Set(printings.map((p) => p.id)).size).toBe(7);
    expect(printings.filter((p) => p.status === 'unverified')).toHaveLength(5);
    expect(printings.every((p) => /^[A-Za-z0-9_]{1,80}$/.test(p.id))).toBe(true);
  });
  it('recognises standard historical and gallery treatments', () => {
    expect(resolvePrintings('ex16-001', [], [{ type: 'normal', stamp: ['set-logo'] }])[0].distribution).toBe('expansion');
    expect(resolvePrintings('base3-1', [], [{ type: 'holo', foil: 'galaxy', stamp: ['1st-edition'] }])[0].distribution).toBe('expansion');
    expect(resolvePrintings('swsh12tg-TG30', [], [{ type: 'holo', foil: 'gold' }])[0].distribution).toBe('expansion');
    expect(resolvePrintings('swsh10tg-TG29', [], [{ type: 'holo', stamp: [] }, { type: 'holo', foil: 'gold' }, { type: 'reverse' }])).toHaveLength(1);
    expect(resolvePrintings('sv10.5b-001', [], [{ type: 'reverse', foil: 'masterball' }])[0].distribution).toBe('expansion');
  });
  it('keeps legacy snapshots provisional and avoids price substitution for classified cards', () => {
    const c = card();
    const snapshot = toSnapshot(c);
    snapshot.prices = { normal: 0.1, reverseHolofoil: 0.2 };
    expect(priceOf(snapshot, c.printings![1].id)).toBeUndefined();
    expect(setProgress([{ ...c, printings: undefined }], new Map()).provisional).toBe(true);
  });
});

describe('catalogue printing parity and pricing', () => {
  it('uses the same IDs and eligibility in set listings and details, with separate product prices', async () => {
    const source = {
      id: 'sv03-016', localId: '016', name: 'Bounsweet', rarity: 'Common', variants: { normal: true, holo: true, reverse: true },
      variants_detailed: raw.map((p) => ({ ...p, pricing: p.type === 'holo'
        ? { cardmarket: { trend: 5 } }
        : { tcgplayer: { normal: { marketPrice: 0.1 }, 'reverse-holofoil': { marketPrice: 0.2 } } } })),
      pricing: { cardmarket: { trend: 0.1, 'trend-holo': 0.2 } },
    };
    vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => Response.json(init?.method === 'POST'
      ? { data: { cards: [null, source, null] } } : String(url).includes('/cards/') ? source : { id: 'sv03', name: 'Obsidian Flames', cardCount: { official: 197, total: 230 } })));
    const [brief] = await getSetCards('sv03');
    const detailed = await getCard('sv03-016');
    expect(brief.variants).toEqual(detailed.variants);
    expect(standardVariants(brief)).toEqual(standardVariants(detailed));
    expect(detailed.cardmarket?.prices[detailed.printings![1].id]?.market).toBe(5);
    expect(detailed.cardmarket?.prices.holofoil).toBeUndefined();
    expect(detailed.tcgplayer?.prices.reverseHolofoil.market).toBe(0.2);
  });
});
