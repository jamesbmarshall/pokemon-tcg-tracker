/**
 * Deck legality checks for the standard 60-card Pokémon TCG deck construction rules, plus
 * per-format (Standard / Expanded / Unlimited) legality.
 *
 * Format legality prefers TCGdex's own `legal.standard` / `legal.expanded` flags on each card
 * (CardSnapshot.legal), since TCGdex maintains those directly from the rotation announcements.
 * When a card has no opinion recorded (legal is absent, or the specific flag is undefined) this
 * falls back to the card's regulation mark against an admin-editable allow-list (settings key
 * `deck_regulation_marks`), and Expanded also checks an admin-editable ban list (`deck_banned_cards`).
 *
 * Standard rotation default (as of October 2026): regulation marks H, I, J. The April 2026
 * rotation (effective on Pokémon TCG Live from 26 March 2026, and at in-person events from
 * 10 April 2026) removed mark G, leaving H/I/J legal — see
 * https://www.pokemon.com/us/news/2026-pokemon-tcg-standard-format-rotation-announcement
 * This default is a judgement call for the fallback path only; the admin settings page lets an
 * instance owner correct it the moment a new rotation or banning is announced, and most cards
 * never hit the fallback because TCGdex's `legal` flags already cover them.
 *
 * Expanded has no regulation-mark floor (it spans Black & White onward); the default allow-list
 * below is deliberately wide. Expanded's ban list defaults to empty: keeping up with every
 * banned card by hand would be a maintenance burden and a stale list is worse than none, so an
 * instance owner who plays Expanded is expected to fill it in via the admin page.
 */
import type { CardSnapshot } from '../types';

export type DeckFormat = 'standard' | 'expanded' | 'unlimited';

export interface DeckCard {
  card: CardSnapshot;
  qty: number;
}

export interface LegalityIssue {
  /** Stable machine-readable code, for tests and for the UI to pick an icon/tone. */
  code: 'deck-size' | 'copy-limit' | 'basic-required' | 'ace-spec-limit' | 'radiant-limit' | 'format-illegal' | 'banned';
  message: string;
  cardIds: string[];
}

export interface LegalityResult {
  legal: boolean;
  issues: LegalityIssue[];
}

export interface RegulationMarkSettings {
  standard: string[];
  expanded: string[];
}

/** See the module comment for how these were chosen and when to revisit them. */
export const DEFAULT_REGULATION_MARKS: RegulationMarkSettings = {
  standard: ['H', 'I', 'J'],
  expanded: ['D', 'E', 'F', 'G', 'H', 'I', 'J'],
};

export const DEFAULT_BANNED_CARDS: string[] = [];

export interface LegalityOptions {
  regulationMarks?: RegulationMarkSettings;
  /** Card ids banned in Expanded (or whichever format the caller is checking). Printing-specific. */
  bannedCardIds?: string[];
}

const DECK_SIZE = 60;
const MAX_COPIES = 4;

/**
 * Official rules key a copy-limit group off the card's printed name exactly as it appears, so
 * "Charizard" and "Charizard ex" are different names (and so independently limited), while the
 * same name printed in two different sets/artworks counts together. The only normalisation
 * needed is trimming incidental whitespace differences between snapshots.
 */
export function normalizedCardName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

const isBasicEnergy = (card: CardSnapshot) => card.supertype === 'Energy' && (card.subtypes?.includes('Basic') ?? false);
const isBasicPokemon = (card: CardSnapshot) => card.supertype === 'Pokémon' && (card.subtypes?.includes('Basic') ?? false);
const isAceSpec = (card: CardSnapshot) => card.subtypes?.includes('ACE SPEC') ?? false;
const isRadiant = (card: CardSnapshot) => card.subtypes?.includes('Radiant') ?? false;

