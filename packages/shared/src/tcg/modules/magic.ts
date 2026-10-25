import type { GameModule } from '../types';
import { catalogCompletion } from '../collection';
import { catalogCompletionReport } from '../completion';
import { parseMagicDeck, formatMagicDeck } from '../deckText';
import { checkCommander, deckOwnership, deckAnalysis } from '../commander';

export const magicModule: GameModule = {
  id: 'mtg',
  name: 'Magic: The Gathering',
  shortName: 'Magic',
  attribution:
    'Card data, images and prices from Scryfall (TCGplayer & Cardmarket). Magic: The Gathering © Wizards of the Coast.',
  searchHint: 'Card name or Scryfall query',
  preconCatalogue: {
    name: 'MTGJSON',
    url: 'https://mtgjson.com/',
    description: 'Paper Commander preconstructed decks',
  },
  cardFacts: (card) => [
    { label: 'Mana value', value: String(card.details.manaValue ?? '') },
    {
      label: 'Color identity',
      value:
        ((card.details.colorIdentity as string[]) ?? []).join(', ') ||
        'Colorless',
    },
    {
      label: 'Commander',
      value: String(
        (card.details.legalities as Record<string, string> | undefined)
          ?.commander ?? 'Unverified',
      ),
    },
  ],
  languages: [
    ['en', 'English'],
    ['es', 'Spanish'],
    ['fr', 'French'],
    ['de', 'German'],
    ['it', 'Italian'],
    ['pt', 'Portuguese'],
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
    ['ru', 'Russian'],
    ['zhs', 'Chinese (Simplified)'],
    ['zht', 'Chinese (Traditional)'],
    ['he', 'Hebrew'],
    ['la', 'Latin'],
    ['grc', 'Ancient Greek'],
    ['ar', 'Arabic'],
    ['sa', 'Sanskrit'],
    ['ph', 'Phyrexian'],
    ['qya', 'Quenya'],
  ].map(([code, name]) => ({ code, name })),
  capabilities: {
    decks: true,
    precons: true,
    scanning: true,
    sealed: true,
    graded: true,
  },
  searchFields: [
    { key: 'text', label: 'Rules text' },
    { key: 'type', label: 'Card type' },
    { key: 'color', label: 'Colors (WUBRG)' },
    { key: 'identity', label: 'Color identity (WUBRG)' },
    { key: 'mv', label: 'Mana value' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'artist', label: 'Artist' },
    {
      key: 'finish',
      label: 'Finish',
      options: ['nonfoil', 'foil', 'etched'].map((value) => ({
        value,
        label: value,
      })),
    },
    {
      key: 'legal',
      label: 'Commander legality',
      options: [{ value: 'commander', label: 'Legal in Commander' }],
    },
  ],
  sealedTypes: [
    'play_booster_box',
    'draft_booster_box',
    'set_booster_box',
    'collector_booster_box',
    'booster_pack',
    'bundle',
    'commander_precon',
    'other',
  ],
  formats: [
    { id: 'commander', size: 100, name: 'Commander', validate: checkCommander },
  ],
  deckTools: {
    parse: parseMagicDeck,
    format: formatMagicDeck,
    ownership: deckOwnership,
    analyze: deckAnalysis,
  },
  complete: catalogCompletion,
  completionReport: catalogCompletionReport,
  scan: (text) => {
    const rows: { set?: string; number: string }[] = [];
    for (const line of text.toUpperCase().split(/\n/)) {
      // Modern cards place rarity/collector number and set/language on adjacent lines.
      const match =
        /\b([A-Z0-9]{2,6})\s*[•·]?\s+(?:EN|FR|DE|IT|ES|PT|JA|JP|KO|RU|ZHS|ZHT)\b/.exec(
          line,
        );
      if (match) {
        const number = /\b(?:[CURMLT]\s+)?(\d{1,5}[A-Z]?)\b/.exec(
          text.toUpperCase(),
        );
        if (number)
          rows.push({
            set: match[1].toLowerCase(),
            number: number[1].replace(/^0+(?=\d)/, ''),
          });
      }
    }
    const plain = /\b([A-Z0-9]{2,6})\s+(\d{1,5}[A-Z]?)\b/g;
    for (const m of text.toUpperCase().matchAll(plain))
      if (/[A-Z]/.test(m[1]))
        rows.push({ set: m[1].toLowerCase(), number: m[2] });
    return rows;
  },
};
