import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureCatalog, getCard, getSetCards, toSnapshot } from './catalog';
import { resolvePrintings, standardVariants, type RawPrinting } from './printings';
import { applyPrintingProfile, buildPrintingProfile } from './printingRules';
import { setProgress } from './completion';
import type { PokemonCard } from './types';

afterEach(() => { vi.unstubAllGlobals(); configureCatalog({ base: 'https://api.tcgdex.net/v2', storage: null }); });
function card(id: string, raw: RawPrinting[], rarity = 'Common'): PokemonCard {
  const setId = id.slice(0, id.lastIndexOf('-'));
  const printings = resolvePrintings(id, [], raw);
  return { id, name: 'Any card', number: id.split('-').at(-1)!, supertype: 'Pokémon', rarity,
    variants: printings.map((p) => p.id), printings, printingVersion: 2,
    printingContext: { setId, language: id.includes(':') ? id.split(':')[0] : 'en', rarity, category: 'Pokemon', mechanic: '' },
    images: { small: '', large: '' }, set: { id: setId, name: 'Any set', series: '', printedTotal: 100, total: 12, releaseDate: '', updatedAt: '', images: { symbol: '', logo: '' } } };
}
const pair = (id: number, base = 'normal'): RawPrinting[] => [base, 'reverse'].map((type) => ({ type, thirdParty: { cardmarket: id } }));
function example(set = 'sv03', base = 'normal', extra = 'holo', count = 11) {
  const target = card(`${set}-026`, [...pair(725106, base), { type: extra, thirdParty: { cardmarket: 727116 } }]);
  const peers = Array.from({ length: count }, (_, i) => card(`${set}-peer${i}`, pair(i + 1, base)));
  const profile = buildPrintingProfile(set, [...peers, target], true);
  return { target, peers, profile, result: applyPrintingProfile(target, profile) };
}

