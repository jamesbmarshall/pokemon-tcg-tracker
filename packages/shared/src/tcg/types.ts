/** Game-neutral collection contracts. Provider IDs and playable identities are distinct. */
import type { PokemonCard } from '../types';
import type { CollectibleVariant } from './printing';
export type { CollectibleVariant } from './printing';
export type GameId = string;
export interface TcgSet {
  fetchedAt?: string;
  stale?: boolean;
  game: GameId;
  id: string;
  providerId: string;
  code: string;
  name: string;
  releaseDate: string;
  total: number;
  type: string;
  parentId?: string;
  /** Provider-specific set metadata retained by lossless catalogue adapters. */
  details?: { kind: string; [key: string]: unknown };
}
export interface CardFace {
  name: string;
  text: string;
  typeLine: string;
  manaCost?: string;
  image?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
}
export interface Quote {
  amount: number;
  currency: 'USD' | 'EUR';
  source: string;
  at: string;
  url?: string;
}
export interface TcgCard {
  /** Cached catalogue evidence is beyond its freshness window; timestamps remain unchanged. */
  stale?: boolean;
  game: GameId;
  id: string;
  providerId: string;
  identity: string;
  name: string;
  printedName?: string;
  setId: string;
  setName: string;
  setCode: string;
  number: string;
  language: string;
  rarity: string;
  artist: string;
  image: string;
  faces: CardFace[];
  finishes: string[];
  /** Additive detailed physical variants; absent on older normalized cache records. */
  variants?: CollectibleVariant[];
  treatments: string[];
  extra: boolean;
  paper: boolean;
  prices: Record<string, Quote[]>;
  fetchedAt: string;
  details: { kind: string; [key: string]: unknown };
}
export interface MagicDetails {
  kind: 'mtg';
  rulesComplete?: boolean;
  oracleId?: string;
  colors: string[];
  colorIdentity: string[];
  manaValue: number;
  typeLine: string;
  oracleText: string;
  keywords: string[];
  layout: string;
  meldResultId?: string;
  legalities: Record<string, string>;
  producedMana: string[];
}
export type MagicCard = TcgCard & { details: MagicDetails };
/** Preserve all Pokémon-specific facts, source price blocks and catalogue metadata.
 * Common identity/display fields and physical variants live on the normalized card.
 */
export type PokemonDetails = { kind: 'pokemon' } & Omit<
  PokemonCard,
  'id' | 'name' | 'number' | 'rarity' | 'artist' | 'variants' | 'printings'
