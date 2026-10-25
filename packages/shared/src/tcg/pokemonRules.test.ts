import { describe, expect, it, vi } from 'vitest';
import { checkDeckLegality } from '../decks/legality';
import { parseDeckText, formatDeckText } from '../decks/ptcgl';
import { parseScanText } from '../scan';
import { pokemonModule } from './registry';
import { pokemonDeckTools, pokemonRuleCard, pokemonRuleOptions, validatePokemonDeck } from './pokemonRules';
import type { DeckItem, Holding, PokemonDetails, PokemonTcgCard, TcgCard } from './types';

function card(id: string, name: string, details: Partial<PokemonDetails> = {}): PokemonTcgCard {
  return {
    game: 'pokemon', id, name, providerId: id, identity: id, printedName: name,
    setId: 'synthetic', setName: 'Synthetic', setCode: 'SVI', number: '001', language: 'en',
    rarity: 'Common', artist: '', image: '', faces: [], finishes: ['normal'], variants: [], treatments: [],
    extra: false, paper: true, prices: {}, fetchedAt: '2026-01-01',
    details: { kind: 'pokemon', supertype: 'Pokémon', subtypes: ['Basic'], detailed: true,
      regulationMark: 'H', set: { id: 'synthetic', name: 'Synthetic', series: '', printedTotal: 198, total: 200, releaseDate: '', updatedAt: '', images: { symbol: '', logo: '' } },
      images: { small: '', large: '' }, ...details },
  };
}
const basic = card('synthetic-001', 'Basic Pokémon');
const energy = card('synthetic-002', 'Fire Energy', { supertype: 'Energy', subtypes: ['Basic'] });
const cards = new Map<string, TcgCard>([basic, energy].map((c) => [c.id, c]));
const deck: DeckItem[] = [{ cardId: basic.id, quantity: 4, zone: 'main' }, { cardId: energy.id, quantity: 56, zone: 'main' }];
const context = { catalogueComplete: true };
const entry = (cardId: string, quantity: number, finish = 'normal'): Holding => ({ id: `${cardId}::${finish}`, cardId, quantity, finish, addedAt: '' });