describe('automatic printing policy', () => {
  it.each(['sv03', 'future-unseen-set', 'fr:future-set'])('classifies the Charmander-shaped payload without names or set exceptions: %s', (set) => {
    const { result } = example(set);
    expect(result.printings!.map((p) => p.role)).toEqual(['core', 'parallel', 'additional']);
    expect(result.printings![2]).toMatchObject({ id: 'holofoil', distribution: 'unknown', status: 'inferred', decision: { rule: 'R40' } });
    expect(result.printings![2].sourceProduct).toBeUndefined();
    expect(standardVariants(result)).toEqual(['normal', 'reverseHolofoil']);
    const extraOnly = setProgress([result], new Map([[result.id, { holofoil: 1 }]]));
    expect(extraOnly.master).toEqual({ owned: 0, total: 2 });
    expect(extraOnly.base.owned).toBe(0);
    expect(extraOnly.all).toEqual({ owned: 1, total: 3 });
    expect(extraOnly.additional).toBe(1);
  });
  it('handles an additional Normal symmetrically', () => {
    expect(example('future', 'holo', 'normal').result.printings!.map((p) => p.role)).toEqual(['core', 'parallel', 'additional']);
  });
  it('requires a full import and enough other cards', () => {
    const { target, profile } = example('future', 'normal', 'holo', 9);
    expect(applyPrintingProfile(target, profile).printings!.every((p) => p.role === 'unresolved')).toBe(true);
    const valid = example();
    expect(applyPrintingProfile(valid.target, { ...valid.profile, complete: false }).printings![2].role).toBe('unresolved');
  });
  it.each(['missing', 'shared', 'cross-market', 'contradictory'])('does not infer an additional printing from %s product evidence', (mode) => {
    const { target, peers } = example();
    const extra = target.printings![2];
    extra.productIds = mode === 'missing' ? undefined : mode === 'shared' ? { cardmarket: 725106 } : mode === 'cross-market' ? { tcgplayer: 727116 } : { cardmarket: 727116, tcgplayer: 9 };
    if (mode === 'contradictory') target.printings![0].productIds!.tcgplayer = 9;
    const result = applyPrintingProfile(target, buildPrintingProfile('sv03', [...peers, target], true));
    expect(result.printings![2].role).toBe('unresolved');
  });
  it('supports genuinely recurring multiple Core finishes and new parallels', () => {
    const records: RawPrinting[] = [{ type: 'normal' }, { type: 'holo', foil: 'future-foil' }, { type: 'reverse', foil: 'new-ball' }];
    const cards = Array.from({ length: 12 }, (_, i) => card(`unseen-${i}`, records));
    const result = applyPrintingProfile(cards[0], buildPrintingProfile('unseen', cards, true));
    expect(result.printings!.map((p) => p.role)).toEqual(['core', 'core', 'parallel']);
  });
  it('handles editions without a historical set whitelist', () => {
    const records = [{ type: 'holo', foil: 'galaxy', stamp: ['1st-edition'] }, { type: 'holo', foil: 'galaxy', subtype: 'unlimited' }];
    const cards = Array.from({ length: 12 }, (_, i) => card(`history-${i}`, records, 'Rare Holo'));
    expect(applyPrintingProfile(cards[0], buildPrintingProfile('history', cards, true)).printings!.map((p) => p.role)).toEqual(['core', 'core']);
  });
  it('does not use a different rarity or language as peers', () => {
    const { target, peers } = example();
    for (const c of peers) c.printingContext!.rarity = 'Rare';
    expect(applyPrintingProfile(target, buildPrintingProfile('sv03', [...peers, target], true)).printings![2].role).toBe('unresolved');
  });
  it('separates oversized and campaign printings without excluding sole promotional cards', () => {
    const ordinary = card('x-1', [{ type: 'normal' }, { type: 'normal', size: 'jumbo' }, { type: 'normal', stamp: ['gamestop'] }]);
    expect(ordinary.printings!.map((p) => p.role)).toEqual(['core', 'additional', 'additional']);
    expect(card('promo-1', [{ type: 'holo', foil: 'cosmos' }]).printings![0].role).toBe('core');
    expect(card('promo-2', [{ type: 'holo', stamp: ['pokemon-center'] }]).printings![0].role).toBe('unresolved');
  });
  it('keeps coarse and malformed data unresolved without creating finishes', () => {
    expect(resolvePrintings('x-1', [])).toEqual([]);
    expect(resolvePrintings('x-1', ['holofoil'])[0].role).toBe('unresolved');
    expect(resolvePrintings('x-1', [], [{ type: 'normal', variantId: 'generated' }])[0].role).toBe('unresolved');
    expect(resolvePrintings('x-1', [], [{ type: 'normal', size: 12 } as unknown as RawPrinting])[0].role).toBe('unresolved');
    expect(resolvePrintings('x-1', [], [{ type: 'normal', stamp: 12 } as unknown as RawPrinting])[0].role).toBe('unresolved');
    const nullable = { type: 'Normal', size: null, foil: null, subtype: null, stamp: null } as unknown as RawPrinting;
    expect(resolvePrintings('x-1', [], [nullable])[0]).toMatchObject({ id: 'normal', role: 'core', raw: { type: 'Normal' } });
  });
  it('merges duplicate references and refuses contradictory duplicate records', () => {
    expect(resolvePrintings('x-1', [], [{ type: 'normal', thirdParty: { cardmarket: 1 } }, { type: 'normal', thirdParty: { tcgplayer: 2 } }])[0]).toMatchObject({ role: 'core', productIds: { cardmarket: 1, tcgplayer: 2 } });
    expect(resolvePrintings('x-1', [], [{ type: 'normal', thirdParty: { cardmarket: 1 } }, { type: 'normal', thirdParty: { cardmarket: 2 } }])[0]).toMatchObject({ role: 'unresolved', dataQuality: 'conflict' });
  });
  it('uses the exact minimum peer and 80 percent boundaries', () => {
    const { target, peers } = example('threshold', 'normal', 'holo', 10);
    for (const c of peers.slice(8)) c.printings = resolvePrintings(c.id, [], [{ type: 'holo' }]);
    let profile = buildPrintingProfile('threshold', [target, ...peers], true);
    expect(applyPrintingProfile(target, profile).printings!.map((p) => p.role)).toEqual(['core', 'parallel', 'additional']);
    peers[7].printings = resolvePrintings(peers[7].id, [], [{ type: 'holo' }]);
    profile = buildPrintingProfile('threshold', [target, ...peers], true);
    expect(applyPrintingProfile(target, profile).printings!.every((p) => p.role === 'unresolved')).toBe(true);
  });
  it('keeps identity and profile stable when order, names and prices change', () => {
    const { target, peers, profile } = example();
    target.name = 'Renamed';
    target.tcgplayer = { url: '', updatedAt: '', prices: { normal: { market: 999 } } };
    target.printings!.reverse();
    expect(buildPrintingProfile('sv03', [target, ...peers.reverse()], true).fingerprint).toBe(profile.fingerprint);
    const before = resolvePrintings('x-1', [], [{ type: 'holo', foil: 'cosmos' }])[0];
    const after = resolvePrintings('x-1', [], [{ type: 'holo', size: 'jumbo' }, { type: 'holo', foil: 'cosmos' }]);
    expect(after.find((p) => p.raw?.foil === 'cosmos')!.id).toBe(before.id);
  });
});

