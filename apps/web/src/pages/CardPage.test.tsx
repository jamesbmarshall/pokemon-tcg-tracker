import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardPage from './CardPage';
import { renderWithProviders } from '../test/render';
import { errorResult, loadingResult, queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { memory } from '../test/memoryBackend';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';
import type { Printing } from '../api/client';
import type { PokemonCard, PriceHistorySeries } from '../api/types';

const mocks = vi.hoisted(() => ({ useCard: vi.fn(), useSetCards: vi.fn(), usePrintings: vi.fn() }));
vi.mock('../api/hooks', () => ({ useCard: mocks.useCard, useSetCards: mocks.useSetCards, usePrintings: mocks.usePrintings }));

const SET_CARDS = [makeCard({ id: 'sv03-003' }), makeCard({ id: 'sv03-001' }), makeCard({ id: 'sv03-002' })];

function setup(card: PokemonCard = makeCard({ id: 'sv03-002' }), route = `/card/${card.id}`) {
  mocks.useCard.mockReturnValue(queryResult(card));
  return renderWithProviders(<CardPage />, { route, path: '/card/:cardId' });
}
const location = () => screen.getByTestId('location').textContent;
const toasts = () => useToasts.getState().toasts;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  mocks.useSetCards.mockReturnValue(queryResult(SET_CARDS));
  mocks.usePrintings.mockReturnValue(queryResult([]));
});

