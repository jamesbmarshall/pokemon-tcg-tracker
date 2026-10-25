import type { CardSnapshot } from '../types';
import { checkDeckLegality, normalizedCardName, type DeckCard, type DeckFormat, type LegalityOptions } from '../decks/legality';
import { computeDeckOwnership } from '../decks/ownership';
import { formatDeckText, isDeckTextMetadataLine, parseDeckText } from '../decks/ptcgl';
import { parseScanText } from '../scan';
import type { DeckIssue, DeckItem, DeckResult, GameModule, GameRulesContext, TcgCard } from './types';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');
const validQuantity = (quantity: number) => Number.isInteger(quantity) && quantity > 0 && quantity <= 1000;

export class PokemonRuleError extends Error {
  readonly code: 'invalid_rule_context' | 'invalid_deck_export';
  constructor(code: PokemonRuleError['code'], message: string) {
    super(message);
    this.name = 'PokemonRuleError';
    this.code = code;
  }
}

/** Only rule-relevant fields are read; this is not a catalogue persistence converter.
 * A complete normalized Pokémon record explicitly carries detailed=true and subtypes.
 * Partial/malformed records cannot become certified rule evidence by projection.
 */
export function pokemonRuleCard(card: TcgCard): { snapshot: CardSnapshot; complete: boolean } | undefined {
  const d = card.details;
  if (card.game !== 'pokemon' || !object(d) || d.kind !== 'pokemon' ||
    typeof d.supertype !== 'string' || !['Pokémon', 'Trainer', 'Energy'].includes(d.supertype)) return;
  if (d.subtypes !== undefined && !strings(d.subtypes) || d.types !== undefined && !strings(d.types)) return;
  if (d.regulationMark !== undefined && typeof d.regulationMark !== 'string') return;
  let legal: CardSnapshot['legal'];
  if (d.legal !== undefined) {
    if (!object(d.legal)) return;
    const { standard, expanded } = d.legal;
    if (standard !== undefined && typeof standard !== 'boolean' || expanded !== undefined && typeof expanded !== 'boolean') return;
    legal = { standard, expanded };
  }
  return {
    complete: d.detailed === true && strings(d.subtypes),
    snapshot: {
      id: card.id, name: card.name, number: card.number, setId: card.setId,
      setName: card.setName, setCode: card.setCode, series: '', releaseDate: '', printedTotal: 0,
      image: card.image, imageLarge: card.image, variants: [], prices: {}, syncedAt: card.fetchedAt,
      supertype: d.supertype, subtypes: strings(d.subtypes) ? [...d.subtypes] : undefined,
      types: strings(d.types) ? [...d.types] : undefined,
      regulationMark: typeof d.regulationMark === 'string' ? d.regulationMark : undefined, legal,
    },
  };
}

/** Unknown settings are validated, never asserted into a trusted rules configuration. */
export function pokemonRuleOptions(context?: GameRulesContext): LegalityOptions {
  const settings = context?.settings;
  if (settings === undefined) return {};
  if (!object(settings) || Object.keys(settings).some((key) => !['regulationMarks', 'bannedCardIds'].includes(key)))
    throw new PokemonRuleError('invalid_rule_context', 'Invalid Pokémon rule settings');
  const { regulationMarks, bannedCardIds } = settings;
  if (bannedCardIds !== undefined && (!strings(bannedCardIds) || bannedCardIds.length > 20000 || bannedCardIds.some((id) => !id || id.length > 180)))
    throw new PokemonRuleError('invalid_rule_context', 'Invalid Pokémon banned card IDs');
  if (regulationMarks !== undefined) {
    if (!object(regulationMarks) || Object.keys(regulationMarks).some((key) => !['standard', 'expanded'].includes(key)) ||
      !strings(regulationMarks.standard) || !strings(regulationMarks.expanded) ||
      regulationMarks.standard.length > 100 || regulationMarks.expanded.length > 100 ||
      [...regulationMarks.standard, ...regulationMarks.expanded].some((mark) => !/^[A-Z]$/.test(mark)))
      throw new PokemonRuleError('invalid_rule_context', 'Invalid Pokémon regulation marks');
    return { regulationMarks: { standard: [...regulationMarks.standard], expanded: [...regulationMarks.expanded] }, bannedCardIds: bannedCardIds === undefined ? undefined : [...bannedCardIds] };
  }
  return { bannedCardIds: bannedCardIds === undefined ? undefined : [...bannedCardIds] };
}

function selectedFormat(context?: GameRulesContext): DeckFormat {
  const format = context?.format ?? 'standard';
  if (format !== 'standard' && format !== 'expanded' && format !== 'unlimited') throw new PokemonRuleError('invalid_rule_context', 'Unsupported Pokémon deck format');
  return format;
}