describe('catalogue imports', () => {
  it('hydrates listing data and uses the same profile and physical prices on card details', async () => {
    const rawCards = Array.from({ length: 12 }, (_, i) => ({ id: `api-${i}`, localId: String(i), name: 'Any card', category: 'Pokemon', rarity: 'Common', variants_detailed: pair(100 + i) }));
    const target = rawCards[0];
    target.variants_detailed.push({ type: 'holo', thirdParty: { cardmarket: 999 } });
    const pricing = target.variants_detailed.map((p) => ({ ...p, pricing: { cardmarket: { idProduct: p.thirdParty!.cardmarket, trend: p.type === 'holo' ? 10 : 1, 'trend-holo': 2 } } }));
    vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ data: { sets: [], cards: rawCards.map(({ id }) => ({ id })) } });
      if (String(url).includes('/sets/')) return Response.json({ id: 'api', name: 'Set', cardCount: { official: 12, total: 12 } });
      const c = rawCards.find((c) => String(url).endsWith(`/cards/${c.id}`))!;
      return Response.json(c.id === target.id ? { ...c, variants_detailed: pricing } : c);
    }));
    const cards = await getSetCards('api');
    const detail = await getCard(target.id);
    expect(detail.printings).toEqual(cards[0].printings);
    expect(standardVariants(detail)).toEqual(['normal', 'reverseHolofoil']);
    expect(detail.cardmarket!.prices).toMatchObject({ normal: { market: 1 }, reverseHolofoil: { market: 2 }, holofoil: { market: 10 } });
    expect(toSnapshot(detail).printingProfile).toBe(cards[0].printingProfile);
  });
  it('refuses a partial set instead of publishing a smaller denominator', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => Response.json(init?.method === 'POST' ? { data: { cards: [{ id: 'partial-1' }] } } : { id: 'partial', cardCount: { total: 2 } })));
    await expect(getSetCards('partial')).rejects.toThrow('incomplete');
  });
  it('does not invent a rarity-based finish or trust conflicting flags', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init?: RequestInit) => Response.json(init?.method === 'POST' ? { data: { sets: [] } } : { id: String(url).split('/').at(-1), localId: '1', name: 'X', rarity: 'Rare Holo', ...(String(url).endsWith('conflict-1') ? { variants: { normal: false }, variants_detailed: [{ type: 'normal' }] } : {}) })));
    expect((await getCard('empty-1')).variants).toEqual([]);
    expect((await getCard('conflict-1')).printings![0]).toMatchObject({ dataQuality: 'conflict', role: 'unresolved' });
  });
});
