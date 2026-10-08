import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeckView from './DeckView';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSnapshot } from '../test/fixtures';
import { memory } from '../test/memoryBackend';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';
import type { CustomList, DeckResolveResult } from '../api/backend';

const POKE = makeSnapshot({ id: 'sv03-001', name: 'Charmander', supertype: 'Pokémon', subtypes: ['Basic'], number: '1' });
const TRAINER = makeSnapshot({ id: 'sv03-050', name: 'Potion', supertype: 'Trainer', subtypes: ['Item'], number: '50' });
const ENERGY = makeSnapshot({ id: 'sv03-090', name: 'Fire Energy', supertype: 'Energy', subtypes: ['Basic'], number: '90' });
const NEWCARD = makeSnapshot({ id: 'sv03-099', name: 'Rare Candy', supertype: 'Trainer', subtypes: ['Item'], number: '99' });

const deck = (over: Partial<CustomList> = {}): CustomList => {
  const cards = over.cards ?? [POKE.id, TRAINER.id, ENERGY.id];
  return {
    id: 'd1',
    name: 'Fire deck',
    description: undefined,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    cards,
    kind: 'deck',
    format: 'standard',
    cardQtys: { [POKE.id]: 2, [TRAINER.id]: 1, [ENERGY.id]: 3 },
    ...over,
  };
};

function seedDeck(list: CustomList, opts: { cards?: typeof POKE[]; entries?: ReturnType<typeof makeEntry>[]; wishlist?: { cardId: string; addedAt: string }[] } = {}) {
  seedCollection({ cards: opts.cards ?? [POKE, TRAINER, ENERGY, NEWCARD], entries: opts.entries, wishlist: opts.wishlist });
  useCollectionStore.setState({ lists: [list] });
  memory.lists = [{ ...list, cards: [...list.cards] }];
}

/** Mirrors how ListPage reads the live list from the store, so store updates re-render DeckView. */
function DeckHarness({ listId }: { listId: string }) {
  const list = useCollectionStore((s) => s.lists.find((l) => l.id === listId));
  if (!list) return null;
  return <DeckView list={list} />;
}

const renderDeck = (listId = 'd1') => renderWithProviders(<DeckHarness listId={listId} />);

beforeEach(async () => {
  await resetStores();
});

