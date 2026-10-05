import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectionPage from './CollectionPage';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { useSettings } from '../store/settingsStore';
import { useCollectionStore } from '../store/collectionStore';

const CARDS = [
  makeSnapshot({ id: 'sv03-001', name: 'Charmander', artist: 'Ken Sugimori', prices: { normal: 1, reverseHolofoil: 2 } }),
  makeSnapshot({ id: 'sv03-006', name: 'Charizard', prices: { normal: 50 } }),
  makeSnapshot({ id: 'base1-4', name: 'Blastoise', setName: 'Base', releaseDate: '1999-01-09', prices: { holofoil: 10 }, variants: ['holofoil'] }),
];
const ENTRIES = [
  makeEntry({ cardId: 'sv03-001', quantity: 2, addedAt: '2025-01-02T00:00:00.000Z' }),
  makeEntry({ cardId: 'sv03-001', variant: 'reverseHolofoil', condition: 'LP', addedAt: '2025-01-01T00:00:00.000Z' }),
  makeEntry({ cardId: 'sv03-006', addedAt: '2025-01-01T00:00:00.000Z' }),
  makeEntry({ cardId: 'base1-4', variant: 'holofoil', addedAt: '2025-01-03T00:00:00.000Z' }),
];

const renderPage = (route = '/collection') => renderWithProviders(<CollectionPage />, { route, path: '/collection' });
const location = () => screen.getByTestId('location').textContent;
const gridNames = () => screen.getAllByRole('link', { name: /owned/ }).map((l) => l.getAttribute('aria-label')!.split(' ')[0]);
const value = () => screen.getByText(/(Total|Filtered) value/).nextElementSibling!.textContent;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection({ entries: ENTRIES, cards: CARDS });
});

