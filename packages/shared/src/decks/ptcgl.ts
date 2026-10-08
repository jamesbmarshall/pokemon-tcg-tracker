/**
 * Parses and formats PTCGL / Limitless-style deck text, e.g.:
 *
 * ```
 * Pokémon: 12
 * 4 Charizard ex OBF 125
 * 3 Arven SVI 166
 *
 * Trainer: 20
 * 4 Rare Candy SVI 191
 *
 * Energy: 10
 * 10 Basic {R} Energy SVE 2
 *
 * Total Cards: 60
 * ```
 *
 * Section headers ("Pokémon: N" / "Pokemon: N" / "Trainer: N" / "Energy: N") and the trailing
 * "Total Cards: N" line are informational only and are not treated as deck lines; the parser
 * tolerates their absence, extra blank lines, "//" comments and either spelling of "Pokémon".
 *
 * Basic Energy lines often read "10 Basic {R} Energy SVE 2": the "Basic {X}" prefix is PTCGL's
 * own notation for the energy symbol and is stripped from the parsed name, since resolution goes
 * off the set code + number (and, for matching, the plain name) rather than the symbol.
 *
 * Actually resolving a line to a CardSnapshot needs the catalogue (set codes, TCGdex lookups),
 * which this isomorphic module doesn't call directly: callers (the server's
 * POST /api/decks/resolve) pass a `lookup` callback that does the real card lookup.
 */
import type { CardSnapshot } from '../types';

export type DeckSection = 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown';

export interface DeckTextLine {
  raw: string;
  qty: number;
  /** Card name as printed on the line, with any "Basic {X}" energy-symbol prefix removed. */
  name: string;
  setCode?: string;
  number?: string;
  section: DeckSection;
}

export interface ParsedDeckText {
  lines: DeckTextLine[];
  /** From a trailing "Total Cards: N" line, when present. */
  totalCards?: number;
}

const SECTION_RE = /^(Pok[ée]mon|Trainer|Energy)\s*:\s*\d+\s*$/i;
const TOTAL_RE = /^Total\s+Cards\s*:\s*(\d+)\s*$/i;
// "4 Charizard ex OBF 125" -> qty, name, set code, collector number.
const LINE_WITH_CODE_RE = /^(\d+)\s+(.+?)\s+([A-Za-z][A-Za-z0-9-]{1,7})\s+([A-Za-z0-9]{1,4})$/;
// Fallback for lines with no recognisable trailing "CODE NUMBER", e.g. a hand-typed "4 Pikachu".
const LINE_PLAIN_RE = /^(\d+)\s+(.+)$/;
// PTCGL's own notation for a basic energy's type symbol, e.g. "Basic {R} Energy" -> "Fire Energy".
const BASIC_ENERGY_RE = /^Basic\s*\{([A-Za-z])\}\s*Energy$/i;
const ENERGY_SYMBOLS: Record<string, string> = { R: 'Fire', W: 'Water', G: 'Grass', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' };

function normalizeSection(raw: string): DeckSection {
  const s = raw.toLowerCase();
  if (s.startsWith('pok')) return 'Pokémon';
  if (s === 'trainer') return 'Trainer';
  if (s === 'energy') return 'Energy';
  return 'Unknown';
}

function normalizeName(name: string): string {
  const m = BASIC_ENERGY_RE.exec(name.trim());
  if (m) {
    const type = ENERGY_SYMBOLS[m[1].toUpperCase()];
    if (type) return `${type} Energy`;
  }
  return name.trim();
}

/** Parses deck text into its lines, tolerant of PTCGL and Limitless export variants. */
export function parseDeckText(text: string): ParsedDeckText {
  const lines: DeckTextLine[] = [];
  let section: DeckSection = 'Unknown';
  let totalCards: number | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      section = normalizeSection(sectionMatch[1]);
      continue;
    }
    const totalMatch = TOTAL_RE.exec(line);
    if (totalMatch) {
      totalCards = Number(totalMatch[1]);
      continue;
    }

    const withCode = LINE_WITH_CODE_RE.exec(line);
    if (withCode) {
      lines.push({ raw: line, qty: Number(withCode[1]), name: normalizeName(withCode[2]), setCode: withCode[3].toUpperCase(), number: withCode[4], section });
      continue;
    }
    const plain = LINE_PLAIN_RE.exec(line);
    if (plain) {
      lines.push({ raw: line, qty: Number(plain[1]), name: normalizeName(plain[2]), section });
    }
  }

  return { lines, totalCards };
}

export interface ResolvedDeckLine extends DeckTextLine {
  card: CardSnapshot;
}

export interface ResolveDeckResult {
  resolved: ResolvedDeckLine[];
  unresolved: DeckTextLine[];
}

/**
 * Resolves parsed lines to real cards via a caller-supplied lookup (the server uses set codes +
 * collector numbers against the catalogue, the same way the camera-scan lookup does). Lines the
 * lookup can't match are returned unresolved rather than dropped, so the import dialog can show
 * them for manual fixing.
 */
export async function resolveDeckLines(lines: DeckTextLine[], lookup: (line: DeckTextLine) => Promise<CardSnapshot | undefined>): Promise<ResolveDeckResult> {
  const resolved: ResolvedDeckLine[] = [];
  const unresolved: DeckTextLine[] = [];
  for (const line of lines) {
    const card = await lookup(line);
    if (card) resolved.push({ ...line, card });
    else unresolved.push(line);
  }
  return { resolved, unresolved };
}

const SECTION_ORDER: DeckSection[] = ['Pokémon', 'Trainer', 'Energy'];

/** Which section a resolved card belongs to, for grouping and for export. */
export function sectionFor(card: Pick<CardSnapshot, 'supertype'>): DeckSection {
  if (card.supertype === 'Pokémon') return 'Pokémon';
  if (card.supertype === 'Trainer') return 'Trainer';
  if (card.supertype === 'Energy') return 'Energy';
  return 'Unknown';
}

/**
 * Formats a deck (card + quantity per printing) back into PTCGL/Limitless text, grouped into
 * the three sections with counts, and a trailing "Total Cards: N" line.
 */
export function formatDeckText(cards: { card: CardSnapshot; qty: number }[]): string {
  const bySection = new Map<DeckSection, { card: CardSnapshot; qty: number }[]>();
  for (const dc of cards) {
    const section = sectionFor(dc.card);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(dc);
  }
  const total = cards.reduce((sum, c) => sum + c.qty, 0);
  const blocks: string[] = [];
  for (const section of SECTION_ORDER) {
    const group = bySection.get(section);
    if (!group?.length) continue;
    const count = group.reduce((sum, c) => sum + c.qty, 0);
    const body = group.map((c) => `${c.qty} ${c.card.name}${c.card.setCode ? ` ${c.card.setCode} ${c.card.number}` : ''}`).join('\n');
    blocks.push(`${section}: ${count}\n${body}`);
  }
  blocks.push(`Total Cards: ${total}`);
  return blocks.join('\n\n');
}