describe('DeckView', () => {
  it('groups cards by supertype and supports quantity steppers, including removal at zero', async () => {
    seedDeck(deck());
    renderDeck();

    expect(screen.getByText('Pokémon · 2')).toBeInTheDocument();
    expect(screen.getByText('Trainer · 1')).toBeInTheDocument();
    expect(screen.getByText('Energy · 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Increase Charmander' }));
    await waitFor(() => expect(memory.lists[0].cardQtys[POKE.id]).toBe(3));

    await userEvent.click(screen.getByRole('button', { name: 'Decrease Charmander' }));
    await waitFor(() => expect(memory.lists[0].cardQtys[POKE.id]).toBe(2));

    // Potion starts at qty 1: one decrease removes it from the deck entirely.
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Potion' }));
    await waitFor(() => expect(memory.lists[0].cards).not.toContain(TRAINER.id));
    expect(memory.lists[0].cardQtys[TRAINER.id]).toBeUndefined();
    expect(screen.queryByText('Potion')).not.toBeInTheDocument();
  });

  it('shows legality issues for a deck far short of 60 cards', () => {
    seedDeck(deck({ format: 'standard' }));
    renderDeck();
    const live = screen.getByText(/issue/).closest('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(screen.getByText(/Deck has 6 cards; it must have exactly 60/)).toBeInTheDocument();
  });

  it('shows a legal state for a deck built to pass under Unlimited', () => {
    const basicPoke = makeSnapshot({ id: 'sv03-basic', name: 'Basic Mon', supertype: 'Pokémon', subtypes: ['Basic'] });
    const trainers = Array.from({ length: 9 }, (_, i) => makeSnapshot({ id: `sv03-t${i}`, name: `Trainer ${i}`, supertype: 'Trainer', subtypes: ['Item'] }));
    const basicEnergy = makeSnapshot({ id: 'sv03-energy', name: 'Fire Energy', supertype: 'Energy', subtypes: ['Basic'] });
    const allCards = [basicPoke, ...trainers, basicEnergy];
    const cardQtys: Record<string, number> = { [basicPoke.id]: 4, [basicEnergy.id]: 20 };
    for (const t of trainers) cardQtys[t.id] = 4;
    // 4 (poke) + 9*4 (trainers) + 20 (energy) = 60
    const legalDeck = deck({ format: 'unlimited', cards: allCards.map((c) => c.id), cardQtys });
    seedDeck(legalDeck, { cards: allCards });
    renderDeck();
    expect(screen.getByText(/^Legal in Unlimited$/)).toBeInTheDocument();
  });

  it('renders owned vs needed and adds only the missing, not-already-wishlisted cards to the wishlist', async () => {
    const list = deck({ cards: [POKE.id, TRAINER.id, ENERGY.id], cardQtys: { [POKE.id]: 4, [TRAINER.id]: 2, [ENERGY.id]: 3 } });
    seedDeck(list, {
      entries: [makeEntry({ cardId: POKE.id, variant: 'normal', quantity: 2 }), makeEntry({ cardId: TRAINER.id, variant: 'normal', quantity: 2 })],
      wishlist: [{ cardId: ENERGY.id, addedAt: '2025-01-01T00:00:00.000Z' }],
    });
    renderDeck();

    expect(screen.getByText(/own 2, need 4 \(missing 2\)/)).toBeInTheDocument();
    expect(screen.getByText(/own 2, need 2/)).toBeInTheDocument();
    expect(screen.queryByText(/own 2, need 2 \(missing/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add missing to wishlist/ }));
    await waitFor(() => expect(useCollectionStore.getState().wishlist.has(POKE.id)).toBe(true));
    expect(useCollectionStore.getState().wishlist.has(TRAINER.id)).toBe(false);
    const toast = useToasts.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Added 1 card to your wishlist');
  });

  it('imports a decklist: preview separates resolved/unresolved, confirm sums quantities additively', async () => {
    const list = deck({ cards: [TRAINER.id], cardQtys: { [TRAINER.id]: 1 } });
    seedDeck(list);
    const resolveResult: DeckResolveResult = {
      resolved: [
        { raw: '2 Potion SV3 50', qty: 2, name: 'Potion', setCode: 'SV3', number: '50', section: 'Trainer', card: TRAINER },
        { raw: '2 Potion SV3 50', qty: 2, name: 'Potion', setCode: 'SV3', number: '50', section: 'Trainer', card: TRAINER },
        { raw: '3 Rare Candy SV3 99', qty: 3, name: 'Rare Candy', setCode: 'SV3', number: '99', section: 'Trainer', card: NEWCARD },
      ],
      unresolved: [{ raw: '4 Unknown Card ZZZ 999', qty: 4, name: 'Unknown Card', section: 'Unknown' }],
    };
    memory.resolveDeckText = async () => resolveResult;

    renderDeck();
    await userEvent.click(screen.getByRole('button', { name: /Import deck/ }));
    const dialog = screen.getByRole('dialog', { name: 'Import deck' });
    expect(within(dialog).getByRole('button', { name: 'Preview' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Paste PTCGL/), 'anything, mocked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));

    expect(await within(dialog).findByText("1 line couldn't be matched:")).toBeInTheDocument();
    expect(within(dialog).getByText('4 Unknown Card ZZZ 999')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Potion').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Rare Candy')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to deck' }));
    // Potion: existing 1 + (2 + 2) imported = 5. Rare Candy: 0 + 3 = 3.
    await waitFor(() => expect(memory.lists[0].cardQtys[TRAINER.id]).toBe(5));
    expect(memory.lists[0].cardQtys[NEWCARD.id]).toBe(3);
  });

  it('copies the deck as PTCGL text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    seedDeck(deck());
    renderDeck();
    await userEvent.click(screen.getByRole('button', { name: /Copy as text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('Pokémon: 2');
    expect(text).toContain('Trainer: 1');
    expect(text).toContain('Energy: 3');
    const toast = useToasts.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Copied deck list');
  });
});
