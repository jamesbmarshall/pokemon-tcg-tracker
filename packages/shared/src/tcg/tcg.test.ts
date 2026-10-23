import { describe, expect, it } from 'vitest';
import { fromScryfall, scryfallQuery, type ScryfallCard } from './scryfall';
import { checkCommander, deckOwnership, deckAnalysis } from './commander';
import { catalogCompletion, cardValue } from './collection';
import { games, createGameRegistry, magicModule } from './registry';
import { parseMagicDeck, formatMagicDeck } from './deckText';
import type { TcgCard, DeckItem, Holding } from './types';
const raw = (id: string, patch: Partial<ScryfallCard> = {}): ScryfallCard => ({
  id,
  oracle_id: id,
  name: id,
  lang: 'en',
  set: 'tst',
  set_name: 'Test',
  collector_number: '1',
  games: ['paper'],
  finishes: ['nonfoil', 'foil'],
  legalities: { commander: 'legal' },
  colors: ['G'],
  color_identity: ['G'],
  type_line: 'Creature — Elf',
  cmc: 2,
  keywords: [],
  ...patch,
});
const card = (id: string, patch: Partial<ScryfallCard> = {}) =>
  fromScryfall(raw(id, patch), '2026-10-23T00:00:00Z');
const commander = card('leader', {
  type_line: 'Legendary Creature — Elf',
  name: 'Leader',
});
const forest = card('forest', {
  name: 'Forest',
  type_line: 'Basic Land — Forest',
  colors: [],
  cmc: 0,
});
const base: DeckItem[] = [
  { cardId: commander.id, quantity: 1, zone: 'commander' },
  { cardId: forest.id, quantity: 99, zone: 'main' },
];
const map = (...cards: TcgCard[]) => new Map(cards.map((c) => [c.id, c]));
describe('extensible game contracts', () => {
  it('registers a third game without changing collecting logic and rejects duplicates', () => {
    const third = {
      ...magicModule,
      id: 'example',
      name: 'Example',
      capabilities: {
        decks: false,
        scanning: false,
        sealed: false,
        graded: false,
      },
      formats: [],
      searchFields: [],
    };
    const registry = createGameRegistry([...games.all(), third]);
    expect(registry.require('example').complete).toBe(catalogCompletion);
    expect(registry.require('example').capabilities.decks).toBe(false);
    expect(() => createGameRegistry([third, third])).toThrow('duplicate');
  });
  it('preserves language-specific identity, faces and finishes without inventing prices', () => {
    const c = card('face', {
      lang: 'ja',
      oracle_id: 'shared',
      layout: 'transform',
      image_uris: undefined,
      card_faces: [
        {
          name: 'Front',
          oracle_text: 'A',
          image_uris: { normal: 'https://cards.scryfall.io/front.jpg' },
        },
        {
          name: 'Back',
          oracle_text: 'B',
          image_uris: { normal: 'https://cards.scryfall.io/back.jpg' },
        },
      ],
      finishes: ['foil'],
      prices: { usd: '3', usd_foil: '4', eur_foil: null },
    });
    expect(c.id).toBe('mtg:face');
    expect(c.identity).toBe('mtg:shared');
    expect(c.language).toBe('ja');
    expect(c.faces).toHaveLength(2);
    expect(c.image).toContain('front');
    expect(Object.keys(c.prices)).toEqual(['foil']);
    expect(cardValue(c, 'foil')).toBe(4);
    expect(cardValue(c, 'etched')).toBeUndefined();
  });
  it('counts identities, printings, finishes and graded completion separately', () => {
    const a = card('a', { oracle_id: 'same' }),
      b = card('b', { oracle_id: 'same' });
    const entries: Holding[] = [
      { id: 'a', cardId: a.id, finish: 'nonfoil', quantity: 1, addedAt: '' },
    ];
    const result = catalogCompletion(
      [a, b],
      entries,
      [
        {
          id: 'g',
          cardId: b.id,
          finish: 'foil',
          company: 'PSA',
          grade: '10',
          countsTowardSet: true,
          addedAt: '',
        },
      ],
      false,
    );
    expect(result).toEqual({
      cards: { owned: 1, total: 1 },
      printings: { owned: 2, total: 2 },
      finishes: { owned: 2, total: 4 },
      complete: false,
    });
  });
  it('escapes structured search fields but retains free-text Scryfall syntax', () => {
    const q = scryfallQuery({
      set: 'abc" OR game:arena',
      q: 't:elf',
      language: 'ja',
    });
    expect(q).toContain('game:paper');
    expect(q).toContain('(t:elf)');
    expect(q).toContain('set:"abc OR game:arena"');
  });
});
describe('Commander rules', () => {
  it('accepts a commander and 99 basic lands, ignoring maybeboard', () =>
    expect(
      checkCommander(
        [...base, { cardId: 'unknown', quantity: 5, zone: 'maybeboard' }],
        map(commander, forest),
      ).status,
    ).toBe('legal'));
  it.each([99, 101])('rejects a %i-card deck', (n) =>
    expect(
      checkCommander(
        [{ ...base[0] }, { ...base[1], quantity: n - 1 }],
        map(commander, forest),
      ).issues.some((i) => i.code === 'deck-size'),
    ).toBe(true),
  );
  it('combines singleton counts across language and printing', () => {
    const a = card('a', { oracle_id: 'same' }),
      b = card('b', { oracle_id: 'same', lang: 'fr' });
    const result = checkCommander(
      [
        { ...base[0] },
        { ...base[1], quantity: 97 },
        { cardId: a.id, quantity: 1, zone: 'main' },
        { cardId: b.id, quantity: 1, zone: 'main' },
      ],
      map(commander, forest, a, b),
    );
    expect(result.issues.some((i) => i.code === 'copy-limit')).toBe(true);
  });
  it('respects card text copy exceptions', () => {
    const a = card('rat', {
      oracle_text: 'A deck can have any number of cards named Rat.',
    });
    expect(
      checkCommander(
        [base[0], { cardId: a.id, quantity: 99, zone: 'main' }],
        map(commander, a),
      ).status,
    ).toBe('legal');
  });
  it('uses color identity rather than mana color and rejects bans', () => {
    const blue = card('blue', {
      colors: [],
      color_identity: ['U'],
      legalities: { commander: 'banned' },
    });
    const result = checkCommander(
      [
        base[0],
        { ...base[1], quantity: 98 },
        { cardId: blue.id, quantity: 1, zone: 'main' },
      ],
      map(commander, forest, blue),
    );
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['color-identity', 'format-illegal']),
    );
  });
  it('never treats missing legality metadata as legal', () => {
    const c = card('leader', {
      type_line: 'Legendary Creature',
      legalities: {},
    });
    expect(checkCommander(base, map(c, forest)).status).toBe('unverified');
  });
  it('supports partners and rejects arbitrary pairings', () => {
    const a = card('a', {
        type_line: 'Legendary Creature',
        keywords: ['Partner'],
      }),
      b = card('b', { type_line: 'Legendary Creature', keywords: ['Partner'] });
    const items: DeckItem[] = [
      { cardId: a.id, quantity: 1, zone: 'commander' },
      { cardId: b.id, quantity: 1, zone: 'commander' },
      { ...base[1], quantity: 98 },
    ];
    expect(checkCommander(items, map(a, b, forest)).status).toBe('legal');
    expect(
      checkCommander(
        items,
        map(a, card('b', { type_line: 'Legendary Creature' }), forest),
      ).issues.some((i) => i.code === 'commander-pair'),
    ).toBe(true);
  });
  it('counts raw reprints for ownership and ignores a maybeboard requirement', () => {
    const other = card('other', { oracle_id: 'forest', lang: 'ja' });
    const out = deckOwnership(
      [...base, { cardId: other.id, quantity: 4, zone: 'maybeboard' }],
      map(commander, forest, other),
      [
        {
          id: 'e',
          cardId: other.id,
          finish: 'foil',
          quantity: 98,
          addedAt: '',
        },
      ],
    );
    expect(out.find((o) => o.name === 'Forest')).toMatchObject({
      needed: 99,
      owned: 98,
      missing: 1,
    });
  });
  it('counts artifact creatures only once in type analysis', () => {
    const a = card('artifact', { type_line: 'Artifact Creature', cmc: 4 });
    const out = deckAnalysis(
      [{ cardId: a.id, quantity: 1, zone: 'main' }],
      map(a),
    );
    expect(out.types).toEqual({ Creature: 1 });
    expect(out.curve).toEqual({ '4': 1 });
  });
});
describe('Magic deck text', () => {
  it('round-trips sections, printing references and quantities', () => {
    const text = formatMagicDeck(base, map(commander, forest));
    const result = parseMagicDeck(text);
    expect(result.errors).toEqual([]);
    expect(
      result.rows.map((r) => [r.zone, r.quantity, r.set, r.number]),
    ).toEqual([
      ['commander', 1, 'tst', '1'],
      ['main', 99, 'tst', '1'],
    ]);
  });
  it('reports malformed lines rather than silently dropping them', () =>
    expect(
      parseMagicDeck('Commander\n1 Leader\nwrong row').errors,
    ).toHaveLength(1));
});

