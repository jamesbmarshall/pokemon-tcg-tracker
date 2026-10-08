import { describe, expect, it } from 'vitest';
import { checkDeckLegality, DEFAULT_REGULATION_MARKS, type DeckCard } from './legality';
import type { CardSnapshot } from '../types';

function card(overrides: Partial<CardSnapshot> & { id: string; name: string }): CardSnapshot {
  return {
    number: '1',
    setId: 'sv01',
    setName: 'Scarlet & Violet',
    series: 'Scarlet & Violet',
    releaseDate: '2023-03-31',
    printedTotal: 198,
    supertype: 'Pokémon',
    image: '',
    imageLarge: '',
    variants: ['normal'],
    prices: {},
    syncedAt: '2024-01-01T00:00:00.000Z',
    regulationMark: 'H',
    legal: { standard: true, expanded: true },
    ...overrides,
  };
}

/** A legal 60-card skeleton: 1 Basic Pokémon x4, 15 other Pokémon (singles), 41 Trainers, nothing else. */
function baseDeck(): DeckCard[] {
  const cards: DeckCard[] = [{ card: card({ id: 'basic-1', name: 'Charmander', subtypes: ['Basic'] }), qty: 4 }];
  for (let i = 0; i < 15; i++) cards.push({ card: card({ id: `mon-${i}`, name: `Pokemon ${i}`, subtypes: ['Stage 1'] }), qty: 1 });
  for (let i = 0; i < 41; i++) cards.push({ card: card({ id: `trainer-${i}`, name: `Trainer ${i}`, supertype: 'Trainer' }), qty: 1 });
  return cards;
}

describe('checkDeckLegality', () => {
  it('passes a legal 60-card deck with a Basic Pokémon and no excess copies', () => {
    const result = checkDeckLegality(baseDeck(), 'standard');
    expect(result.legal).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a deck that is not exactly 60 cards', () => {
    const deck = baseDeck().slice(0, -1);
    const result = checkDeckLegality(deck, 'standard');
    expect(result.legal).toBe(false);
    expect(result.issues.some((i) => i.code === 'deck-size')).toBe(true);
  });

  it('flags more than 4 copies of the same name, counted across printings', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'p1', name: 'Arven', setId: 'sv01' }), qty: 3 };
    deck[2] = { card: card({ id: 'p2', name: 'Arven', setId: 'sv02' }), qty: 2 };
    const result = checkDeckLegality(deck, 'standard');
    const issue = result.issues.find((i) => i.code === 'copy-limit');
    expect(issue).toBeDefined();
    expect(issue!.cardIds.sort()).toEqual(['p1', 'p2']);
  });

  it('exempts basic Energy from the 4-copy limit', () => {
    const deck = baseDeck().slice(0, -5);
    for (let i = 0; i < 5; i++) deck.push({ card: card({ id: `energy-${i}`, name: 'Fire Energy', supertype: 'Energy', subtypes: ['Basic'] }), qty: 1 });
    const result = checkDeckLegality(deck, 'standard');
    expect(result.issues.some((i) => i.code === 'copy-limit')).toBe(false);
  });

  it('requires at least one Basic Pokémon', () => {
    const deck = baseDeck();
    deck[0] = { card: card({ id: 'basic-1', name: 'Charmander', subtypes: ['Stage 1'] }), qty: 4 };
    const result = checkDeckLegality(deck, 'standard');
    expect(result.issues.some((i) => i.code === 'basic-required')).toBe(true);
  });

  it('allows at most 1 ACE SPEC card', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'ace-1', name: 'Neo Upper Energy', supertype: 'Trainer', subtypes: ['ACE SPEC'] }), qty: 1 };
    deck[2] = { card: card({ id: 'ace-2', name: 'Prime Catcher', supertype: 'Trainer', subtypes: ['ACE SPEC'] }), qty: 1 };
    const result = checkDeckLegality(deck, 'standard');
    const issue = result.issues.find((i) => i.code === 'ace-spec-limit');
    expect(issue).toBeDefined();
    expect(issue!.cardIds.sort()).toEqual(['ace-1', 'ace-2']);
  });

  it('allows at most 1 Radiant Pokémon', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'rad-1', name: 'Radiant Charizard', subtypes: ['Radiant'] }), qty: 1 };
    deck[2] = { card: card({ id: 'rad-2', name: 'Radiant Greninja', subtypes: ['Radiant'] }), qty: 1 };
    const result = checkDeckLegality(deck, 'standard');
    const issue = result.issues.find((i) => i.code === 'radiant-limit');
    expect(issue).toBeDefined();
    expect(issue!.cardIds.sort()).toEqual(['rad-1', 'rad-2']);
  });

  it('flags a card that TCGdex marks illegal for the format', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'illegal-1', name: 'Old Card', legal: { standard: false, expanded: true } }), qty: 1 };
    const result = checkDeckLegality(deck, 'standard');
    const issue = result.issues.find((i) => i.code === 'format-illegal');
    expect(issue?.cardIds).toEqual(['illegal-1']);
    // Same card is fine in Expanded.
    expect(checkDeckLegality(deck, 'expanded').issues.some((i) => i.code === 'format-illegal')).toBe(false);
  });

  it('falls back to regulation mark when TCGdex has no legal flag', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'mark-g', name: 'Old Card', legal: undefined, regulationMark: 'G' }), qty: 1 };
    const result = checkDeckLegality(deck, 'standard');
    expect(result.issues.some((i) => i.code === 'format-illegal' && i.cardIds.includes('mark-g'))).toBe(true);
  });

  it('respects a custom regulation-mark allow-list', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'mark-g', name: 'Old Card', legal: undefined, regulationMark: 'G' }), qty: 1 };
    const result = checkDeckLegality(deck, 'standard', { regulationMarks: { ...DEFAULT_REGULATION_MARKS, standard: ['G', 'H', 'I'] } });
    expect(result.issues.some((i) => i.code === 'format-illegal')).toBe(false);
  });

  it('flags a banned card in Expanded only', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'banned-1', name: 'Banned Card' }), qty: 1 };
    const expanded = checkDeckLegality(deck, 'expanded', { bannedCardIds: ['banned-1'] });
    expect(expanded.issues.some((i) => i.code === 'banned')).toBe(true);
    const standard = checkDeckLegality(deck, 'standard', { bannedCardIds: ['banned-1'] });
    expect(standard.issues.some((i) => i.code === 'banned')).toBe(false);
  });

  it('skips format legality checks entirely for Unlimited', () => {
    const deck = baseDeck();
    deck[1] = { card: card({ id: 'mark-g', name: 'Old Card', legal: undefined, regulationMark: 'G' }), qty: 1 };
    const result = checkDeckLegality(deck, 'unlimited');
    expect(result.issues.some((i) => i.code === 'format-illegal')).toBe(false);
  });
});