/** True when a card is allowed by format flags/regulation-mark fallback; undefined means "unknown". */
function formatAllows(card: CardSnapshot, format: Exclude<DeckFormat, 'unlimited'>, marks: RegulationMarkSettings): boolean | undefined {
  const flag = format === 'standard' ? card.legal?.standard : card.legal?.expanded;
  if (flag !== undefined) return flag;
  if (!card.regulationMark) return undefined;
  return marks[format].includes(card.regulationMark);
}

/**
 * Checks a decklist (card snapshot + quantity per distinct card id) against the standard 60-card
 * construction rules and the chosen format's legality. Quantities are per printing (card id), but
 * the 4-copy limit is summed across every printing sharing a name, as the real rules require.
 */
export function checkDeckLegality(cards: DeckCard[], format: DeckFormat, opts: LegalityOptions = {}): LegalityResult {
  const marks = opts.regulationMarks ?? DEFAULT_REGULATION_MARKS;
  const banned = new Set(opts.bannedCardIds ?? DEFAULT_BANNED_CARDS);
  const issues: LegalityIssue[] = [];
  const total = cards.reduce((sum, c) => sum + c.qty, 0);

  if (total !== DECK_SIZE) {
    issues.push({
      code: 'deck-size',
      message: `Deck has ${total} card${total === 1 ? '' : 's'}; it must have exactly ${DECK_SIZE}.`,
      cardIds: cards.map((c) => c.card.id),
    });
  }

  // Copy limit: group by normalised name, basic Energy exempted.
  const byName = new Map<string, DeckCard[]>();
  for (const dc of cards) {
    if (isBasicEnergy(dc.card)) continue;
    const key = normalizedCardName(dc.card.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(dc);
  }
  for (const [name, group] of byName) {
    const qty = group.reduce((sum, c) => sum + c.qty, 0);
    if (qty > MAX_COPIES) {
      issues.push({
        code: 'copy-limit',
        message: `${name}: ${qty} copies, more than the ${MAX_COPIES}-copy limit.`,
        cardIds: group.map((c) => c.card.id),
      });
    }
  }

  if (!cards.some((c) => isBasicPokemon(c.card) && c.qty > 0)) {
    issues.push({ code: 'basic-required', message: 'Deck needs at least one Basic Pokémon.', cardIds: [] });
  }

  const aceSpecs = cards.filter((c) => isAceSpec(c.card));
  const aceSpecCount = aceSpecs.reduce((sum, c) => sum + c.qty, 0);
  if (aceSpecCount > 1) {
    issues.push({ code: 'ace-spec-limit', message: `Deck has ${aceSpecCount} ACE SPEC cards; only 1 is allowed.`, cardIds: aceSpecs.map((c) => c.card.id) });
  }

  const radiants = cards.filter((c) => isRadiant(c.card));
  const radiantCount = radiants.reduce((sum, c) => sum + c.qty, 0);
  if (radiantCount > 1) {
    issues.push({ code: 'radiant-limit', message: `Deck has ${radiantCount} Radiant Pokémon; only 1 is allowed.`, cardIds: radiants.map((c) => c.card.id) });
  }

  if (format !== 'unlimited') {
    const illegal = cards.filter((c) => formatAllows(c.card, format, marks) === false);
    if (illegal.length) {
      issues.push({
        code: 'format-illegal',
        message: `${illegal.length} card${illegal.length === 1 ? ' is' : 's are'} not legal in ${format === 'standard' ? 'Standard' : 'Expanded'}.`,
        cardIds: illegal.map((c) => c.card.id),
      });
    }
  }

  if (format === 'expanded') {
    const bannedCards = cards.filter((c) => banned.has(c.card.id));
    if (bannedCards.length) {
      issues.push({ code: 'banned', message: `${bannedCards.length} card${bannedCards.length === 1 ? ' is' : 's are'} banned in Expanded.`, cardIds: bannedCards.map((c) => c.card.id) });
    }
  }

  return { legal: issues.length === 0, issues };
}
