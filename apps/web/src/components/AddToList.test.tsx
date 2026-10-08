import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddToList from './AddToList';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeSnapshot } from '../test/fixtures';
import { memory } from '../test/memoryBackend';
import { useCollectionStore } from '../store/collectionStore';
import type { CustomList } from '../api/backend';

const CANDIDATE = makeCard({ id: 'sv03-004', name: 'Charmeleon' });
const OTHER_PRINTING = makeSnapshot({ id: 'sv03-999', name: 'Charmeleon', supertype: 'Pokémon', subtypes: ['Stage 1'] });

const deck = (over: Partial<CustomList> = {}): CustomList => ({
  id: 'd1',
  name: 'Fire deck',
  description: undefined,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  cards: [],
  kind: 'deck',
  format: 'standard',
  cardQtys: {},
  ...over,
});

function seedDecks(decks: CustomList[]) {
  seedCollection({ cards: [OTHER_PRINTING] });
  useCollectionStore.setState({ lists: decks });
  memory.lists = decks.map((d) => ({ ...d, cards: [...d.cards] }));
}

beforeEach(async () => {
  await resetStores();
});

describe('AddToList — decks', () => {
  it('adds a card to a deck, showing its own group separate from plain lists', async () => {
    seedDecks([deck()]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));

    const deckGroup = screen.getByRole('group', { name: 'Decks' });
    expect(within(deckGroup).getByText('Fire deck')).toBeInTheDocument();
    await userEvent.click(within(deckGroup).getByRole('button', { name: 'Increase Charmeleon in Fire deck' }));
    await waitFor(() => expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBe(1));
    expect(memory.lists[0].cards).toContain(CANDIDATE.id);
  });

  it('increments the quantity when the card is already in the deck', async () => {
    seedDecks([deck({ cards: [CANDIDATE.id], cardQtys: { [CANDIDATE.id]: 2 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase Charmeleon in Fire deck' }));
    await waitFor(() => expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBe(3));
  });

  it('decrements to zero and removes the card from the deck', async () => {
    seedDecks([deck({ cards: [CANDIDATE.id], cardQtys: { [CANDIDATE.id]: 1 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Charmeleon in Fire deck' }));
    await waitFor(() => expect(memory.lists[0].cards).not.toContain(CANDIDATE.id));
    expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBeUndefined();
    // The decrease button is disabled, not removed, once the card is back out of the deck.
    expect(screen.getByRole('button', { name: 'Decrease Charmeleon in Fire deck' })).toBeDisabled();
  });

  it('caps the quantity at 60 and disables the increase button', async () => {
    seedDecks([deck({ cards: [CANDIDATE.id], cardQtys: { [CANDIDATE.id]: 60 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    const increase = screen.getByRole('button', { name: 'Increase Charmeleon in Fire deck' });
    expect(increase).toBeDisabled();
    await userEvent.click(increase);
    expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBe(60);
  });

  it('shows a soft warning once a name is over the 4-copy limit, counting other printings of the same name', async () => {
    // 4 copies of a different printing of "Charmeleon" are already in the deck; adding this one tips it to 5.
    seedDecks([deck({ cards: [OTHER_PRINTING.id], cardQtys: { [OTHER_PRINTING.id]: 4 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase Charmeleon in Fire deck' }));
    await waitFor(() => expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBe(1));
    expect(await screen.findByText(/more than the 4-copy limit/)).toBeInTheDocument();
  });

  it('does not warn for basic Energy over 4 copies', async () => {
    const energy = makeCard({ id: 'sv03-090', name: 'Fire Energy', supertype: 'Energy', subtypes: ['Basic'] });
    seedDecks([deck({ cards: [energy.id], cardQtys: { [energy.id]: 4 } })]);
    renderWithProviders(<AddToList card={energy} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase Fire Energy in Fire deck' }));
    await waitFor(() => expect(memory.lists[0].cardQtys[energy.id]).toBe(5));
    expect(screen.queryByText(/4-copy limit/)).not.toBeInTheDocument();
  });

  it('queues rapid increment clicks so every click lands, even while the backend is slow', async () => {
    seedDecks([deck({ cards: [CANDIDATE.id], cardQtys: { [CANDIDATE.id]: 0 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    const increase = screen.getByRole('button', { name: 'Increase Charmeleon in Fire deck' });

    // Gate the backend call so several clicks fire before any one of them resolves.
    const original = memory.setListCardQty.bind(memory);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(memory, 'setListCardQty').mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });

    // All five native clicks are dispatched inside one `act` batch, so React doesn't re-render
    // (and the component doesn't see an updated `deck` prop) between any of them — this is what
    // exposed the original bug, where every click's "next" was computed from the same stale qty.
    act(() => {
      increase.click();
      increase.click();
      increase.click();
      increase.click();
      increase.click();
    });
    release();

    await waitFor(() => expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBe(5));
  });

  it('queues rapid decrement clicks down to zero and removes the card', async () => {
    seedDecks([deck({ cards: [CANDIDATE.id], cardQtys: { [CANDIDATE.id]: 3 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    const decrease = screen.getByRole('button', { name: 'Decrease Charmeleon in Fire deck' });

    const original = memory.removeFromList.bind(memory);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(memory, 'removeFromList').mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });

    act(() => {
      decrease.click();
      decrease.click();
      decrease.click();
      decrease.click();
    });
    release();

    await waitFor(() => expect(memory.lists[0].cards).not.toContain(CANDIDATE.id));
    expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBeUndefined();
  });

  it('caps queued rapid increment clicks at 60', async () => {
    seedDecks([deck({ cards: [CANDIDATE.id], cardQtys: { [CANDIDATE.id]: 58 } })]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    const increase = screen.getByRole('button', { name: 'Increase Charmeleon in Fire deck' });

    const original = memory.setListCardQty.bind(memory);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(memory, 'setListCardQty').mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });

    act(() => {
      increase.click();
      increase.click();
      increase.click();
      increase.click();
      increase.click();
    });
    release();

    await waitFor(() => expect(memory.lists[0].cardQtys[CANDIDATE.id]).toBe(60));
  });

  it('keeps plain-list toggle behaviour unchanged when decks are also present', async () => {
    const plain: CustomList = { id: 'l1', name: 'Trade binder', description: undefined, createdAt: '2025-01-01', updatedAt: '2025-01-01', cards: [], kind: 'list', cardQtys: {} };
    seedDecks([plain, deck()]);
    renderWithProviders(<AddToList card={CANDIDATE} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    const checkbox = screen.getByRole('checkbox', { name: /Trade binder/ });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(checkbox);
    await waitFor(() => expect(memory.lists.find((l) => l.id === 'l1')!.cards).toEqual([CANDIDATE.id]));
    expect(screen.getByRole('checkbox', { name: /Trade binder/ })).toHaveAttribute('aria-checked', 'true');
  });
});
