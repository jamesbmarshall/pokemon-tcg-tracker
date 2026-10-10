import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetPage from './SetPage';
import { renderWithProviders } from '../test/render';
import { errorResult, loadingResult, queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeEntry, makeGraded, makeSet, makeSnapshot } from '../test/fixtures';
import { useSettings } from '../store/settingsStore';

const mocks = vi.hoisted(() => ({ useSet: vi.fn(), useSetCards: vi.fn() }));
vi.mock('../api/hooks', () => ({ useSet: mocks.useSet, useSetCards: mocks.useSetCards }));

const CARDS = [
  makeCard({ id: 'sv03-001', name: 'Charmander', rarity: 'Common' }),
  makeCard({ id: 'sv03-002', name: 'Charmeleon', rarity: 'Uncommon' }),
  makeCard({ id: 'sv03-223', name: 'Charizard ex', rarity: 'Special Illustration Rare', variants: ['holofoil'] }),
];

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  mocks.useSet.mockReturnValue(queryResult(makeSet()));
  mocks.useSetCards.mockReturnValue(queryResult(CARDS));
  // Card-per-tile behaviour; master mode (one tile per printing) has its own suite below.
  useSettings.setState({ setMode: 'full' });
});

const renderPage = () => renderWithProviders(<SetPage />, { route: '/sets/sv03', path: '/sets/:setId' });
const tileNames = () => screen.queryAllByRole('link', { name: /owned/ }).map((l) => l.getAttribute('aria-label')!.replace(/ \S+, (owned|not owned).*$/, ''));
const user = () => userEvent.setup();

