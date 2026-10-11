import type { CardSet, CardSnapshot, CollectionEntry, GradedCopy, PokemonCard, SealedItem } from '../api/types';

export const rawSets = [
  {
    id: 'sv03',
    name: 'Obsidian Flames',
    releaseDate: '2023-08-11',
    logo: 'https://assets.tcgdex.net/en/sv/sv03/logo',
    symbol: 'https://assets.tcgdex.net/univ/sv/sv03/symbol',
    serie: { id: 'sv', name: 'Scarlet & Violet' },
    cardCount: { official: 197, total: 230 },
  },
  {
    id: 'sv03.5',
    name: '151',
    releaseDate: '2023-09-22',
    logo: 'https://assets.tcgdex.net/en/sv/sv03.5/logo',
    symbol: 'https://assets.tcgdex.net/univ/sv/sv03.5/symbol',
    serie: { id: 'sv', name: 'Scarlet & Violet' },
    cardCount: { official: 165, total: 207 },
  },
  {
    id: 'base1',
    name: 'Base Set',
    releaseDate: '1999-01-09',
    serie: { id: 'base', name: 'Base' },
    cardCount: { official: 102, total: 102 },
  },
  { id: 'A1', name: 'Genetic Apex', releaseDate: '2024-10-30', serie: { id: 'tcgp', name: 'Pokémon TCG Pocket' }, cardCount: { official: 226, total: 286 } },
  { id: 'empty', name: 'Empty Set', releaseDate: '2025-01-01', serie: { id: 'sv', name: 'Scarlet & Violet' }, cardCount: { official: 0, total: 0 } },
];

export function rawCard(id: string, over: Record<string, unknown> = {}) {
  const localId = id.slice(id.lastIndexOf('-') + 1);
  return {
    id,
    localId,
    name: `Card ${localId}`,
    image: `https://assets.tcgdex.net/en/sv/${id.slice(0, id.lastIndexOf('-'))}/${localId}`,
    category: 'Pokemon',
    rarity: 'Common',
    types: ['Fire'],
    hp: 60,
    stage: 'Basic',
    variants: { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false },
    ...over,
  };
}

export function makeSet(over: Partial<CardSet> = {}): CardSet {
  return {
    id: 'sv03',
    name: 'Obsidian Flames',
    series: 'Scarlet & Violet',
    printedTotal: 197,
    total: 230,
    releaseDate: '2023-08-11',
    updatedAt: '2023-08-11',
    ptcgoCode: 'OBF',
    images: { logo: 'https://assets.tcgdex.net/en/sv/sv03/logo.webp', symbol: 'https://assets.tcgdex.net/en/sv/sv03/symbol.png' },
    ...over,
  };
}

export function makeCard(over: Partial<PokemonCard> = {}): PokemonCard {
  const id = over.id ?? 'sv03-001';
  return {
    id,
    name: 'Charmander',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    hp: '70',
    types: ['Fire'],
    set: makeSet(),
    number: id.slice(id.lastIndexOf('-') + 1),
    rarity: 'Common',
    artist: 'Ken Sugimori',
    images: { small: `https://assets.tcgdex.net/en/sv/sv03/${id}/low.webp`, large: `https://assets.tcgdex.net/en/sv/sv03/${id}/high.webp` },
    variants: ['normal', 'reverseHolofoil'],
    detailed: true,
    tcgplayer: { url: 'https://www.tcgplayer.com/product/1', updatedAt: '2025-01-01', prices: { normal: { market: 1 }, reverseHolofoil: { market: 2 } } },
    ...over,
  };
}

export function makeSnapshot(over: Partial<CardSnapshot> = {}): CardSnapshot {
  const id = over.id ?? 'sv03-001';
  return {
    id,
    name: 'Charmander',
    number: id.slice(id.lastIndexOf('-') + 1).replace(/^0+(?=\d)/, ''),
    setId: id.slice(0, id.lastIndexOf('-')),
    setName: 'Obsidian Flames',
    series: 'Scarlet & Violet',
    releaseDate: '2023-08-11',
    printedTotal: 197,
    rarity: 'Common',
    supertype: 'Pokémon',
    types: ['Fire'],
    image: `https://assets.tcgdex.net/en/sv/sv03/${id}/low.webp`,
    imageLarge: `https://assets.tcgdex.net/en/sv/sv03/${id}/high.webp`,
    variants: ['normal', 'reverseHolofoil'],
    prices: { normal: 1, reverseHolofoil: 2 },
    syncedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeEntry(over: Partial<CollectionEntry> = {}): CollectionEntry {
  const cardId = over.cardId ?? 'sv03-001';
  const variant = over.variant ?? 'normal';
  return {
    id: `${cardId}::${variant}`,
    cardId,
    setId: cardId.slice(0, cardId.lastIndexOf('-')),
    variant,
    quantity: 1,
    condition: 'NM',
    addedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeGraded(over: Partial<GradedCopy> = {}): GradedCopy {
  const cardId = over.cardId ?? 'sv03-001';
  return {
    id: `slab-${cardId}-${over.company ?? 'PSA'}-${over.grade ?? '10'}`,
    cardId,
    setId: cardId.slice(0, cardId.lastIndexOf('-')),
    variant: 'normal',
    company: 'PSA',
    grade: '10',
    label: 'Gem Mint',
    certNumber: '81234567',
    countsTowardSet: true,
    addedAt: '2025-03-01T00:00:00.000Z',
    ...over,
  };
}

export function makeSealed(over: Partial<SealedItem> = {}): SealedItem {
  return {
    id: 'sealed-1',
    name: 'Obsidian Flames booster box',
    productType: 'booster_box',
    quantity: 1,
    status: 'sealed',
    addedAt: '2025-03-01T00:00:00.000Z',
    ...over,
  };
}
