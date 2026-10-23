import type { DeckItem, TcgCard } from './types';

/** Catalogue templates are distinct from a user's saved decks and physical holdings. */
export interface PreconSummary {
  id: string;
  game: string;
  name: string;
  setCode: string;
  releaseDate: string;
  format: string;
  sourceUrl?: string;
}
export interface PreconCard {
  name: string;
  quantity: number;
  zone: 'main' | 'commander';
  finish: string;
  setCode: string;
  number: string;
  providerId: string;
  cardId?: string;
  image?: string;
}
export interface PreconDetail extends PreconSummary {
  cards: PreconCard[];
  total: number;
  attribution: string;
  catalogueUrl: string;
  stale?: boolean;
}
export interface ResolvedPrecon {
  cards: TcgCard[];
  items: DeckItem[];
  unresolved: PreconCard[];
}