describe('SetPage', () => {
  it('requests the set from the route param', () => {
    renderPage();
    expect(mocks.useSet).toHaveBeenCalledWith('sv03');
    expect(mocks.useSetCards).toHaveBeenCalledWith('sv03');
  });

  it('stacks the hero grid on narrow screens (regression: hero overflowed below the lg: breakpoint)', () => {
    renderPage();
    const heroGrids = Array.from(document.querySelectorAll('.grid')).filter((el) =>
      /\blg:grid-cols-/.test(el.className),
    );
    expect(heroGrids.length).toBeGreaterThan(0);
    for (const grid of heroGrids) {
      expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    }
  });

  it('shows skeletons while loading', () => {
    mocks.useSet.mockReturnValue(loadingResult());
    mocks.useSetCards.mockReturnValue(loadingResult());
    renderPage();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(1);
    expect(screen.getByRole('link', { name: /Sets/ })).toHaveAttribute('href', '/sets');
  });

  it('shows the header progress as "…" while cards load', () => {
    mocks.useSetCards.mockReturnValue(loadingResult());
    renderPage();
    expect(screen.getByRole('heading', { name: 'Obsidian Flames' })).toBeInTheDocument();
    expect(screen.getAllByText('…')).toHaveLength(3);
  });

  it('shows an error with retry when cards fail to load', async () => {
    const err = errorResult('Set API down');
    mocks.useSetCards.mockReturnValue(err);
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this set");
    expect(alert).toHaveTextContent('Set API down');
    await user().click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(err.refetch).toHaveBeenCalled();
    expect(within(alert).getByRole('link', { name: 'Back to sets' })).toHaveAttribute('href', '/sets');
  });

  it('retries the set request when the set fails', async () => {
    const setErr = errorResult('nope');
    mocks.useSet.mockReturnValue(setErr);
    const cards = queryResult(CARDS);
    mocks.useSetCards.mockReturnValue(cards);
    renderPage();
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(setErr.refetch).toHaveBeenCalled();
    expect(cards.refetch).not.toHaveBeenCalled();
  });

  it('renders the set header with secret count and progress', () => {
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()] });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Obsidian Flames' })).toBeInTheDocument();
    expect(screen.getByText(/197 cards \+ 33 secret/)).toBeInTheDocument();
    expect(screen.getByText('· OBF')).toBeInTheDocument();
    // base 1/2, full 1/3, master 1/5 (2 + 2 + 1 variants)
    expect(screen.getByTitle('Base: numbered cards')).toHaveTextContent('1/2');
    expect(screen.getByTitle('Full: incl. secret rares')).toHaveTextContent('1/3');
    expect(screen.getByTitle('Master: every variant')).toHaveTextContent('1/5');
    expect(screen.getByTitle('Full: incl. secret rares')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: 'All 3' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows what your copies are worth', () => {
    seedCollection({ entries: [makeEntry({ quantity: 2 }), makeEntry({ cardId: 'other-1', setId: 'other' })], cards: [makeSnapshot(), makeSnapshot({ id: 'other-1' })] });
    renderPage();
    expect(screen.getByText(/Your copies are worth/)).toHaveTextContent('Your copies are worth £1.00');
  });

  it('hides the value line when you own nothing in the set', () => {
    renderPage();
    expect(screen.queryByText(/Your copies are worth/)).not.toBeInTheDocument();
  });

  it('lists cards in number order by default', () => {
    renderPage();
    expect(tileNames()).toEqual(['Charmander', 'Charmeleon', 'Charizard ex']);
  });

  it('filters by owned, missing and wishlist', async () => {
    seedCollection({
      entries: [makeEntry(), makeEntry({ cardId: 'sv03-223', variant: 'holofoil' })],
      cards: [makeSnapshot(), makeSnapshot({ id: 'sv03-223' })],
      wishlist: [{ cardId: 'sv03-002', addedAt: '2025-01-01' }],
    });
    const u = user();
    renderPage();
    await u.click(screen.getByRole('radio', { name: 'Owned' }));
    expect(tileNames()).toEqual(['Charmander', 'Charizard ex']);
    await u.click(screen.getByRole('radio', { name: 'Cards with no copies' }));
    expect(tileNames()).toEqual(['Charmeleon']);
    await u.click(screen.getByRole('radio', { name: 'Wishlist' }));
    expect(tileNames()).toEqual(['Charmeleon']);
  });

  it('switches completion mode, which changes what counts as missing', async () => {
    useSettings.setState({ setMode: 'master' });
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()] });
    const u = user();
    renderPage();
    await u.click(screen.getByTitle('Full: incl. secret rares'));
    expect(useSettings.getState().setMode).toBe('full');
    await u.click(screen.getByRole('radio', { name: 'Cards with no copies' }));
    expect(tileNames()).toEqual(['Charmeleon', 'Charizard ex']);
    await u.click(screen.getByTitle('Base: numbered cards'));
    expect(useSettings.getState().setMode).toBe('base');
    expect(screen.getByTitle('Base: numbered cards')).toHaveAttribute('aria-pressed', 'true');
    expect(tileNames()).toEqual(['Charmeleon']);
  });

  it('hides secret rares in Base mode and shows them in Full', async () => {
    const u = user();
    renderPage();
    await u.click(screen.getByTitle('Base: numbered cards'));
    expect(tileNames()).toEqual(['Charmander', 'Charmeleon']);
    expect(screen.getByRole('radio', { name: 'All 2' })).toBeInTheDocument();
    await u.click(screen.getByTitle('Full: incl. secret rares'));
    expect(tileNames()).toEqual(['Charmander', 'Charmeleon', 'Charizard ex']);
    expect(screen.getByRole('radio', { name: 'All 3' })).toBeInTheDocument();
  });

  it('falls back to every card in Base mode when the set has no numbered cards', () => {
    useSettings.setState({ setMode: 'base' });
    mocks.useSetCards.mockReturnValue(queryResult([CARDS[2]]));
    renderPage();
    expect(tileNames()).toEqual(['Charizard ex']);
  });

  it('shows friendly empty messages per filter', async () => {
    const u = user();
    renderPage();
    await u.click(screen.getByRole('radio', { name: 'Owned' }));
    expect(screen.getByText('You don’t own any cards from this set yet.')).toBeInTheDocument();
    await u.click(screen.getByRole('radio', { name: 'Wishlist' }));
    expect(screen.getByText('No cards match these filters.')).toBeInTheDocument();
  });

  it('filters by name or exact number, and clears', async () => {
    const u = user();
    renderPage();
    await u.type(screen.getByPlaceholderText('Name or #'), 'MELEON');
    expect(tileNames()).toEqual(['Charmeleon']);
    await u.click(screen.getByRole('button', { name: 'Clear' }));
    expect(tileNames()).toHaveLength(3);
    await u.type(screen.getByPlaceholderText('Name or #'), '223');
    expect(tileNames()).toEqual(['Charizard ex']);
  });

  it('filters by rarity', async () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: 'Rarity' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All rarities', 'Common', 'Uncommon', 'Special Illustration Rare']);
    await user().selectOptions(select, 'Uncommon');
    expect(tileNames()).toEqual(['Charmeleon']);
  });

  it('sorts by name and by rarity', async () => {
    const u = user();
    renderPage();
    await u.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name');
    expect(tileNames()).toEqual(['Charizard ex', 'Charmander', 'Charmeleon']);
    await u.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'rarity');
    expect(tileNames()).toEqual(['Charizard ex', 'Charmeleon', 'Charmander']);
  });

  it('toggles quick add mode', async () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /Quick add/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user().click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Quick add is on.')).toBeInTheDocument();
    expect(useSettings.getState().quickAdd).toBe(true);
  });

  it('switches to binder pages', async () => {
    renderPage();
    await user().click(screen.getByRole('radio', { name: 'Binder pages' }));
    expect(useSettings.getState().setView).toBe('binder');
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByTitle('Charmander #001')).toHaveAttribute('href', '/card/sv03-001');
  });

  it('adds a card from the grid', async () => {
    renderPage();
    await user().click(screen.getAllByRole('button', { name: 'Add Normal' })[0]);
    expect(await screen.findByRole('link', { name: 'Charmander 001, owned ×1' })).toBeInTheDocument();
    expect(screen.getByTitle('Base: numbered cards')).toHaveTextContent('1/2');
  });

  it('counts slabs towards progress only when they are marked as counting', async () => {
    seedCollection({
      graded: [
        makeGraded({ id: 'in', cardId: 'sv03-001', variant: 'normal' }),
        makeGraded({ id: 'out', cardId: 'sv03-002', variant: 'normal', countsTowardSet: false }),
      ],
    });
    renderPage();
    expect(screen.getByTitle('Base: numbered cards')).toHaveTextContent('1/2');
    expect(screen.getByTitle('Master: every variant')).toHaveTextContent('1/5');
    // A display-only slab still shows under "Owned"
    await user().click(screen.getByRole('radio', { name: 'Owned' }));
    expect(tileNames()).toEqual(['Charmander', 'Charmeleon']);
  });

  it('remembers the show filter and sort across sets', async () => {
    const u = user();
    const first = renderPage();
    await u.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name');
    first.unmount();
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('name');
    expect(useSettings.getState().viewPrefs['set.sort']).toBe('name');
  });

  it('scrolls back to and highlights the card you came from', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderWithProviders(<SetPage />, { route: { pathname: '/sets/sv03', state: { fromCard: 'sv03-002' } }, path: '/sets/:setId' });
    const tile = document.getElementById('card-sv03-002')!;
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(scroll.mock.contexts[0]).toBe(tile);
    expect(tile).toHaveAttribute('data-flash');
    expect(tile.querySelector('a')).toHaveFocus();
  });

  describe('master mode', () => {
    beforeEach(() => useSettings.setState({ setMode: 'master' }));
    const tiles = () => screen.queryAllByRole('link', { name: /owned/ }).map((l) => l.getAttribute('aria-label')!.replace(/, (owned|not owned).*$/, '').replace(/ \d+ /, ' · '));

    it('shows every printing as its own tile', () => {
      renderPage();
      expect(tiles()).toEqual(['Charmander · Normal', 'Charmander · Reverse Holo', 'Charmeleon · Normal', 'Charmeleon · Reverse Holo', 'Charizard ex · Holo']);
      expect(screen.getByRole('radio', { name: 'All 5' })).toBeInTheDocument();
      expect(screen.getAllByText(/· Reverse Holo/)).toHaveLength(2);
    });

    it('marks ownership and price per printing', () => {
      seedCollection({ entries: [makeEntry({ quantity: 2 })], cards: [makeSnapshot()] });
      renderPage();
      expect(screen.getByRole('link', { name: 'Charmander 001 Normal, owned ×2' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Charmander 001 Reverse Holo, not owned' })).toBeInTheDocument();
      const [normal, reverse] = screen.getAllByRole('link', { name: /^Charmander 001/ }).map((l) => l.closest('[data-card]') as HTMLElement);
      // fixture market prices: normal $1 → £0.50, reverse $2 → £1.00
      expect(normal).toHaveTextContent('£0.50');
      expect(reverse).toHaveTextContent('£1.00');
      expect(within(normal).getByText('×2')).toBeInTheDocument();
      expect(within(reverse).queryByText(/×/)).not.toBeInTheDocument();
    });

    it('filters owned and missing per printing; display slabs count as owned but not as filled', async () => {
      seedCollection({
        entries: [makeEntry()],
        cards: [makeSnapshot()],
        graded: [makeGraded({ id: 'd', cardId: 'sv03-223', variant: 'holofoil', countsTowardSet: false })],
      });
      const u = user();
      renderPage();
      await u.click(screen.getByRole('radio', { name: 'Owned' }));
      expect(tiles()).toEqual(['Charmander · Normal', 'Charizard ex · Holo']);
      await u.click(screen.getByRole('radio', { name: 'Variants you don’t have yet' }));
      expect(tiles()).toEqual(['Charmander · Reverse Holo', 'Charmeleon · Normal', 'Charmeleon · Reverse Holo', 'Charizard ex · Holo']);
    });

    it('says nothing is missing when the master set is complete', async () => {
      mocks.useSetCards.mockReturnValue(queryResult([CARDS[2]]));
      seedCollection({ entries: [makeEntry({ cardId: 'sv03-223', variant: 'holofoil' })], cards: [makeSnapshot({ id: 'sv03-223' })] });
      renderPage();
      await user().click(screen.getByRole('radio', { name: 'Variants you don’t have yet' }));
      expect(screen.getByText('Nothing missing here. Lovely.')).toBeInTheDocument();
    });

    it('quick-adds and removes the exact printing from its tile', async () => {
      useSettings.setState({ quickAdd: true });
      const u = user();
      renderPage();
      expect(screen.getByText(/Every printing has its own tile/)).toBeInTheDocument();
      const reverse = screen.getByRole('link', { name: /^Charmander 001 Reverse Holo/ }).closest('[data-card]') as HTMLElement;
      await u.click(within(reverse).getByRole('button', { name: 'Add Reverse Holo' }));
      expect(await screen.findByRole('link', { name: 'Charmander 001 Reverse Holo, owned ×1' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Charmander 001 Normal, not owned' })).toBeInTheDocument();
      expect(screen.getByTitle('Master: every variant')).toHaveTextContent('1/5');
      await u.click(within(reverse).getByRole('button', { name: 'Remove one Reverse Holo' }));
      expect(await screen.findByRole('link', { name: 'Charmander 001 Reverse Holo, not owned' })).toBeInTheDocument();
    });

    it('gives every printing its own binder pocket', async () => {
      seedCollection({ entries: [makeEntry({ variant: 'reverseHolofoil', id: 'sv03-001::reverseHolofoil' })], cards: [makeSnapshot()] });
      useSettings.setState({ setView: 'binder' });
      renderPage();
      expect(screen.getByTitle('Charmander #001 · Normal')).toHaveTextContent('#001N');
      expect(screen.getByTitle('Charmander #001 · Reverse Holo').querySelector('img, [role="img"]')).not.toBeNull();
      expect(screen.getByTitle('Charizard ex #223 · Holo')).toHaveAttribute('href', '/card/sv03-223');
    });

    it('returns to the first printing of the card you came from', () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      renderWithProviders(<SetPage />, { route: { pathname: '/sets/sv03', state: { fromCard: 'sv03-002' } }, path: '/sets/:setId' });
      const tile = document.getElementById('card-sv03-002--normal')!;
      expect(scroll.mock.contexts[0]).toBe(tile);
      expect(tile).toHaveAttribute('data-flash');
    });
  });
});
