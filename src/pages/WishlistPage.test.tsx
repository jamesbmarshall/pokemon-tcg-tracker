import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WishlistPage from './WishlistPage';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';

const CHEAP = makeSnapshot({ id: 'sv03-001', name: 'Charmander', prices: { normal: 3, reverseHolofoil: 1 } });
const PRICEY = makeSnapshot({ id: 'sv03-006', name: 'Charizard', prices: { normal: 40 } });
const UNPRICED = makeSnapshot({ id: 'sv03-009', name: 'Missingno', prices: {}, variants: ['holofoil'] });

function seed() {
  seedCollection({
    cards: [CHEAP, PRICEY, UNPRICED],
    wishlist: [
      { cardId: 'sv03-001', addedAt: '2025-01-01' },
      { cardId: 'sv03-006', addedAt: '2025-01-03' },
      { cardId: 'sv03-009', addedAt: '2025-01-02' },
    ],
  });
}
const names = () => screen.getAllByRole('button', { name: 'Got it' }).map((b) => b.closest('.group')!.querySelector('p')!.textContent);
const toasts = () => useToasts.getState().toasts;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
});

describe('WishlistPage', () => {
  it('shows an empty state linking to search', () => {
    seedCollection();
    renderWithProviders(<WishlistPage />);
    expect(screen.getByRole('heading', { name: 'No chase cards yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find cards' })).toHaveAttribute('href', '/search');
  });

  it('lists wished cards newest first with the cost to buy them all', () => {
    seed();
    renderWithProviders(<WishlistPage />);
    expect(screen.getByRole('heading', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.getByText('3 cards')).toBeInTheDocument();
    expect(names()).toEqual(['Charizard', 'Missingno', 'Charmander']);
    // cheapest prices: $1 + $40 → $41 → £20.50
    expect(screen.getByText('To buy them all').nextElementSibling).toHaveTextContent('£20.50');
    const charmander = screen.getByText('Charmander').closest('.group') as HTMLElement;
    expect(within(charmander).getByText(/£0.50/)).toHaveTextContent('£0.50 Reverse Holo');
    expect(within(charmander).getByRole('link')).toHaveAttribute('href', '/card/sv03-001');
    expect(within(screen.getByText('Missingno').closest('.group') as HTMLElement).getByText('No price')).toBeInTheDocument();
  });

  it('uses the singular for one card and flags owned cards', () => {
    seedCollection({ cards: [CHEAP], wishlist: [{ cardId: 'sv03-001', addedAt: '2025-01-01' }], entries: [makeEntry()] });
    renderWithProviders(<WishlistPage />);
    expect(screen.getByText('1 card')).toBeInTheDocument();
    expect(screen.getByText('Owned')).toBeInTheDocument();
  });

  it('skips wishlist entries without a stored card', () => {
    seedCollection({ cards: [CHEAP], wishlist: [{ cardId: 'sv03-001', addedAt: '2025-01-01' }, { cardId: 'gone-1', addedAt: '2025-01-02' }] });
    renderWithProviders(<WishlistPage />);
    expect(screen.getByText('2 cards')).toBeInTheDocument();
    expect(names()).toEqual(['Charmander']);
  });

  it('sorts by price', async () => {
    seed();
    renderWithProviders(<WishlistPage />);
    await userEvent.click(screen.getByRole('radio', { name: 'Price' }));
    expect(names()).toEqual(['Charizard', 'Charmander', 'Missingno']);
    await userEvent.click(screen.getByRole('radio', { name: 'Newest' }));
    expect(names()).toEqual(['Charizard', 'Missingno', 'Charmander']);
  });

  it('moves a card to the collection with "Got it", using the cheapest variant', async () => {
    seed();
    renderWithProviders(<WishlistPage />);
    const charmander = screen.getByText('Charmander').closest('.group') as HTMLElement;
    await userEvent.click(within(charmander).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByText('Charmander')).not.toBeInTheDocument());
    const state = useCollectionStore.getState();
    expect(state.byCard.get('sv03-001')).toEqual({ reverseHolofoil: 1 });
    expect(state.wishlist.has('sv03-001')).toBe(false);
    await waitFor(() => expect(toasts()[0]).toMatchObject({ message: 'Got it! Charmander moved to your collection', tone: 'success' }));
  });

  it('falls back to the first variant when a card has no price', async () => {
    seed();
    renderWithProviders(<WishlistPage />);
    await userEvent.click(within(screen.getByText('Missingno').closest('.group') as HTMLElement).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(useCollectionStore.getState().byCard.get('sv03-009')).toEqual({ holofoil: 1 }));
    await waitFor(() => expect(toasts()).toHaveLength(1));
  });

  it('removes a card with undo', async () => {
    seed();
    renderWithProviders(<WishlistPage />);
    await userEvent.click(within(screen.getByText('Charizard').closest('.group') as HTMLElement).getByRole('button', { name: 'Remove from wishlist' }));
    await waitFor(() => expect(screen.queryByText('Charizard')).not.toBeInTheDocument());
    expect(screen.getByText('2 cards')).toBeInTheDocument();
    await waitFor(() => expect(toasts()[0]?.message).toBe('Removed Charizard'));
    toasts()[0].action!.run();
    expect(await screen.findByText('Charizard')).toBeInTheDocument();
  });

  it('returns to the empty state after removing the last card', async () => {
    seedCollection({ cards: [CHEAP], wishlist: [{ cardId: 'sv03-001', addedAt: '2025-01-01' }] });
    renderWithProviders(<WishlistPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }));
    expect(await screen.findByText('No chase cards yet')).toBeInTheDocument();
    await waitFor(() => expect(toasts()).toHaveLength(1));
  });

  it('remembers the sort order', async () => {
    seed();
    const first = renderWithProviders(<WishlistPage />);
    await userEvent.click(screen.getByRole('radio', { name: 'Price' }));
    first.unmount();
    renderWithProviders(<WishlistPage />);
    expect(screen.getByRole('radio', { name: 'Price' })).toHaveAttribute('aria-checked', 'true');
  });
});