export function validatePokemonDeck(items: DeckItem[], cards: Map<string, TcgCard>, format: DeckFormat, context?: GameRulesContext): DeckResult {
  const options = pokemonRuleOptions(context);
  const issues: DeckIssue[] = [];
  const known: DeckCard[] = [];
  const missing: string[] = [];
  const main = items.filter((item) => item.zone === 'main');
  for (const item of items) {
    if (!validQuantity(item.quantity)) issues.push({ code: 'quantity', message: 'Quantities must be whole numbers from 1 to 1000.', cardIds: [item.cardId] });
    if (item.zone !== 'main' && item.zone !== 'maybeboard') issues.push({ code: 'zone', message: 'Pokémon decks do not have commander or companion zones.', cardIds: [item.cardId] });
  }
  for (const item of main) {
    if (!validQuantity(item.quantity)) continue;
    const card = cards.get(item.cardId);
    const ruleCard = card && pokemonRuleCard(card);
    if (!ruleCard?.complete) missing.push(item.cardId);
    else known.push({ card: ruleCard.snapshot, qty: item.quantity });
  }
  const legacy = checkDeckLegality(known, format, options);
  for (const issue of legacy.issues) {
    // Missing cards may be Basic Pokémon and contribute to deck size. Other violations
    // established by the known subset (e.g. five copies) remain definite violations.
    if (missing.length && ['deck-size', 'basic-required'].includes(issue.code)) continue;
    issues.push({ ...issue, ...(issue.code === 'format-unknown' ? { unverified: true } : {}) });
  }
  if (missing.length) {
    const total = main.reduce((sum, item) => sum + (validQuantity(item.quantity) ? item.quantity : 0), 0);
    if (total !== 60) issues.push({ code: 'deck-size', message: `Deck has ${total} cards; it must have exactly 60.`, cardIds: main.map((item) => item.cardId) });
    issues.push({ code: 'rules-missing', message: 'Load complete Pokémon details before certifying this deck.', cardIds: missing, unverified: true });
  }
  if (context?.catalogueComplete !== true) issues.push({ code: 'catalogue-unverified', message: 'Catalogue completeness has not been verified.', cardIds: [], unverified: true });
  return { status: issues.some((issue) => !issue.unverified) ? 'illegal' : issues.length ? 'unverified' : 'legal', issues };
}

export const pokemonDeckTools: NonNullable<GameModule['deckTools']> = {
  parse(text) {
    const rows: ReturnType<NonNullable<GameModule['deckTools']>['parse']>['rows'] = [];
    const errors: string[] = [];
    if (text.length > 200000) return { rows, errors: ['Deck text exceeds 200,000 characters.'] };
    text.split(/\r?\n/).forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line.startsWith('//') || isDeckTextMetadataLine(line)) return;
      const parsed = parseDeckText(line).lines[0];
      if (!parsed || !validQuantity(parsed.qty)) { errors.push(`Line ${idx + 1}: invalid Pokémon deck row.`); return; }
      rows.push({ name: parsed.name, quantity: parsed.qty, zone: 'main', set: parsed.setCode, number: parsed.number, line: idx + 1 });
    });
    if (rows.length > 500) return { rows: [], errors: [...errors, 'Too many deck rows (maximum 500).'] };
    return { rows, errors };
  },
  format(items, cards) {
    const rows = items.map((item) => {
      if (item.zone !== 'main' || !validQuantity(item.quantity)) throw new PokemonRuleError('invalid_deck_export', 'PTCGL export requires valid main-deck rows');
      const card = cards.get(item.cardId);
      const ruleCard = card && pokemonRuleCard(card);
      if (!ruleCard) throw new PokemonRuleError('invalid_deck_export', `Missing Pokémon details for ${item.cardId}`);
      return { card: ruleCard.snapshot, qty: item.quantity };
    });
    return formatDeckText(rows);
  },
  ownership(items, cards, entries, context) {
    const format = selectedFormat(context), options = pokemonRuleOptions(context);
    const known = new Map<string, CardSnapshot>();
    const uncertainNames = new Set<string>();
    for (const card of cards.values()) {
      const ruleCard = pokemonRuleCard(card);
      if (ruleCard?.complete) known.set(card.id, ruleCard.snapshot);
      else if (card.game === 'pokemon') uncertainNames.add(normalizedCardName(card.name));
    }
    const quantities = new Map<string, number>();
    for (const entry of entries) if (known.has(entry.cardId) && Number.isSafeInteger(entry.quantity) && entry.quantity > 0)
      quantities.set(entry.cardId, (quantities.get(entry.cardId) ?? 0) + entry.quantity);
    const main = items.filter((item) => item.zone === 'main' && validQuantity(item.quantity));
    const deck = main.map((item) => {
      const card = known.get(item.cardId);
      if (card) return { card, qty: item.quantity };
      const name = cards.get(item.cardId)?.name ?? item.cardId;
      uncertainNames.add(normalizedCardName(name));
      // Placeholder only establishes the requested name/quantity, never owned evidence.
      const unknown: CardSnapshot = { id: item.cardId, name, number: '', setId: '', setName: '', series: '', releaseDate: '', printedTotal: 0, supertype: '', image: '', imageLarge: '', variants: [], prices: {}, syncedAt: '' };
      return { card: unknown, qty: item.quantity };
    });
    const result = computeDeckOwnership(deck, format, quantities, known.values(), options).map((row) => ({
      ...row, cardId: row.deckCardIds[0],
      ...(context?.catalogueComplete !== true || uncertainNames.has(row.name) ? { unverified: true } : {}),
    }));
    return result;
  },
  analyze(items, cards) {
    const categories = new Map<string, number>(), types = new Map<string, number>();
    for (const item of items) {
      if (item.zone !== 'main' || !validQuantity(item.quantity)) continue;
      const card = cards.get(item.cardId), ruleCard = card && pokemonRuleCard(card);
      const category = ruleCard?.snapshot.supertype ?? 'Unknown';
      categories.set(category, (categories.get(category) ?? 0) + item.quantity);
      for (const type of ruleCard?.snapshot.types ?? []) types.set(type, (types.get(type) ?? 0) + item.quantity);
    }
    return { categories: Object.fromEntries(categories), types: Object.fromEntries(types) };
  },
};

export const scanPokemon: GameModule['scan'] = (text) => parseScanText(text).map(({ setCode, ...candidate }) => ({ ...candidate, set: setCode }));
