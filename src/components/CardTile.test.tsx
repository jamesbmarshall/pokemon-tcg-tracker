import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardTile from './CardTile';
import Toaster from './Toaster';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeEntry, makeGraded, makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';

beforeEach(async () => {
  await resetStores();
  seedCollection();
});

const qty = (id: string) => useCollectionStore.getState().byCard.get(id);

describe('CardTile', () => {
  it('renders an unowned card with its variant buttons and price', () => {
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    expect(screen.getByRole('link', { name: 'Charmander 1, not owned' })).toHaveAttribute('href', '/card/sv03-001');
    expect(screen.getByRole('link', { name: 'Charmander' })).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Normal' })).toHaveTextContent('N');
    expect(screen.getByRole('button', { name: 'Add Reverse Holo' })).toHaveTextContent('RH');
    // Highest variant price ($2) in GBP at the test rate
    expect(screen.getByText('£1.00')).toBeInTheDocument();
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });

  it('omits the price when the card has none', () => {
    renderWithProviders(<CardTile card={makeSnapshot({ prices: {} })} />);
    expect(screen.queryByText(/£/)).not.toBeInTheDocument();
  });

  it('shows the set name when showSet is on', () => {
    renderWithProviders(<CardTile card={makeSnapshot()} showSet />);
    expect(screen.getByText('Obsidian Flames · #1')).toBeInTheDocument();
  });

  it('accepts full PokemonCard objects', () => {
    renderWithProviders(<CardTile card={makeCard({ id: 'sv03-004', name: 'Charizard' })} />);
    expect(screen.getByRole('link', { name: 'Charizard 004, not owned' })).toHaveAttribute('href', '/card/sv03-004');
  });

  it('adds a copy when a variant button is clicked', async () => {
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Normal' }));
    await waitFor(() => expect(qty('sv03-001')).toEqual({ normal: 1 }));
    expect(screen.getByText('×1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Charmander 1, owned ×1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Normal (have 1)' })).toBeInTheDocument();
  });

  it('shows the total quantity across variants and the per-variant count', () => {
    seedCollection({
      entries: [makeEntry({ quantity: 2 }), makeEntry({ variant: 'reverseHolofoil', quantity: 1 })],
      cards: [makeSnapshot()],
    });
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Normal (have 2)' })).toHaveTextContent('N2');
  });

  it('removes one copy on right-click and offers Undo when the last copy goes', async () => {
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()] });
    renderWithProviders(
      <>
        <CardTile card={makeSnapshot()} />
        <Toaster />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Add Normal (have 1)' }));
    await waitFor(() => expect(qty('sv03-001')).toBeUndefined());
    expect(await screen.findByText('Removed Charmander (Normal)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(qty('sv03-001')).toEqual({ normal: 1 }));
  });

  it('does not toast when right-click leaves copies behind', async () => {
    seedCollection({ entries: [makeEntry({ quantity: 2 })], cards: [makeSnapshot()] });
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Add Normal (have 2)' }));
    await waitFor(() => expect(qty('sv03-001')).toEqual({ normal: 1 }));
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('ignores right-click on a variant you do not own', async () => {
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    const btn = screen.getByRole('button', { name: 'Add Normal' });
    const event = fireEvent.contextMenu(btn);
    expect(event).toBe(false); // default prevented
    await act(async () => {});
    expect(qty('sv03-001')).toBeUndefined();
  });

  it('shows remove buttons in quick-add mode', async () => {
    seedCollection({ entries: [makeEntry({ quantity: 2 })], cards: [makeSnapshot()] });
    renderWithProviders(<CardTile card={makeSnapshot()} quickAdd />);
    expect(screen.queryByRole('button', { name: 'Remove one Reverse Holo' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Normal' }));
    await waitFor(() => expect(qty('sv03-001')).toEqual({ normal: 1 }));
  });

  it('marks wishlisted cards you do not own', () => {
    seedCollection({ wishlist: [{ cardId: 'sv03-001', addedAt: '2025-01-01' }] });
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    expect(screen.getByTitle('On wishlist')).toBeInTheDocument();
  });

  it('hides the wishlist marker once owned', () => {
    seedCollection({ entries: [makeEntry()], cards: [makeSnapshot()], wishlist: [{ cardId: 'sv03-001', addedAt: '2025-01-01' }] });
    renderWithProviders(<CardTile card={makeSnapshot()} />);
    expect(screen.queryByTitle('On wishlist')).not.toBeInTheDocument();
  });

  it('dims missing cards in checklist mode', () => {
    renderWithProviders(<CardTile card={makeSnapshot()} dimMissing />);
    expect(screen.getByRole('link', { name: 'Charmander' })).toHaveClass('text-muted');
    expect(document.querySelector('.foil')).toBeNull();
  });

  it('shows the foil overlay when a holo variant is owned', () => {
    seedCollection({ entries: [makeEntry({ variant: 'reverseHolofoil' })], cards: [makeSnapshot()] });
    renderWithProviders(<CardTile card={makeSnapshot()} dimMissing />);
    expect(document.querySelector('.foil')).not.toBeNull();
  });

  it('badges the best slab and treats slabs as owned whether or not they count towards the set', () => {
    seedCollection({ graded: [makeGraded({ id: 'a', grade: '9' }), makeGraded({ id: 'b', company: 'BGS', grade: '10' })] });
    const { unmount } = renderWithProviders(<CardTile card={makeSnapshot()} dimMissing />);
    expect(screen.getByText('BGS 10')).toHaveAttribute('title', '2 graded copies');
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Charmander 1, owned ×2, graded BGS 10' })).toBeInTheDocument();
    // variant buttons reflect raw copies only
    expect(screen.getByRole('button', { name: 'Add Normal' })).toBeInTheDocument();
    unmount();

    seedCollection({ graded: [makeGraded({ countsTowardSet: false })] });
    renderWithProviders(<CardTile card={makeSnapshot()} dimMissing />);
    expect(screen.getByRole('link', { name: 'Charmander 1, owned ×1, graded PSA 10' })).toBeInTheDocument();
    expect(screen.getByText('PSA 10')).toHaveAttribute('title', expect.stringContaining('kept out of set progress'));
  });
});
