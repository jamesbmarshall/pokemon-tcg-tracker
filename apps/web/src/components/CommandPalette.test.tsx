import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommandPalette from './CommandPalette';
import { renderWithProviders } from '../test/render';
import { queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard, makeEntry, makeSet, makeSnapshot } from '../test/fixtures';

const mocks = vi.hoisted(() => ({ useSets: vi.fn(), searchCards: vi.fn() }));
vi.mock('../api/hooks', () => ({ useSets: mocks.useSets }));
vi.mock('../api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/client')>()), searchCards: mocks.searchCards }));

const SETS = [
  makeSet(),
  makeSet({ id: 'sv03.5', name: '151', ptcgoCode: 'MEW', releaseDate: '2023-09-22' }),
  makeSet({ id: 'base1', name: 'Base Set', series: 'Base', ptcgoCode: undefined, releaseDate: '1999-01-09' }),
];

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  mocks.useSets.mockReturnValue(queryResult(SETS));
  mocks.searchCards.mockResolvedValue({ data: [], page: 1, pageSize: 36, totalCount: 0 });
});

function setup(open = true) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  const utils = renderWithProviders(<CommandPalette open={open} onClose={onClose} />);
  return { onClose, user, ...utils };
}

const input = () => screen.getByPlaceholderText('Search cards and sets…');
const options = () => screen.getByRole('dialog').querySelectorAll<HTMLButtonElement>('button[data-idx]');

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    setup(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens focused with a scan shortcut and a hint', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(input()).toHaveFocus();
    expect(screen.getByText('Scan a card')).toBeInTheDocument();
    expect(screen.getByText(/Try “Charizard”/)).toBeInTheDocument();
  });

  it('navigates to the scan page when the scan shortcut is chosen', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByText('Scan a card'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/scan');
  });

  it('matches sets by name', async () => {
    const { user } = setup();
    await user.type(input(), 'obs');
    expect(screen.getByText('Obsidian Flames')).toBeInTheDocument();
    expect(screen.getByText('Scarlet & Violet · 2023')).toBeInTheDocument();
    expect(screen.queryByText('151')).not.toBeInTheDocument();
    expect(screen.getByText('Search all cards for “obs”')).toBeInTheDocument();
  });

  it('matches sets by exact code and by id', async () => {
    const { user } = setup();
    await user.type(input(), 'mew');
    expect(screen.getByText('151')).toBeInTheDocument();
    await user.clear(input());
    await user.type(input(), 'base1');
    expect(screen.getByText('Base Set')).toBeInTheDocument();
  });

  it('lists matching sets for a single character but no search action', async () => {
    const { user } = setup();
    await user.type(input(), '1');
    expect(screen.getByText('151')).toBeInTheDocument();
    expect(screen.queryByText(/Search all cards/)).not.toBeInTheDocument();
  });

  it('caps set matches at four', async () => {
    mocks.useSets.mockReturnValue(queryResult(Array.from({ length: 6 }, (_, i) => makeSet({ id: `s${i}`, name: `Shiny ${i}` }))));
    const { user } = setup();
    await user.type(input(), 'shiny');
    expect(screen.getAllByText(/^Shiny \d$/)).toHaveLength(4);
  });

  it('closes on Escape', async () => {
    const { user, onClose } = setup();
    await user.type(input(), '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked but not the dialog', () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('navigates to the active set on Enter', async () => {
    const { user, onClose } = setup();
    await user.type(input(), 'obs{Enter}');
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/sets/sv03');
  });

  it('moves the selection with the arrow keys', async () => {
    const { user } = setup();
    await user.type(input(), 'obs');
    expect(options()[0].className).toContain('bg-surface-2');
    await user.keyboard('{ArrowDown}');
    expect(options()[1].className).toContain('bg-surface-2');
    expect(options()[0].className).not.toContain('bg-surface-2');
    await user.keyboard('{ArrowDown}{ArrowDown}'); // clamped at the end
    expect(options()[1].className).toContain('bg-surface-2');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(options()[0].className).toContain('bg-surface-2');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=obs');
  });

  it('highlights on hover', async () => {
    const { user } = setup();
    await user.type(input(), 'obs');
    await user.hover(options()[1]);
    expect(options()[1].className).toContain('bg-surface-2');
  });

  it('encodes the query in the search action', async () => {
    const { user } = setup();
    await user.type(input(), 'mr. mime');
    await user.click(screen.getByText('Search all cards for “mr. mime”'));
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=mr.%20mime');
  });

  it('searches cards after a debounce and marks owned ones', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'sv03-125' })], cards: [makeSnapshot({ id: 'sv03-125' })] });
    mocks.searchCards.mockResolvedValue({
      data: [makeCard({ id: 'sv03-125', name: 'Charizard ex' }), makeCard({ id: 'sv03-004', name: 'Charmander' })],
      page: 1,
      pageSize: 36,
      totalCount: 2,
    });
    const { user, onClose } = setup();
    await user.type(input(), 'char');
    expect(await screen.findByText('Charizard ex')).toBeInTheDocument();
    expect(mocks.searchCards).toHaveBeenLastCalledWith({ name: 'char', sort: 'newest' }, 1, expect.anything());
    expect(screen.getByText('Obsidian Flames · #125')).toBeInTheDocument();
    expect(screen.getAllByText('Owned')).toHaveLength(1);
    await user.click(screen.getByText('Charmander'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/card/sv03-004');
  });

  it('does not search cards for a single character', async () => {
    const { user } = setup();
    await user.type(input(), 'c');
    await new Promise((r) => setTimeout(r, 300));
    expect(mocks.searchCards).not.toHaveBeenCalled();
  });

  it('works before the set list has loaded', async () => {
    mocks.useSets.mockReturnValue(queryResult(undefined, { isLoading: true }));
    const { user } = setup();
    await user.type(input(), 'ob');
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(screen.getByText('Search all cards for “ob”')).toBeInTheDocument();
  });
});
