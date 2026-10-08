/**
 * Domain types shared by the server and the web app. The card and set shapes follow the old
 * pokemontcg.io field names, which the UI was built on; catalog.ts maps TCGdex responses onto them.
 */
export type PriceBlock = { low?: number; mid?: number; high?: number; market?: number; directLow?: number };

export interface PokemonCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  rules?: string[];
  /** Per-format legality as reported by TCGdex (its `legal` object); absent when TCGdex has no opinion. */
  legal?: { standard?: boolean; expanded?: boolean };
  abilities?: Ability[];
  attacks?: Attack[];
  weaknesses?: Weakness[];
  resistances?: Resistance[];
  retreatCost?: string[];
  set: CardSet;
  number: string;
  rarity?: string;
  artist?: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  regulationMark?: string;
  images: CardImages;
  /** Collectible printings, e.g. normal / reverseHolofoil / holofoil / 1stEditionHolofoil */
  variants: string[];
  /** Whether attacks, text and prices were loaded (search and set listings return lighter cards) */
  detailed?: boolean;
  /** TCGplayer prices per variant, USD */
  tcgplayer?: PriceSource;
  /** Cardmarket prices per variant, EUR */
  cardmarket?: PriceSource;
}

export interface PriceSource {
  url: string;
  updatedAt: string;
  prices: Record<string, PriceBlock>;
}

export interface Ability {
  name: string;
  text: string;
  type: string;
}

export interface Attack {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
}

export interface Weakness {
  type: string;
  value: string;
}

export type Resistance = Weakness;

export interface CardImages {
  small: string;
  large: string;
}

export interface CardSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  updatedAt: string;
  ptcgoCode?: string;
  images: {
    symbol: string;
    logo: string;
  };
}

export interface ApiResponse<T> {
  data: T;
  page: number;
  pageSize: number;
  totalCount: number;
}

/** An amount the owner paid, kept in the currency they entered so it never drifts with FX. */
export interface Paid {
  amount: number;
  currency: 'USD' | 'GBP' | 'EUR';
}

/** Raw (ungraded) copies of one printing of a card. Graded copies are tracked as GradedCopy. */
export interface CollectionEntry {
  id: string; // `${cardId}::${variant}`
  cardId: string;
  setId: string;
  variant: string;
  quantity: number;
  condition?: Condition;
  notes?: string;
  /** Price paid per copy (an average if copies cost different amounts) */
  paid?: Paid;
  addedAt: string;
  updatedAt?: string;
}

export type Condition = 'M' | 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

/**
 * Lightweight, source-agnostic copy of a card kept locally so the collection,
 * binder and value calculations work offline and without one request per card.
 */
export interface CardSnapshot {
  id: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  series: string;
  releaseDate: string;
  printedTotal: number;
  /** Printed/PTCGO set code, e.g. 'OBF', 'SVE'. Used for PTCGL/Limitless deck text export. */
  setCode?: string;
  rarity?: string;
  supertype: string;
  /** Stage / suffix / trainerType / energyType, e.g. 'Radiant', 'ACE SPEC', 'Basic', 'Item'. */
  subtypes?: string[];
  types?: string[];
  artist?: string;
  image: string;
  imageLarge: string;
  variants: string[];
  /** Market price per variant, USD */
  prices: Record<string, number>;
  tcgplayerUrl?: string;
  cardmarketUrl?: string;
  /** Regulation mark printed in the bottom corner, e.g. 'G', 'H'. Used as a format-legality fallback. */
  regulationMark?: string;
  /** Per-format legality as reported by TCGdex; absent when TCGdex has no opinion (falls back to regulationMark). */
  legal?: { standard?: boolean; expanded?: boolean };
  syncedAt: string;
}

/** A free-text note about a card, independent of variants or copies owned. */
export interface CardNote {
  cardId: string;
  text: string;
  updatedAt: string;
}

export interface WishlistEntry {
  cardId: string;
  addedAt: string;
}

export interface ValuePoint {
  date: string; // YYYY-MM-DD
  valueUsd: number;
  cards: number;
  unique: number;
  /** Cost basis (USD) of copies with a recorded purchase price, and their market value that day */
  costUsd?: number;
  costedValueUsd?: number;
}

export interface SetStat {
  setId: string;
  /** Total collectible variant slots across every card in the set */
  masterTotal: number;
  syncedAt: string;
}

export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'TAG' | 'ACE' | 'Other';

export interface Subgrades {
  centering?: number;
  corners?: number;
  edges?: number;
  surface?: number;
}

/** A single slabbed copy of a card. Tracked separately from raw copies. */
export interface GradedCopy {
  id: string;
  cardId: string;
  setId: string;
  variant: string;
  company: GradingCompany;
  /** Name of the grader when company is 'Other' */
  companyName?: string;
  /** '10', '9.5', 'Authentic' … */
  grade: string;
  /** Label text on the slab, e.g. 'Gem Mint', 'Pristine', 'Black Label' */
  label?: string;
  certNumber?: string;
  subgrades?: Subgrades;
  /** Whether this slab fills the card's slot for set / master-set progress */
  countsTowardSet: boolean;
  /** Owner's valuation in USD; falls back to the raw market price */
  valueUsd?: number;
  /** Total paid for the slab, including any grading fees */
  paid?: Paid;
  notes?: string;
  addedAt: string;
  updatedAt?: string;
}

/**
 * Photo of a slab, from the IndexedDB era. Photos now live on the server (see PhotoRef in the web
 * app); the type remains for its `side` union and the store's undo signature.
 */
export interface GradedPhoto {
  id: string;
  gradedId: string;
  side: 'front' | 'back' | 'other';
  blob: Blob;
  addedAt: string;
}