describe('CardPage', () => {
  it('shows skeletons while loading', () => {
    mocks.useCard.mockReturnValue(loadingResult());
    renderWithProviders(<CardPage />, { route: '/card/x', path: '/card/:cardId' });
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an error with retry and a way back', async () => {
    const err = errorResult('Card API down');
    mocks.useCard.mockReturnValue(err);
    renderWithProviders(<CardPage />, { route: '/card/x', path: '/card/:cardId' });
    expect(mocks.useCard).toHaveBeenCalledWith('x');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this card");
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(err.refetch).toHaveBeenCalled();
    expect(within(alert).getByRole('link', { name: 'Browse sets' })).toHaveAttribute('href', '/sets');
  });

  it('treats a missing card as an error', () => {
    mocks.useCard.mockReturnValue(queryResult(undefined));
    renderWithProviders(<CardPage />, { route: '/card/x', path: '/card/:cardId' });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this card");
  });

  it('renders the card details', () => {
    setup(
      makeCard({
        id: 'sv03-002',
        name: 'Charmeleon',
        subtypes: ['Stage 1'],
        hp: '90',
        rarity: 'Uncommon',
        regulationMark: 'G',
        artist: 'Kagemaru Himeno',
        abilities: [{ name: 'Blaze Up', text: 'Heat things up.', type: 'Ability' }],
        attacks: [{ name: 'Flamethrower', cost: ['Fire', 'Colorless'], convertedEnergyCost: 2, damage: '50', text: 'Discard an Energy.' }],
        rules: ['Rule text'],
        weaknesses: [{ type: 'Water', value: '×2' }],
        retreatCost: ['Colorless', 'Colorless'],
        flavorText: 'It is very hot.',
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Charmeleon' })).toBeInTheDocument();
    expect(screen.getByText('Pokémon · Stage 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#002/197 · Obsidian Flames' })).toHaveAttribute('href', '/sets/sv03');
    expect(screen.getByText('Uncommon')).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Illus. Kagemaru Himeno' })).toHaveAttribute('href', '/search?artist=Kagemaru%20Himeno');
    expect(screen.getByRole('link', { name: /Back to set\s*Obsidian Flames/ })).toHaveAttribute('href', '/sets/sv03');
    expect(screen.getByRole('heading', { name: 'Card text' })).toBeInTheDocument();
    expect(screen.getByText('Blaze Up')).toBeInTheDocument();
    expect(screen.getByText('Flamethrower')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('Rule text')).toBeInTheDocument();
    expect(screen.getByText('Weakness').parentElement).toHaveTextContent('×2');
    expect(screen.getByText('Resistance').parentElement).toHaveTextContent('—');
    expect(screen.getByText('It is very hot.')).toBeInTheDocument();
  });

  it('omits gameplay sections for lighter cards', () => {
    setup(makeCard({ id: 'sv03-002', tcgplayer: undefined, artist: undefined }));
    expect(screen.queryByRole('heading', { name: 'Card text' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Market' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Illus/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Weakness')).not.toBeInTheDocument();
  });

  it('shows a not-owned state with an Add button per variant', async () => {
    setup();
    expect(screen.getByText('Not owned yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove all copies' })).not.toBeInTheDocument();
    const adds = screen.getAllByRole('button', { name: 'Add' });
    expect(adds).toHaveLength(2);
    expect(screen.getByText('£0.50 market')).toBeInTheDocument();
    expect(screen.getByText('£1.00 market')).toBeInTheDocument();

    await userEvent.click(adds[1]);
    await waitFor(() => expect(useCollectionStore.getState().byCard.get('sv03-002')).toEqual({ reverseHolofoil: 1 }));
    expect(screen.getByText(/1 copy/)).toHaveTextContent('1 copy · £1.00');
    expect(screen.getByRole('button', { name: 'Add one Reverse Holo' })).toBeInTheDocument();
  });

  it('shows "No price data" for unpriced variants', () => {
    setup(makeCard({ id: 'sv03-002', variants: ['normal', 'holofoil'] }));
    expect(screen.getByText('No price data')).toBeInTheDocument();
  });

  it('adjusts owned variants and updates the condition', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'sv03-002', quantity: 2 })], cards: [makeSnapshot({ id: 'sv03-002' })] });
    setup();
    expect(screen.getByText(/2 copies/)).toHaveTextContent('2 copies · £1.00');

    await userEvent.click(screen.getByRole('button', { name: 'Add one Normal' }));
    await waitFor(() => expect(screen.getByText(/3 copies/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Remove one Normal' }));
    await waitFor(() => expect(screen.getByText(/2 copies/)).toBeInTheDocument());
    expect(toasts()).toHaveLength(0);

    const cond = screen.getByRole('combobox', { name: 'Condition' });
    expect(cond).toHaveValue('NM');
    await userEvent.selectOptions(cond, 'LP');
    await waitFor(() => expect(useCollectionStore.getState().entries.get('sv03-002::normal')?.condition).toBe('LP'));
  });

  it('offers undo when removing the last copy of a variant', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'sv03-002' })], cards: [makeSnapshot({ id: 'sv03-002' })] });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Normal' }));
    await waitFor(() => expect(screen.getByText('Not owned yet')).toBeInTheDocument());
    await waitFor(() => expect(toasts()[0]?.message).toBe('Removed Normal'));
    await toasts()[0].action!.run();
    await waitFor(() => expect(useCollectionStore.getState().byCard.get('sv03-002')).toEqual({ normal: 1 }));
  });

  it('toggles the wishlist with toasts', async () => {
    setup();
    const btn = screen.getByRole('button', { name: 'Wishlist' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Wishlisted' })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(toasts().at(-1)).toMatchObject({ message: 'Added to wishlist', tone: 'success' }));
    expect(useCollectionStore.getState().wishlist.has('sv03-002')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Wishlisted' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Wishlist' })).toBeInTheDocument());
    await waitFor(() => expect(toasts().at(-1)).toMatchObject({ message: 'Removed from wishlist', tone: 'default' }));
  });

  it('removes all copies with undo', async () => {
    seedCollection({
      entries: [makeEntry({ cardId: 'sv03-002' }), makeEntry({ cardId: 'sv03-002', variant: 'reverseHolofoil', quantity: 3 })],
      cards: [makeSnapshot({ id: 'sv03-002' })],
    });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove all copies' }));
    await waitFor(() => expect(screen.getByText('Not owned yet')).toBeInTheDocument());
    await waitFor(() => expect(toasts()[0]?.message).toBe('Removed all Charmander'));
    await toasts()[0].action!.run();
    await waitFor(() => expect(screen.getByText(/4 copies/)).toBeInTheDocument());
  });

  it('shows the market table with converted TCGplayer and Cardmarket prices', () => {
    setup(
      makeCard({
        id: 'sv03-002',
        tcgplayer: { url: 'https://tcgplayer.example/1', updatedAt: '2025-01-01', prices: { normal: { market: 1, low: 3 }, holofoil: { mid: 4 } } },
        cardmarket: { url: 'https://cardmarket.example/1', updatedAt: '2025-01-01', prices: { normal: { market: 1.8, low: 0.9 } } },
      }),
    );
    expect(screen.getByRole('link', { name: /TCGplayer/ })).toHaveAttribute('href', 'https://tcgplayer.example/1');
    expect(screen.getByRole('link', { name: /Cardmarket/ })).toHaveAttribute('href', 'https://cardmarket.example/1');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      // $1 → £0.50; €1.80 / 0.9 = $2 → £1.00; lowest of $3 and €0.90 ($1) → £0.50
      ['Normal', '£0.50', '£1.00', '£0.50'],
      ['Reverse Holo', '—', '—', '—'],
      ['Holo', '£2.00', '—', '—'],
    ]);
  });

  it('navigates between cards in set order with buttons and arrow keys', async () => {
    setup();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(location()).toBe('/card/sv03-003');
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(location()).toBe('/card/sv03-002');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(location()).toBe('/card/sv03-001');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(location()).toBe('/card/sv03-002');
    await userEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    expect(location()).toBe('/card/sv03-001');
  });

  it('swipes between cards in set order and slides the new card in from that side', () => {
    setup();
    const swipe = (fromX: number, toX: number) => {
      const el = screen.getByRole('heading', { level: 1 });
      fireEvent.touchStart(el, { touches: [{ clientX: fromX, clientY: 300 }] });
      fireEvent.touchEnd(el, { touches: [], changedTouches: [{ clientX: toX, clientY: 300 }] });
    };
    swipe(300, 100);
    expect(location()).toBe('/card/sv03-003');
    expect(document.querySelector('.animate-slide-from-right')).toBeInTheDocument();
    swipe(300, 100);
    expect(location()).toBe('/card/sv03-003');
    swipe(100, 300);
    expect(location()).toBe('/card/sv03-002');
    expect(document.querySelector('.animate-slide-from-left')).toBeInTheDocument();
    expect(screen.getByText('Swipe left or right to browse the set')).toBeInTheDocument();
  });

  it('goes back to the set with a click or Escape, unless a dialog is open', async () => {
    const first = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    dialog.remove();
    expect(location()).toBe('/card/sv03-002');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getAllByTestId('location')[0].textContent).toBe('/sets/sv03');
    first.unmount();
    setup();
    await userEvent.click(screen.getByRole('link', { name: /Back to set/ }));
    expect(screen.getAllByTestId('location')[0].textContent).toBe('/sets/sv03');
  });

  it('disables navigation at the ends of the set and ignores keys in form fields', () => {
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()] });
    setup(makeCard({ id: 'sv03-001' }));
    expect(screen.getByRole('button', { name: 'Previous card' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next card' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Condition' }), { key: 'ArrowRight' });
    expect(location()).toBe('/card/sv03-001');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(location()).toBe('/card/sv03-001');
  });

  it('hides the position when set cards are unavailable', () => {
    mocks.useSetCards.mockReturnValue(loadingResult());
    setup();
    expect(screen.queryByText(/\d\/3/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled();
  });

  it('lists other printings, excluding the current card', () => {
    const printings: Printing[] = [
      { id: 'sv03-002', name: 'Charmander', number: '2', image: '', setName: 'Obsidian Flames', releaseDate: '2023-08-11' },
      { id: 'base1-46', name: 'Charmander', number: '46', image: '', setName: 'Base', releaseDate: '1999-01-09' },
      { id: 'sv01-10', name: 'Charmander', number: '10', image: '', setName: 'Scarlet & Violet', releaseDate: '2023-03-31' },
    ];
    mocks.usePrintings.mockReturnValue(queryResult(printings));
    setup();
    expect(mocks.usePrintings).toHaveBeenCalledWith('Charmander', 'en');
    const heading = screen.getByRole('heading', { name: /Other Charmander printings/ });
    expect(heading).toHaveTextContent('2');
    const links = within(heading.parentElement!).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/card/base1-46', '/card/sv01-10']);
    expect(links[0]).toHaveTextContent('1999 · #46');
  });

  it('hides other printings when there are none', () => {
    setup();
    expect(screen.queryByRole('heading', { name: /printings/ })).not.toBeInTheDocument();
  });

  it('refreshes the stored snapshot when viewing an owned card', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'sv03-002' })], cards: [makeSnapshot({ id: 'sv03-002', name: 'Old name' })] });
    setup(makeCard({ id: 'sv03-002', name: 'New name' }));
    await waitFor(() => expect(useCollectionStore.getState().cards.get('sv03-002')?.name).toBe('New name'));
  });

  it('counts slabs as owned copies even when they are kept out of set completion', () => {
    const card = makeCard({ id: 'sv03-002' });
    const variant = Object.keys(card.tcgplayer?.prices ?? {})[0];
    seedCollection({ graded: [makeGraded({ cardId: 'sv03-002', variant, countsTowardSet: false, valueUsd: 100 })] });
    setup(card);
    expect(screen.queryByText('Not owned yet')).not.toBeInTheDocument();
    expect(screen.getByText(/1 copy/)).toBeInTheDocument();
    expect(screen.getByText('1 graded')).toBeInTheDocument();
    expect(screen.getAllByText(/£50\.00/).length).toBeGreaterThanOrEqual(2);
    // "Remove all copies" only clears raw copies, so it's hidden for slab-only cards
    expect(screen.queryByRole('button', { name: 'Remove all copies' })).not.toBeInTheDocument();
  });

  it('records what was paid per copy and shows gain against market', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'sv03-002', quantity: 2 })], cards: [makeSnapshot({ id: 'sv03-002' })] });
    setup();
    expect(screen.queryByRole('textbox', { name: 'Paid per Reverse Holo copy' })).not.toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Paid per Normal copy' });
    await userEvent.type(box, '0.25{Enter}');
    await waitFor(() => expect(useCollectionStore.getState().entries.get('sv03-002::normal')?.paid).toEqual({ amount: 0.25, currency: 'GBP' }));
    expect(toasts().at(-1)?.message).toBe('Purchase price saved');
    // 2 × $1 market = £1.00 against 2 × £0.25 paid
    expect(await screen.findByText(/^Paid £0\.50/)).toHaveTextContent('+£0.50(+100%)');
    await userEvent.clear(box);
    await userEvent.tab();
    await waitFor(() => expect(useCollectionStore.getState().entries.get('sv03-002::normal')).not.toHaveProperty('paid'));
    expect(toasts().at(-1)?.message).toBe('Purchase price cleared');
    expect(screen.queryByText(/^Paid £/)).not.toBeInTheDocument();
  });

  it('says how many copies the cost covers when only some have a price', () => {
    seedCollection({
      entries: [makeEntry({ cardId: 'sv03-002', paid: { amount: 1, currency: 'GBP' } }), makeEntry({ id: 'sv03-002::reverseHolofoil', cardId: 'sv03-002', variant: 'reverseHolofoil' })],
      cards: [makeSnapshot({ id: 'sv03-002' })],
    });
    setup();
    // paid £1 for a $1 (£0.50) card
    expect(screen.getByText(/^Paid £1\.00 for 1 of 2/)).toHaveTextContent('−£0.50(−50%)');
  });

  function series(over: Partial<PriceHistorySeries> = {}): PriceHistorySeries {
    return {
      variant: 'normal',
      source: 'tcgplayer',
      currency: 'USD',
      points: [
        { date: '2025-01-01', price: 1 },
        { date: '2025-01-02', price: 1.5 },
      ],
      updatedAt: '2025-01-02T00:00:00.000Z',
      url: 'https://tcgplayer.example/1',
      ...over,
    };
  }

  describe('price history', () => {
    it('shows a collapsed sparkline that expands into a chart on click', async () => {
      memory.priceHistories.set('sv03-002', { cardId: 'sv03-002', series: [series()] });
      setup();
      const panel = await screen.findByTestId('price-history-normal');
      const toggle = within(panel).getByRole('button', { name: 'Show price history' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(panel.querySelector('svg')).toBeInTheDocument();
      expect(within(panel).queryByText(/Updated/)).not.toBeInTheDocument();

      await userEvent.click(toggle);
      expect(within(panel).getByRole('button', { name: 'Hide price history' })).toHaveAttribute('aria-expanded', 'true');
      expect(within(panel).getByText(/Updated/)).toHaveTextContent(/from/);
      expect(within(panel).getByRole('link', { name: 'TCGplayer' })).toHaveAttribute('href', 'https://tcgplayer.example/1');
    });

    it('toggles between TCGplayer and Cardmarket series when both exist', async () => {
      memory.priceHistories.set('sv03-002', {
        cardId: 'sv03-002',
        series: [
          series({ points: [{ date: '2025-01-01', price: 1 }, { date: '2025-01-02', price: 1 }] }),
          series({ source: 'cardmarket', currency: 'EUR', url: 'https://cardmarket.example/1', points: [{ date: '2025-01-01', price: 9 }, { date: '2025-01-02', price: 9 }] }),
        ],
      });
      setup();
      const panel = await screen.findByTestId('price-history-normal');
      await userEvent.click(within(panel).getByRole('button', { name: 'Show price history' }));
      expect(within(panel).getByRole('radio', { name: 'TCGplayer' })).toHaveAttribute('aria-checked', 'true');
      // $1 market at the test FX rate (£0.50) is the TCGplayer value shown
      expect(within(panel).getByText('£0.50')).toBeInTheDocument();

      await userEvent.click(within(panel).getByRole('radio', { name: 'Cardmarket' }));
      expect(within(panel).getByRole('radio', { name: 'Cardmarket' })).toHaveAttribute('aria-checked', 'true');
      expect(within(panel).getByRole('link', { name: 'Cardmarket' })).toHaveAttribute('href', 'https://cardmarket.example/1');
      // €9 → $10 (rates.EUR=0.9) → £5.00 at the test FX rate
      expect(within(panel).getByText('£5.00')).toBeInTheDocument();
    });

    it('does not render a price-history block when there is no history for the card', () => {
      setup();
      expect(screen.queryByRole('button', { name: 'Show price history' })).not.toBeInTheDocument();
    });
  });

  describe('manual value override', () => {
    it('sets a manual value, shows a Manual badge and uses it over the market price', async () => {
      seedCollection({ entries: [makeEntry({ cardId: 'sv03-002' })], cards: [makeSnapshot({ id: 'sv03-002' })] });
      setup();
      expect(screen.queryByText('Manual')).not.toBeInTheDocument();
      const box = screen.getByRole('textbox', { name: 'Your value per Normal copy' });
      await userEvent.type(box, '5{Enter}');
      // Typed in the display currency: £5 at the test FX rate (£0.50/USD) is stored as $10
      await waitFor(() => expect(useCollectionStore.getState().entries.get('sv03-002::normal')?.valueUsd).toBe(10));
      expect(toasts().at(-1)?.message).toBe('Your value saved');
      expect(box).toHaveValue('5.00');
      expect(screen.getAllByText('£', { exact: true }).length).toBeGreaterThan(0);
      // Overrides the $1 (£0.50) market price
      expect(await screen.findByText('£5.00')).toBeInTheDocument();
      expect(screen.getAllByText('Manual').length).toBeGreaterThan(0);

      await userEvent.clear(box);
      await userEvent.tab();
      await waitFor(() => expect(useCollectionStore.getState().entries.get('sv03-002::normal')).not.toHaveProperty('valueUsd'));
      expect(toasts().at(-1)?.message).toBe('Your value cleared');
      expect(screen.queryByText('Manual')).not.toBeInTheDocument();
      expect(screen.getByText(/£0\.50 market/)).toBeInTheDocument();
    });
  });
});