describe('Magic coverage edge cases', () => {
  it('treats absent color identity as unverified even with a legality flag', () => {
    const incomplete = card('leader', {
      type_line: 'Legendary Creature',
      color_identity: undefined,
    });
    expect(checkCommander(base, map(incomplete, forest)).status).toBe(
      'unverified',
    );
  });
  it('keeps meld results out of physical collection counts and links the reverse face', () => {
    const result = card('meld', {
      layout: 'meld',
      all_parts: [{ id: 'meld', component: 'meld_result' }],
    });
    const front = card('front', {
      layout: 'meld',
      all_parts: [{ id: 'meld', component: 'meld_result' }],
    });
    expect(result.paper).toBe(false);
    expect(front.paper).toBe(true);
    expect(front.details.meldResultId).toBe('meld');
  });
  it('checks explicit companion conditions and never certifies an unknown companion rule', () => {
    const companion = card('gyruda', {
      name: 'Gyruda, Doom of Depths',
      keywords: ['Companion'],
    });
    const odd = card('odd', { cmc: 3 });
    const items: DeckItem[] = [
      base[0],
      { ...base[1], quantity: 98 },
      { cardId: odd.id, quantity: 1, zone: 'main' },
      { cardId: companion.id, quantity: 1, zone: 'companion' },
    ];
    expect(
      checkCommander(items, map(commander, forest, odd, companion)).issues.some(
        (i) => i.code === 'companion-condition' && !i.unverified,
      ),
    ).toBe(true);
    const unknown = card('gyruda', {
      name: 'Future companion',
      keywords: ['Companion'],
    });
    expect(
      checkCommander(
        [...base, { cardId: unknown.id, quantity: 1, zone: 'companion' }],
        map(commander, forest, unknown),
      ).status,
    ).toBe('unverified');
  });
});