describe('CollectionPage', () => {
  it('shows a skeleton until the collection loads', () => {
    useCollectionStore.setState({ isLoaded: false });
    renderPage();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    seedCollection();
    renderPage();
    expect(screen.getByRole('heading', { name: 'Your collection is empty' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse sets' })).toHaveAttribute('href', '/sets');
  });

  it('summarises counts and total value', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Collection' })).toBeInTheDocument();
    expect(screen.getByText('5 cards · 3 unique · 2 sets')).toBeInTheDocument();
    // $2 + $2 + $50 + $10 = $64 → £32.00
    expect(screen.getByText('Total value')).toBeInTheDocument();
    expect(value()).toBe('£32.00');
  });

  it('shows the grid sorted by most recently added', () => {
    renderPage();
    expect(gridNames()).toEqual(['Blastoise', 'Charmander', 'Charizard']);
  });

  it.each([
    ['value', ['Charizard', 'Blastoise', 'Charmander']],
    ['name', ['Blastoise', 'Charizard', 'Charmander']],
    ['set', ['Charmander', 'Charizard', 'Blastoise']],
  ])('sorts by %s and stores it in the URL', async (sort, expected) => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), sort);
    expect(location()).toBe(`/collection?sort=${sort}`);
    expect(gridNames()).toEqual(expected);
  });

  it('filters by set from the URL, newest set first in the picker', async () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: 'Set' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All sets', 'Obsidian Flames (2)', 'Base (1)']);
    await userEvent.selectOptions(select, 'base1');
    expect(location()).toBe('/collection?set=base1');
    expect(gridNames()).toEqual(['Blastoise']);
    expect(screen.getByText('Filtered value')).toBeInTheDocument();
    expect(value()).toBe('£5.00');
    await userEvent.selectOptions(select, '');
    expect(location()).toBe('/collection');
  });

  it('filters by name or artist and clears', async () => {
    renderPage();
    const input = screen.getByPlaceholderText('Name, artist or note');
    await userEvent.type(input, 'sugimori');
    expect(gridNames()).toEqual(['Charmander']);
    expect(value()).toBe('£2.00');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(input).toHaveValue('');
    expect(gridNames()).toHaveLength(3);
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('No cards match.')).toBeInTheDocument();
  });

  it('shows a list view with variants, quantities and values', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(location()).toBe('/collection?view=list');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const charmander = rows[1];
    expect(within(charmander).getByRole('link')).toHaveAttribute('href', '/card/sv03-001');
    expect(within(charmander).getByTitle('Normal · NM')).toHaveTextContent('×2');
    expect(within(charmander).getByTitle('Reverse Holo · LP')).not.toHaveTextContent('×');
    const cells = within(charmander).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Obsidian Flames #1');
    expect(cells[3]).toHaveTextContent('3');
    expect(cells[4]).toHaveTextContent('£2.00');
  });

  it('shows binder pages sorted by set when opened from the URL', () => {
    renderPage('/collection?view=binder');
    expect(screen.getByRole('radio', { name: 'Binder pages' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    const titles = screen.getAllByRole('link').map((l) => l.getAttribute('title')).filter(Boolean);
    expect(titles).toEqual(['Charmander #1', 'Charizard #6', 'Blastoise #4']);
  });

  it('returns to the grid, dropping the view param', async () => {
    renderPage('/collection?view=list&sort=name');
    await userEvent.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(location()).toBe('/collection?sort=name');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('notes cards whose details are still being fetched', () => {
    seedCollection({ entries: [...ENTRIES, makeEntry({ cardId: 'new-1' }), makeEntry({ cardId: 'new-2' })], cards: CARDS });
    renderPage();
    expect(screen.getByText('Fetching details for 2 cards…')).toBeInTheDocument();
    expect(screen.getByText('7 cards · 5 unique · 2 sets')).toBeInTheDocument();
  });

  it('uses the singular when one card is being fetched', () => {
    seedCollection({ entries: [...ENTRIES, makeEntry({ cardId: 'new-1' })], cards: CARDS });
    renderPage();
    expect(screen.getByText('Fetching details for 1 card…')).toBeInTheDocument();
  });

  describe('graded copies', () => {
    const SLABS = [
      makeGraded({ id: 'g1', cardId: 'sv03-006', valueUsd: 500, countsTowardSet: false }),
      makeGraded({ id: 'g2', cardId: 'sv04-010', company: 'CGC', grade: '9.5', valueUsd: 100, countsTowardSet: false }),
    ];
    const SLAB_CARD = makeSnapshot({ id: 'sv04-010', name: 'Mew', setId: 'sv04', setName: 'Paradox Rift', prices: {} });
    beforeEach(() => seedCollection({ entries: ENTRIES, cards: [...CARDS, SLAB_CARD], graded: SLABS }));

    it('adds slab value and count, and lists slabs beside variants', () => {
      renderPage('/collection?view=list');
      expect(screen.getByText(/7 cards · 4 unique/)).toBeInTheDocument();
      const row = screen.getByRole('link', { name: /Charizard/ }).closest('tr')!;
      expect(within(row).getByText('PSA 10')).toHaveAttribute('title', expect.stringContaining('kept out of set progress'));
      expect(within(screen.getByRole('link', { name: /Mew/ }).closest('tr')!).getByText('CGC 9.5')).toBeInTheDocument();
    });

    it('filters to graded cards via the toggle', async () => {
      renderPage();
      const toggle = screen.getByRole('button', { name: /Graded 2/ });
      await userEvent.setup().click(toggle);
      expect(location()).toContain('graded=1');
      expect(gridNames().sort()).toEqual(['Charizard', 'Mew']);
    });

    it('keeps display-only slabs out of binder pages', () => {
      renderPage('/collection?view=binder&graded=1');
      // Charizard has a raw copy too, so it stays; Mew is slab-only and excluded
      expect(screen.queryByTitle(/Mew/)).not.toBeInTheDocument();
      expect(screen.getByTitle(/Charizard/)).toBeInTheDocument();
    });

    it('explains when every filtered card is a display slab', () => {
      seedCollection({ cards: [SLAB_CARD], graded: [SLABS[1]] });
      renderPage('/collection?view=binder');
      expect(screen.getByText(/kept out of your binder/i)).toBeInTheDocument();
    });
  });

  it('remembers the view, sort and graded toggle between visits', async () => {
    const first = renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'Binder pages' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name');
    first.unmount();
    renderPage();
    expect(screen.getByRole('radio', { name: 'Binder pages' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('name');
    expect(screen.getByTestId('location').textContent).toBe('/collection');
  });

  it('ignores a corrupt remembered sort', () => {
    useSettings.setState({ viewPrefs: { 'collection.sort': 'toString', 'collection.view': 'nonsense' } });
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('added');
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  });

  it('marks non-English cards with a language badge in the list', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'ja:SV4a-001', setId: 'ja:SV4a' })], cards: [makeSnapshot({ id: 'ja:SV4a-001', setId: 'ja:SV4a', setName: 'シャイニートレジャーex' })] });
    renderPage('/collection?view=list');
    expect(screen.getAllByTitle('Japanese').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /シャイニートレジャーex · JP/ })).toBeInTheDocument();
  });

  it('shows notes in the list and finds cards by note', async () => {
    seedCollection({
      entries: [makeEntry(), makeEntry({ id: 'sv03-006::normal', cardId: 'sv03-006' })],
      cards: [makeSnapshot(), makeSnapshot({ id: 'sv03-006', name: 'Charizard' })],
      notes: { 'sv03-006': 'Birthday present from Gran' },
    });
    renderPage('/collection?view=list');
    expect(screen.getByTitle('Birthday present from Gran')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter collection' }), 'gran');
    expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent)).toEqual([expect.stringContaining('Charizard')]);
  });

  it('sorts by gain and shows gain beside value for cards with a price paid', async () => {
    useCollectionStore.setState((s) => {
      const entries = new Map(s.entries);
      // Charmander: paid £1 each for 2 × $1 → loss; Blastoise: paid £1 for $10 → gain
      entries.set('sv03-001::normal', { ...entries.get('sv03-001::normal')!, paid: { amount: 1, currency: 'GBP' } });
      entries.set('base1-4::holofoil', { ...entries.get('base1-4::holofoil')!, paid: { amount: 1, currency: 'GBP' } });
      return { entries };
    });
    renderPage('/collection?view=list&sort=gain');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('gain');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('link')[0].textContent)).toEqual([expect.stringContaining('Blastoise'), expect.stringContaining('Charmander'), expect.stringContaining('Charizard')]);
    expect(rows[0]).toHaveTextContent('+£4.00');
    expect(rows[1]).toHaveTextContent('−£1.00');
    expect(rows[2]).not.toHaveTextContent(/[+−]£/);
  });

});
