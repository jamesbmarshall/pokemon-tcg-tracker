import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListPage, ListsPage } from './ListsPage';
import AddToList from '../components/AddToList';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeSnapshot } from '../test/fixtures';
import { memory } from '../test/memoryBackend';
import { useCollectionStore } from '../store/collectionStore';
import { useToasts } from '../store/toastStore';
import type { CustomList } from '../api/backend';

const A = makeSnapshot({ id: 'sv03-001', name: 'Charmander', prices: { normal: 2 } });
const B = makeSnapshot({ id: 'sv03-004', name: 'Charmeleon', prices: { normal: 4 } });
const C = makeSnapshot({ id: 'sv03-006', name: 'Charizard', prices: { holofoil: 40 } });

const list = (over: Partial<CustomList> = {}): CustomList => ({ id: 'l1', name: 'Fire deck', description: 'Burn it all', createdAt: '2025-01-01', updatedAt: '2025-01-01', cards: [A.id, B.id, C.id], ...over });

function seedLists(lists: CustomList[]) {
  seedCollection({ cards: [A, B, C] });
  useCollectionStore.setState({ lists });
  memory.lists = lists.map((l) => ({ ...l, cards: [...l.cards] }));
}

const tileNames = () => screen.getAllByRole('button', { name: /Remove .* from list/ }).map((b) => b.getAttribute('aria-label')!.replace(/^Remove (.*) from list$/, '$1'));
const lastLocation = () => screen.getAllByTestId('location').at(-1)!.textContent;

beforeEach(async () => {
  await resetStores();
});

describe('ListsPage', () => {
  it('explains lists when there are none', () => {
    seedLists([]);
    renderWithProviders(<ListsPage />);
    expect(screen.getByRole('heading', { name: 'No lists yet' })).toBeInTheDocument();
  });

  it('shows each list with its card count and value', () => {
    seedLists([list(), list({ id: 'l2', name: 'To grade', description: undefined, cards: [] })]);
    renderWithProviders(<ListsPage />);
    const fire = screen.getByRole('link', { name: /Fire deck/ });
    expect(fire).toHaveAttribute('href', '/lists/l1');
    // $2 + $4 + $40 = $46 → £23.00
    expect(fire).toHaveTextContent('3 cards · £23.00');
    expect(screen.getByRole('link', { name: /To grade/ })).toHaveTextContent('0 cards');
  });

  it('creates a list and opens it', async () => {
    seedLists([]);
    renderWithProviders(<ListsPage />);
    await userEvent.click(screen.getByRole('button', { name: /New list/ }));
    const dialog = screen.getByRole('dialog', { name: 'New list' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the list a name');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Trade binder');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    await waitFor(() => expect(memory.lists.map((l) => l.name)).toEqual(['Trade binder']));
    expect(lastLocation()).toBe(`/lists/${memory.lists[0].id}`);
  });

  it('has no create button when read-only', () => {
    seedLists([list()]);
    useCollectionStore.setState({ readOnly: true, role: 'viewer' });
    renderWithProviders(<ListsPage />);
    expect(screen.queryByRole('button', { name: /New list/ })).not.toBeInTheDocument();
  });
});

describe('ListPage', () => {
  const renderList = (id = 'l1') => renderWithProviders(<ListPage />, { route: `/lists/${id}`, path: '/lists/:listId' });

  it('shows the cards in list order', () => {
    seedLists([list()]);
    renderList();
    expect(screen.getByRole('heading', { name: 'Fire deck' })).toBeInTheDocument();
    expect(screen.getByText('Burn it all')).toBeInTheDocument();
    expect(tileNames()).toEqual(['Charmander', 'Charmeleon', 'Charizard']);
    expect(screen.getByRole('button', { name: 'Move Charmander earlier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Charizard later' })).toBeDisabled();
  });

  it('reorders cards and saves the order', async () => {
    seedLists([list()]);
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Move Charizard earlier' }));
    expect(tileNames()).toEqual(['Charmander', 'Charizard', 'Charmeleon']);
    await waitFor(() => expect(memory.lists[0].cards).toEqual([A.id, C.id, B.id]));
  });

  it('removes a card with undo', async () => {
    seedLists([list()]);
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Charmeleon from list' }));
    expect(tileNames()).toEqual(['Charmander', 'Charizard']);
    await waitFor(() => expect(memory.lists[0].cards).toEqual([A.id, C.id]));
    const toast = useToasts.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Removed Charmeleon from Fire deck');
    await toast.action!.run();
    await waitFor(() => expect(memory.lists[0].cards).toContain(B.id));
  });

  it('renames and deletes the list', async () => {
    seedLists([list()]);
    renderList();
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit list' });
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Blaze');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Blaze' })).toBeInTheDocument();
    await waitFor(() => expect(memory.lists[0].name).toBe('Blaze'));

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete list?' })).getByRole('button', { name: 'Delete list' }));
    await waitFor(() => expect(memory.lists).toEqual([]));
    expect(lastLocation()).toBe('/lists');
  });

  it('is view-only for viewers', () => {
    seedLists([list()]);
    useCollectionStore.setState({ readOnly: true, role: 'viewer' });
    renderList();
    expect(screen.getByRole('heading', { name: 'Fire deck' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit|Delete|Share|Remove|Move/ })).not.toBeInTheDocument();
  });

  it('says when the list is missing', () => {
    seedLists([]);
    renderList('nope');
    expect(screen.getByRole('heading', { name: 'List not found' })).toBeInTheDocument();
  });
});

describe('AddToList', () => {
  const card = makeCard({ id: 'sv03-004', name: 'Charmeleon' });

  it('ticks and unticks lists for the card', async () => {
    seedLists([list({ cards: [A.id] }), list({ id: 'l2', name: 'To grade', cards: [B.id] })]);
    renderWithProviders(<AddToList card={card} />);
    const button = screen.getByRole('button', { name: /Lists/ });
    expect(button).toHaveTextContent('1');
    await userEvent.click(button);
    const fire = screen.getByRole('checkbox', { name: /Fire deck/ });
    expect(fire).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /To grade/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(fire);
    expect(screen.getByRole('checkbox', { name: /Fire deck/ })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(memory.lists[0].cards).toEqual([A.id, B.id]));
    await userEvent.click(screen.getByRole('checkbox', { name: /To grade/ }));
    await waitFor(() => expect(memory.lists[1].cards).toEqual([]));
  });

  it('creates a new list with the card in it', async () => {
    seedLists([]);
    renderWithProviders(<AddToList card={card} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    expect(screen.getByRole('button', { name: 'Create list' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'New list name' }), 'Evolutions{Enter}');
    await waitFor(() => expect(memory.lists).toMatchObject([{ name: 'Evolutions', cards: ['sv03-004'] }]));
    expect(screen.getByRole('checkbox', { name: /Evolutions/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('closes on Escape', async () => {
    seedLists([]);
    renderWithProviders(<AddToList card={card} />);
    await userEvent.click(screen.getByRole('button', { name: /Lists/ }));
    expect(screen.getByRole('group', { name: 'Custom lists' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Custom lists' })).not.toBeInTheDocument();
  });
});