describe('Pokémon shared rule adapters', () => {
  it('registers all existing formats and preserves legacy validation of complete decks', () => {
    expect(pokemonModule.formats.map((f) => [f.id, f.size])).toEqual([['standard', 60], ['expanded', 60], ['unlimited', 60]]);
    for (const format of ['standard', 'expanded', 'unlimited'] as const) {
      expect(validatePokemonDeck(deck, cards, format, context)).toEqual({ status: 'legal', issues: [] });
      const legacy = checkDeckLegality([{ card: pokemonRuleCard(basic)!.snapshot, qty: 4 }, { card: pokemonRuleCard(energy)!.snapshot, qty: 56 }], format);
      expect(legacy).toEqual({ legal: true, issues: [] });
    }
  });

  it('preserves explicit legality flags over configurable marks and applies Expanded bans', () => {
    const markedOut = { catalogueComplete: true, settings: { regulationMarks: { standard: [], expanded: [] } } };
    expect(validatePokemonDeck(deck, cards, 'standard', markedOut).issues.map((i) => i.code)).toContain('format-illegal');
    const legal = new Map([basic, energy].map((c) => [c.id, { ...c, details: { ...c.details, legal: { standard: true, expanded: true } } }]));
    expect(validatePokemonDeck(deck, legal, 'standard', markedOut).status).toBe('legal');
    const banned = validatePokemonDeck(deck, cards, 'expanded', { ...context, settings: { bannedCardIds: [basic.id] } });
    expect(banned.status).toBe('illegal');
    expect(banned.issues.some((i) => i.code === 'banned')).toBe(true);
  });

  it('counts the four-copy rule across printings while exempting Basic Energy', () => {
    const reprint = { ...basic, id: 'reprint' };
    const map = new Map([...cards, [reprint.id, reprint] as const]);
    const result = validatePokemonDeck([{ ...deck[0], quantity: 4 }, { cardId: reprint.id, quantity: 1, zone: 'main' }, { ...deck[1], quantity: 55 }], map, 'standard', context);
    expect(result.status).toBe('illegal');
    expect(result.issues).toMatchObject([{ code: 'copy-limit', cardIds: [basic.id, reprint.id] }]);
  });

  it.each(['missing', 'incomplete', 'complete'])('enforces explicit Expanded bans with %s card details', (state) => {
    const map = new Map(cards);
    if (state === 'missing') map.delete(basic.id);
    if (state === 'incomplete') map.set(basic.id, { ...basic, details: { ...basic.details, detailed: false } });
    const settings = { bannedCardIds: [basic.id, 'maybeboard-only'] };
    const items: DeckItem[] = [...deck, { cardId: 'maybeboard-only', quantity: 1, zone: 'maybeboard' }];
    const result = validatePokemonDeck(items, map, 'expanded', { ...context, settings });
    expect(result.status).toBe('illegal');
    expect(result.issues.filter((issue) => issue.code === 'banned')).toEqual([
      { code: 'banned', message: '1 card is banned in Expanded.', cardIds: [basic.id] },
    ]);
    if (state !== 'complete') expect(result.issues).toContainEqual(expect.objectContaining({ code: 'rules-missing', unverified: true }));
    for (const format of ['standard', 'unlimited'] as const)
      expect(validatePokemonDeck(items, map, format, { ...context, settings }).issues.some((issue) => issue.code === 'banned')).toBe(false);
  });

  it.each(['ACE SPEC', 'Radiant'])('retains the %s construction limit', (subtype) => {
    const restricted = card('restricted', 'Restricted', { supertype: subtype === 'ACE SPEC' ? 'Trainer' : 'Pokémon', subtypes: [subtype] });
    const result = validatePokemonDeck([deck[0], { ...deck[1], quantity: 54 }, { cardId: restricted.id, quantity: 2, zone: 'main' }], new Map([...cards, [restricted.id, restricted]]), 'standard', context);
    expect(result.issues.some((i) => i.code === (subtype === 'ACE SPEC' ? 'ace-spec-limit' : 'radiant-limit'))).toBe(true);
  });

  it('marks unknown flags, missing details and incomplete catalogues unverified', () => {
    const noMark = { ...basic, details: { ...basic.details, regulationMark: undefined } };
    const result = validatePokemonDeck(deck, new Map([...cards, [basic.id, noMark]]), 'standard', context);
    expect(result.status).toBe('unverified');
    expect(result.issues).toMatchObject([{ code: 'format-unknown', unverified: true }]);
    const missing = new Map([[energy.id, energy]]);
    expect(validatePokemonDeck(deck, missing, 'standard', context).status).toBe('unverified');
    expect(validatePokemonDeck(deck, cards, 'standard').status).toBe('unverified');
    expect(validatePokemonDeck(deck, new Map([...cards, [basic.id, { ...basic, details: { ...basic.details, detailed: false } }]]), 'unlimited', context).status).toBe('unverified');
    expect(pokemonRuleCard({ ...basic, details: { ...basic.details, legal: { standard: 'yes' } } })).toBeUndefined();
    expect(pokemonRuleCard({ ...basic, game: 'mtg' })).toBeUndefined();
    expect(pokemonRuleCard({ ...basic, details: { kind: 'pokemon', supertype: { toString: () => 'Pokémon' } } })).toBeUndefined();
  });

  it('retains proven violations when another card is missing and excludes maybeboard', () => {
    const partial = validatePokemonDeck([{ ...deck[0], quantity: 5 }, { ...deck[1], quantity: 54 }, { cardId: 'missing', quantity: 1, zone: 'main' }], cards, 'standard', context);
    expect(partial.status).toBe('illegal');
    expect(partial.issues.map((i) => i.code)).toEqual(['copy-limit', 'rules-missing']);
    expect(validatePokemonDeck([...deck, { cardId: 'missing', quantity: 20, zone: 'maybeboard' }], cards, 'standard', context).status).toBe('legal');
    expect(validatePokemonDeck([{ ...deck[0], quantity: NaN }], cards, 'standard', context).status).toBe('illegal');
    expect(validatePokemonDeck([...deck, { ...deck[0], zone: 'commander' }], cards, 'standard', context).status).toBe('illegal');
  });

  it('validates settings, rejects unknown formats and never mutates configured arrays', () => {
    for (const settings of [null, [], { misspelled: [] }, { bannedCardIds: [4] }, { regulationMarks: { standard: ['HH'], expanded: [] } }]) {
      expect(() => pokemonRuleOptions({ settings })).toThrow('Invalid Pokémon');
    }
    const settings = { regulationMarks: { standard: ['H'], expanded: ['H'] }, bannedCardIds: ['banned'] };
    const parsed = pokemonRuleOptions({ settings });
    parsed.regulationMarks!.standard.push('I'); parsed.bannedCardIds!.push('other');
    expect(settings).toEqual({ regulationMarks: { standard: ['H'], expanded: ['H'] }, bannedCardIds: ['banned'] });
    expect(() => pokemonDeckTools.ownership(deck, cards, [], { format: 'commander' })).toThrow('Unsupported Pokémon');
  });

  it('preserves eligible reprint ownership across finishes and accepts large raw stacks', () => {
    const legal = { ...basic, id: 'legal-reprint' };
    const illegal = { ...basic, id: 'illegal-reprint', details: { ...basic.details, legal: { standard: false } } };
    const map = new Map([...cards, [legal.id, legal] as const, [illegal.id, illegal] as const]);
    const holdings = [entry(legal.id, 2000), entry(legal.id, 2, 'reverse'), entry(illegal.id, 20)];
    const rows = pokemonDeckTools.ownership(deck, map, holdings, context);
    expect(rows[0]).toEqual({ name: basic.name, cardId: basic.id, deckCardIds: [basic.id], needed: 4, owned: 2002, missing: 0 });
    expect(pokemonDeckTools.ownership(deck, map, holdings, { ...context, format: 'unlimited' })[0].owned).toBe(2022);
  });

  it('groups unknown deck reprints without claiming their holdings as verified copies', () => {
    const unknown = { ...basic, id: 'unknown', details: { ...basic.details, detailed: false } };
    const map = new Map([...cards, [unknown.id, unknown] as const]);
    const rows = pokemonDeckTools.ownership([deck[0], { cardId: unknown.id, quantity: 1, zone: 'main' }], map, [entry(unknown.id, 10), entry(basic.id, 2)], context);
    expect(rows).toEqual([{ name: basic.name, cardId: basic.id, deckCardIds: [basic.id, unknown.id], needed: 5, owned: 2, missing: 3, unverified: true }]);
  });

  it('skips unrelated catalogue details while retaining every requested-name reprint', () => {
    const reprint = { ...basic, id: 'matching-reprint', name: `  ${basic.name}  ` };
    const unrelated = card('unrelated', 'Unrelated Pokémon');
    const details = vi.fn(() => { throw new Error('Unrelated details must not be projected'); });
    Object.defineProperty(unrelated, 'details', { get: details });
    const map = new Map([...cards, [reprint.id, reprint] as const, [unrelated.id, unrelated] as const]);
    const rows = pokemonDeckTools.ownership([deck[0]], map, [entry(basic.id, 1), entry(reprint.id, 2), entry(unrelated.id, 100)], context);
    expect(rows).toEqual([{ name: basic.name, cardId: basic.id, deckCardIds: [basic.id], needed: 4, owned: 3, missing: 1 }]);
    expect(details).not.toHaveBeenCalled();
  });

  it('does not scan the catalogue when no valid main-deck rows are requested', () => {
    const map = new Map(cards);
    const values = vi.spyOn(map, 'values');
    for (const items of [[], [{ ...deck[0], zone: 'maybeboard' as const }], [{ ...deck[0], quantity: 0 }]])
      expect(pokemonDeckTools.ownership(items, map, [], context)).toEqual([]);
    expect(values).not.toHaveBeenCalled();
  });

  it.each(['standard', 'expanded'] as const)('marks unknown %s eligibility uncertain while excluding unverified copies', (format) => {
    const unknown = card('unknown-format', basic.name, { regulationMark: undefined });
    const map = new Map([...cards, [unknown.id, unknown] as const]);
    const holdings = [entry(unknown.id, 10), entry(basic.id, 2)];
    const row = pokemonDeckTools.ownership(deck, map, holdings, { ...context, format })[0];
    expect(row).toMatchObject({ owned: 2, missing: 2, unverified: true });
    const ownDeck: DeckItem[] = [{ cardId: unknown.id, quantity: 4, zone: 'main' }];
    expect(pokemonDeckTools.ownership(ownDeck, new Map([[unknown.id, unknown]]), holdings, { ...context, format })[0])
      .toMatchObject({ owned: 0, missing: 4, unverified: true });
    expect(pokemonDeckTools.ownership(deck, map, holdings, { ...context, format: 'unlimited' })[0])
      .toEqual({ name: basic.name, cardId: basic.id, deckCardIds: [basic.id], needed: 4, owned: 12, missing: 0 });
    for (const flag of [true, false]) {
      const explicit = { ...unknown, details: { ...unknown.details, legal: { [format]: flag } } };
      const result = pokemonDeckTools.ownership(deck, new Map([...cards, [unknown.id, explicit]]), holdings, { ...context, format })[0];
      expect(result.owned).toBe(flag ? 12 : 2);
      expect(result.unverified).toBeUndefined();
    }
  });

  it('reuses PTCGL grammar with original line numbers, normalized Energy and visible row errors', () => {
    const text = 'Pokémon: 4\r\n4 Basic Pokémon SVI 001\r\n\r\n// comment\r\nEnergy: 56\r\n56 Basic {R} Energy SVI 002\r\nTotal Cards: 60\r\ninvalid row';
    const parsed = pokemonDeckTools.parse(text);
    expect(parsed.rows).toEqual([
      { name: 'Basic Pokémon', quantity: 4, zone: 'main', set: 'SVI', number: '001', line: 2 },
      { name: 'Fire Energy', quantity: 56, zone: 'main', set: 'SVI', number: '002', line: 6 },
    ]);
    expect(parsed.errors).toEqual(['Line 8: invalid Pokémon deck row.']);
    expect(parsed.rows.map((row) => row.name)).toEqual(parseDeckText(text).lines.map((row) => row.name));
    expect(pokemonDeckTools.parse('0 Pikachu\n1001 Pikachu').errors).toHaveLength(2);
    expect(pokemonDeckTools.parse('x'.repeat(200001)).errors).toHaveLength(1);
    expect(pokemonDeckTools.parse('1 Pikachu\n'.repeat(501)).rows).toEqual([]);
  });

  it('exports the same legacy PTCGL sections and fails visibly instead of dropping unsupported rows', () => {
    const text = pokemonDeckTools.format(deck, cards);
    expect(text).toBe(formatDeckText([{ card: pokemonRuleCard(basic)!.snapshot, qty: 4 }, { card: pokemonRuleCard(energy)!.snapshot, qty: 56 }]));
    expect(pokemonDeckTools.parse(text).rows.map((row) => [row.name, row.quantity, row.set, row.number])).toEqual([[basic.name, 4, 'SVI', '001'], [energy.name, 56, 'SVI', '001']]);
    expect(() => pokemonDeckTools.format([...deck, { cardId: 'missing', quantity: 1, zone: 'main' }], cards)).toThrow('Missing Pokémon');
    expect(() => pokemonDeckTools.format([{ ...deck[0], zone: 'maybeboard' }], cards)).toThrow('PTCGL export');
    expect(pokemonDeckTools.analyze([...deck, { ...deck[0], quantity: 10, zone: 'maybeboard' }], cards)).toEqual({ categories: { Pokémon: 4, Energy: 56 }, types: {} });
  });

  it.each([
    { setCode: 'SVI', number: '' },
    { setCode: 'SHF', number: 'SV045' },
    { setCode: '', number: '001' },
    { setCode: 'INVALID CODE', number: '001' },
    { number: '1/198' },
    { name: 'Basic Pokémon\n1 Injected SVI 002' },
  ])('rejects exports whose printing or name cannot round-trip: %j', (fields) => {
    const invalid = { ...basic, ...fields };
    expect(() => pokemonDeckTools.format([deck[0]], new Map([[basic.id, invalid]])))
      .toThrow(expect.objectContaining({ code: 'invalid_deck_export' }));
  });

  it('round-trips supported alphanumeric collector numbers and normalized set codes', () => {
    const supported = { ...basic, setCode: 'swsh', number: 'TG05' };
    const text = pokemonDeckTools.format([deck[0]], new Map([[basic.id, supported]]));
    expect(pokemonDeckTools.parse(text).rows).toEqual([
      { name: basic.name, quantity: 4, zone: 'main', set: 'SWSH', number: 'TG05', line: 2 },
    ]);
  });

  it.each(['OBF 045/197', 'TG05/TG30', 'SVP 064', '12O/198 SVI'])('preserves scan evidence for %s', (text) => {
    const source = parseScanText(text);
    expect(pokemonModule.scan(text)).toEqual(source.map(({ setCode, ...candidate }) => ({ ...candidate, set: setCode })));
    expect(pokemonModule.scan(text)[0].confidence).toBeGreaterThan(0);
  });
});
