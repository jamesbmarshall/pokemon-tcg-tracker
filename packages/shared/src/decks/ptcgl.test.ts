import { describe, expect, it } from 'vitest';
import { formatDeckText, parseDeckText, resolveDeckLines } from './ptcgl';
import type { CardSnapshot } from '../types';

const DECK_TEXT = `Pokémon: 2
4 Charizard ex OBF 125
2 Pidgey SVI 162

Trainer: 2
4 Arven SVI 166
3 Rare Candy SVI 191

Energy: 1
10 Basic {R} Energy SVE 2

Total Cards: 23
`;

describe('parseDeckText', () => {
  it('parses sections, quantities, set codes and numbers', () => {
    const { lines, totalCards } = parseDeckText(DECK_TEXT);
    expect(totalCards).toBe(23);
    expect(lines).toEqual([
      { raw: '4 Charizard ex OBF 125', qty: 4, name: 'Charizard ex', setCode: 'OBF', number: '125', section: 'Pokémon' },
      { raw: '2 Pidgey SVI 162', qty: 2, name: 'Pidgey', setCode: 'SVI', number: '162', section: 'Pokémon' },
      { raw: '4 Arven SVI 166', qty: 4, name: 'Arven', setCode: 'SVI', number: '166', section: 'Trainer' },
      { raw: '3 Rare Candy SVI 191', qty: 3, name: 'Rare Candy', setCode: 'SVI', number: '191', section: 'Trainer' },
      { raw: '10 Basic {R} Energy SVE 2', qty: 10, name: 'Fire Energy', setCode: 'SVE', number: '2', section: 'Energy' },
    ]);
  });

  it('tolerates "Pokemon" without the accent, blank lines and comments', () => {
    const { lines } = parseDeckText('Pokemon: 1\n// a comment\n\n1 Pikachu SVI 48\n');
    expect(lines).toEqual([{ raw: '1 Pikachu SVI 48', qty: 1, name: 'Pikachu', setCode: 'SVI', number: '48', section: 'Pokémon' }]);
  });

  it('falls back to a plain name when no set code / number is present', () => {
    const { lines } = parseDeckText('Trainer: 1\n4 Professor Research');
    expect(lines).toEqual([{ raw: '4 Professor Research', qty: 4, name: 'Professor Research', section: 'Trainer' }]);
  });
});

function snapshot(overrides: Partial<CardSnapshot> & { id: string; name: string }): CardSnapshot {
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
    ...overrides,
  };
}

describe('resolveDeckLines / formatDeckText round trip', () => {
  it('resolves every line and formats back to equivalent text', async () => {
    const catalogue: Record<string, CardSnapshot> = {
      'OBF-125': snapshot({ id: 'sv03-125', name: 'Charizard ex', number: '125', setCode: 'OBF' }),
      'SVI-162': snapshot({ id: 'sv01-162', name: 'Pidgey', number: '162', setCode: 'SVI' }),
      'SVI-166': snapshot({ id: 'sv01-166', name: 'Arven', number: '166', setCode: 'SVI', supertype: 'Trainer' }),
      'SVI-191': snapshot({ id: 'sv01-191', name: 'Rare Candy', number: '191', setCode: 'SVI', supertype: 'Trainer' }),
      'SVE-2': snapshot({ id: 'sve-2', name: 'Fire Energy', number: '2', setCode: 'SVE', supertype: 'Energy', subtypes: ['Basic'] }),
    };
    const { lines } = parseDeckText(DECK_TEXT);
    const { resolved, unresolved } = await resolveDeckLines(lines, async (line) => catalogue[`${line.setCode}-${line.number}`]);
    expect(unresolved).toEqual([]);
    expect(resolved).toHaveLength(5);

    const exported = formatDeckText(resolved.map((r) => ({ card: r.card, qty: r.qty })));
    const reparsed = parseDeckText(exported);
    const { resolved: resolvedAgain, unresolved: unresolvedAgain } = await resolveDeckLines(reparsed.lines, async (line) => catalogue[`${line.setCode}-${line.number}`]);
    expect(unresolvedAgain).toEqual([]);
    expect(resolvedAgain.map((r) => ({ id: r.card.id, qty: r.qty })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      resolved.map((r) => ({ id: r.card.id, qty: r.qty })).sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('reports unresolved lines without throwing', async () => {
    const { lines } = parseDeckText('Trainer: 1\n4 Unknown Card ZZZ 999');
    const { resolved, unresolved } = await resolveDeckLines(lines, async () => undefined);
    expect(resolved).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });
});