>;
export type PokemonTcgCard = TcgCard & {
  details: PokemonDetails;
  variants: CollectibleVariant[];
};
export interface SearchField {
  key: string;
  label: string;
  options?: { value: string; label: string }[];
}
export interface TcgSearch {
  q?: string;
  language?: string;
  set?: string;
  number?: string;
  page?: number;
  [key: string]: string | number | undefined;
}
export interface TcgPage {
  stale?: boolean;
  cards: TcgCard[];
  hasMore: boolean;
  total: number;
}
export interface TcgProvider {
  readonly name: string;
  readonly game: GameId;
  sets(): Promise<TcgSet[]>;
  search(query: TcgSearch): Promise<TcgPage>;
  card(id: string): Promise<TcgCard>;
  setCards(id: string, language: string): Promise<TcgCard[]>;
  resolve?(row: DeckTextRow): Promise<TcgCard[]>;
}
export interface DeckTextRow {
  name: string;
  quantity: number;
  zone: DeckZone;
  set?: string;
  number?: string;
  line: number;
}
export interface DeckOwnership {
  name: string;
  cardId: string;
  needed: number;
  owned: number;
  missing: number;
  /** Ownership cannot be fully established from the supplied catalogue/rule context. */
  unverified?: boolean;
  deckCardIds?: string[];
}
export interface Holding {
  id: string;
  cardId: string;
  finish: string;
  quantity: number;
  condition?: string;
  paid?: { amount: number; currency: 'USD' | 'GBP' | 'EUR' };
  valueUsd?: number;
  notes?: string;
  addedAt: string;
}
export interface Slab {
  id: string;
  cardId: string;
  finish: string;
  company: string;
  grade: string;
  certNumber?: string;
  countsTowardSet: boolean;
  valueUsd?: number;
  paid?: Holding['paid'];
  notes?: string;
  pcProductId?: string;
  pcPrice?: number;
  addedAt: string;
}
export interface SealedProduct {
  id: string;
  name: string;
  productType: string;
  setId?: string;
  language?: string;
  quantity: number;
  status: 'sealed' | 'opened';
  paid?: Holding['paid'];
  valueUsd?: number;
  notes?: string;
  pcProductId?: string;
  pcPrice?: number;
  addedAt: string;
}
export type DeckZone = 'main' | 'commander' | 'companion' | 'maybeboard';
export interface DeckItem {
  cardId: string;
  quantity: number;
  zone: DeckZone;
}
export interface TcgList {
  id: string;
  game: GameId;
  name: string;
  kind: 'list' | 'deck';
  description?: string;
  format?: string;
  items: DeckItem[];
  addedAt: string;
}
export interface DeckIssue {
  code: string;
  message: string;
  cardIds: string[];
  unverified?: boolean;
}
export interface DeckResult {
  status: 'legal' | 'illegal' | 'unverified';
  issues: DeckIssue[];
}
export interface Completion {
  cards: { owned: number; total: number };
  printings: { owned: number; total: number };
  finishes: { owned: number; total: number };
  complete: boolean;
}
/** A game chooses its own stable keys; callers must not assume a fixed measure list. */
export interface CompletionMeasure {
  key: string;
  label: string;
  owned: number;
  total: number;
  /** Slot completion only; catalogue coverage is reported separately. Zero slots is false. */
  complete: boolean;
}
export interface CompletionReport {
  measures: CompletionMeasure[];
  coverage: {
    complete: boolean;
    provisional?: boolean;
    unresolved?: number;
    additional?: number;
  };
}
export interface GameModule {
  id: GameId;
  name: string;
  shortName: string;
  /** Temporary controller-owned behavior; remove when shared adapters implement all advertised operations. */
  compatibility?: { reason: string };
  attribution?: string;
  searchHint?: string;
  preconCatalogue?: { name: string; url: string; description?: string };
  cardFacts?: (card: TcgCard) => { label: string; value: string }[];
  languages: { code: string; name: string }[];
  capabilities: {
    decks: boolean;
    precons?: boolean;
    scanning: boolean;
    sealed: boolean;
    graded: boolean;
  };
  searchFields: SearchField[];
  sealedTypes: string[];
  formats: {
    id: string;
    name: string;
    size?: number;
    validate: (items: DeckItem[], cards: Map<string, TcgCard>, context?: GameRulesContext) => DeckResult;
  }[];
  deckTools?: {
    parse(text: string): { rows: DeckTextRow[]; errors: string[] };
    format(items: DeckItem[], cards: Map<string, TcgCard>): string;
    ownership(
      items: DeckItem[],
      cards: Map<string, TcgCard>,
      entries: Holding[],
      context?: GameRulesContext,
    ): DeckOwnership[];
    analyze(
      items: DeckItem[],
      cards: Map<string, TcgCard>,
      context?: GameRulesContext,
    ): Record<string, Record<string, number>>;
  };
  complete: (
    cards: TcgCard[],
    holdings: Holding[],
    slabs: Slab[],
    complete: boolean,
  ) => Completion;
  completionReport?: (
    cards: TcgCard[], holdings: Holding[], slabs: Slab[], catalogueComplete: boolean,
  ) => CompletionReport;
  scan: (text: string) => GameScanCandidate[];
}
export interface GameScanCandidate {
  set?: string;
  number: string;
  total?: string;
  confidence?: number;
  raw?: string;
}
/** Game adapters validate/narrow settings at their boundary; rules never read global settings.
 * Unknown completeness must not certify legality. Settings stay source-owned and extensible.
 */
export interface GameRulesContext {
  format?: string;
  catalogueComplete?: boolean;
  settings?: unknown;
}
export interface GameState {
  game: GameId;
  revision: number;
  role: string;
  cards: TcgCard[];
  entries: Holding[];
  wishlist: string[];
  notes: { id: string; text: string }[];
  graded: Slab[];
  sealed: SealedProduct[];
  lists: TcgList[];
  history: { date: string; valueUsd: number; cards: number }[];
}
export type RecordKind =
  | 'entry'
  | 'wishlist'
  | 'note'
  | 'graded'
  | 'sealed'
  | 'list';
export interface GameRecord {
  kind: RecordKind;
  id: string;
  data: unknown;
}
