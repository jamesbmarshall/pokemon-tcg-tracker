/**
 * Static plan for the demo collection: which cards it owns, wants and has graded, and its custom
 * lists. Pure data (no database access) so it is easy to unit-test and to regenerate deterministically
 * on every reset.
 *
 * Card ids follow TCGdex's `<setId>-<localId>` scheme, including each set's zero-padding.
 * When changing the plan, check ranges and showcase ids against the full set records;
 * deterministic generation alone does not validate upstream catalogue membership.
 */

export interface SeedSet {
  /** TCGdex set id. */
  id: string;
  /** First and last local id (inclusive) to generate, restricted to each set's numbered cards. */
  start: number;
  end: number;
  /** Zero-pad local ids to this width (sv01/sv03 print 3 digits; base1/swsh1 do not pad). */
  pad?: number;
}

/** Four sets spanning Base, Sword & Shield and Scarlet & Violet, showing old and new card styles. */
export const SEED_SETS: SeedSet[] = [
  { id: 'base1', start: 1, end: 102 },
  { id: 'swsh1', start: 1, end: 202 },
  { id: 'sv01', start: 1, end: 198, pad: 3 },
  { id: 'sv03', start: 1, end: 197, pad: 3 },
];

export const seedCardId = (set: SeedSet, n: number): string => `${set.id}-${set.pad ? String(n).padStart(set.pad, '0') : n}`;

/** Every card id the demo might reference, across all seed sets, in set order. */
export function allSeedCardIds(): string[] {
  return SEED_SETS.flatMap((set) => Array.from({ length: set.end - set.start + 1 }, (_, i) => seedCardId(set, set.start + i)));
}

export interface SeedGraded {
  cardId: string;
  company: string;
  grade: string;
  label?: string;
  certNumber?: string;
}

export interface SeedList {
  name: string;
  description: string;
  cardIds: string[];
}

export interface DemoSeedPlan {
  ownedIds: string[];
  wishlistIds: string[];
  graded: SeedGraded[];
  lists: SeedList[];
}

/**
 * Builds the demo's content deterministically: every 7th card in each set is "missing" (and goes
 * on the wishlist, capped to a manageable chase list), everything else is owned. A few well-known
 * cards get a graded slab and a couple of showcase lists tie the whole thing together.
 */
export function buildSeedPlan(): DemoSeedPlan {
  const owned: string[] = [];
  const wishlist: string[] = [];
  for (const set of SEED_SETS) {
    for (let n = set.start; n <= set.end; n++) {
      const id = seedCardId(set, n);
      (n % 7 === 0 ? wishlist : owned).push(id);
    }
  }
  return {
    ownedIds: owned,
    wishlistIds: wishlist.slice(0, 24),
    graded: [
      { cardId: 'base1-4', company: 'PSA', grade: '10', label: 'Gem Mint', certNumber: '10492381' },
      { cardId: 'swsh1-1', company: 'CGC', grade: '9.5' },
      { cardId: 'sv01-015', company: 'BGS', grade: '9.5' },
      { cardId: 'sv01-013', company: 'PSA', grade: '9' },
    ],
    lists: [
      { name: 'Trade pile', description: 'Doubles up for trade', cardIds: owned.slice(0, 6) },
      { name: 'Showcase binder', description: 'The page I show people first', cardIds: ['base1-4', 'base1-2', 'swsh1-1', 'sv01-015', 'sv01-013', 'sv03-004'] },
    ],
  };
}
