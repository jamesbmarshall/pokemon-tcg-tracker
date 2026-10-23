import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { magicModule } from '@poketracker/shared/tcg/registry';
import { fromScryfall } from '@poketracker/shared/tcg/scryfall';
import { holdingId } from '@poketracker/shared/tcg/collection';
import type { PreconDetail } from '@poketracker/shared/tcg/precons';
import { renderWithProviders } from '../test/render';
import { GameContext, type GameContextValue } from './context';
import { gameApi } from './api';
import { GameSearch } from './Views';
import { PreconPage } from './Precons';
const leader = fromScryfall({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Morska',
  lang: 'en',
  set: 'mkc',
  set_name: 'MKC',
  collector_number: '3',
  games: ['paper'],
  finishes: ['foil'],
});
const forest = {
  ...leader,
  id: 'mtg:33333333-3333-4333-8333-333333333333',
  providerId: '33333333-3333-4333-8333-333333333333',
  name: 'Forest',
  finishes: ['nonfoil', 'foil'],
};
const deck: PreconDetail = {
  id: 'DeepClueSea_MKC',
  game: 'mtg',
  name: 'Deep Clue Sea',
  setCode: 'MKC',
  releaseDate: '2024-02-09',
  format: 'commander',
  total: 100,
  cards: [
    {
      name: 'Morska',
      providerId: leader.providerId,
      quantity: 1,
      zone: 'commander',
      setCode: 'MKC',
      number: '3',
      finish: 'foil',
    },
    {
      name: 'Forest',
      providerId: forest.providerId,
      quantity: 99,
      zone: 'main',
      setCode: 'MKC',
      number: '10',
      finish: 'nonfoil',
    },
  ],
  attribution: 'Decklists from MTGJSON',
  catalogueUrl: 'https://mtgjson.com/',
};
const items = [
  { cardId: leader.id, quantity: 1, zone: 'commander' as const },
  { cardId: forest.id, quantity: 99, zone: 'main' as const },
];
function renderGame(
  ui: React.ReactElement,
  patch: Partial<GameContextValue> = {},
  route = '/mtg/search',
) {
  const ctx: GameContextValue = {
    module: magicModule,
    state: {
      game: 'mtg',
      role: 'owner',
      revision: 1,
      cards: [],
      entries: [],
      wishlist: [],
      notes: [],
      graded: [],
      sealed: [],
      lists: [],
      history: [],
    },
    collectionId: 'test',
    readOnly: false,
    busy: false,
    language: 'en',
    setLanguage: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn(),
    reload: vi.fn(),
    ...patch,
  };
  return {
    ctx,
    ...renderWithProviders(
      <GameContext.Provider value={ctx}>{ui}</GameContext.Provider>,
      { route },
    ),
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(gameApi, 'search').mockResolvedValue({
    cards: [],
    total: 0,
    hasMore: false,
  });
  vi.spyOn(gameApi, 'precons').mockResolvedValue({
    decks: [deck],
    stale: false,
  });
  vi.spyOn(gameApi, 'precon').mockResolvedValue(deck);
  vi.spyOn(gameApi, 'preconCards').mockResolvedValue({
    cards: [leader, forest],
    items,
    unresolved: [],
  });
});
describe('precon browsing', () => {
  it('switches a card-name search to precons without losing the query', async () => {
    renderGame(<GameSearch />, {}, '/mtg/search?q=Deep+Clue+Sea');
    await userEvent.click(screen.getByRole('radio', { name: 'Precons' }));
    expect(
      await screen.findByRole('heading', { name: 'Search precons' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: /Deep Clue Sea/ }),
    ).toHaveAttribute('href', '/mtg/precons/DeepClueSea_MKC');
    expect(gameApi.precons).toHaveBeenCalledWith('mtg', 'Deep Clue Sea');
    expect(screen.getByLabelText('Precon name or set')).toHaveValue(
      'Deep Clue Sea',
    );
  });
  it('offers a precon search when a card search finds no results', async () => {
    renderGame(<GameSearch />, {}, '/mtg/search?q=Deep+Clue+Sea');
    expect(
      await screen.findByRole('link', { name: /Search precons for this name/ }),
    ).toHaveAttribute('href', '/mtg/search?tab=precons&q=Deep+Clue+Sea');
  });
  it('previews the deck and saves only a deck record with all quantities and zones', async () => {
    const { ctx } = renderGame(<PreconPage id={deck.id} />);
    expect(
      await screen.findByRole('heading', { name: 'Deep Clue Sea' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/100 cards/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save as deck' }));
    await screen.findByText('All 100 cards resolved · ready to save');
    await userEvent.click(screen.getByRole('button', { name: 'Save deck' }));
    expect(ctx.save).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'list',
        data: expect.objectContaining({
          name: 'Deep Clue Sea',
          format: 'commander',
          kind: 'deck',
          items,
        }),
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/mtg/lists/'),
    );
  });
  it('blocks incomplete printings and leaves the deck unsaved', async () => {
    vi.mocked(gameApi.preconCards).mockResolvedValue({
      cards: [leader],
      items: [items[0]],
      unresolved: [deck.cards[1]],
    });
    const { ctx } = renderGame(<PreconPage id={deck.id} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save as deck' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Forest');
    expect(screen.getByRole('button', { name: 'Save deck' })).toBeDisabled();
    expect(ctx.save).not.toHaveBeenCalled();
  });
  it('keeps the named draft open after a failed save', async () => {
    renderGame(<PreconPage id={deck.id} />, {
      save: vi.fn().mockResolvedValue(false),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save as deck' }),
    );
    await screen.findByText('All 100 cards resolved · ready to save');
    await userEvent.clear(screen.getByLabelText('Deck name'));
    await userEvent.type(screen.getByLabelText('Deck name'), 'My clue deck');
    await userEvent.click(screen.getByRole('button', { name: 'Save deck' }));
    expect(
      within(screen.getByRole('dialog')).getByLabelText('Deck name'),
    ).toHaveValue('My clue deck');
  });
  it('adds all cards with their finishes and quantities, preserving existing holdings', async () => {
    const existing = {
      id: holdingId(forest.id, 'nonfoil'), cardId: forest.id,
      finish: 'nonfoil', quantity: 2, condition: 'LP',
      notes: 'Already owned', addedAt: '2024-01-01T00:00:00.000Z',
    };
    const { ctx } = renderGame(<PreconPage id={deck.id} />);
    ctx.state.entries = [existing];
    await userEvent.click(await screen.findByRole('button', { name: 'I own this precon' }));
    await screen.findByText('All 100 cards resolved · ready to save');
    await userEvent.click(screen.getByRole('button', { name: 'Add cards to collection' }));
    expect(ctx.save).toHaveBeenCalledWith([
      { kind: 'entry', id: holdingId(leader.id, 'foil'), data: expect.objectContaining({
        cardId: leader.id, finish: 'foil', quantity: 1,
      }) },
      { kind: 'entry', id: existing.id, data: { ...existing, quantity: 101 } },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('blocks a collection import when printings are incomplete', async () => {
    vi.mocked(gameApi.preconCards).mockResolvedValue({
      cards: [leader], items: [items[0]], unresolved: [deck.cards[1]],
    });
    const { ctx } = renderGame(<PreconPage id={deck.id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'I own this precon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forest');
    expect(screen.getByRole('button', { name: 'Add cards to collection' })).toBeDisabled();
    expect(ctx.save).not.toHaveBeenCalled();
  });
  it('blocks a collection import when a published finish is unavailable', async () => {
    vi.mocked(gameApi.preconCards).mockResolvedValue({
      cards: [leader, { ...forest, finishes: ['foil'] }], items, unresolved: [],
    });
    const { ctx } = renderGame(<PreconPage id={deck.id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'I own this precon' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Add cards to collection' })).toBeDisabled();
    expect(ctx.save).not.toHaveBeenCalled();
  });
  it('keeps the collection import open after a failed save', async () => {
    const { ctx } = renderGame(<PreconPage id={deck.id} />, {
      save: vi.fn().mockResolvedValue(false),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'I own this precon' }));
    await screen.findByText('All 100 cards resolved · ready to save');
    await userEvent.click(screen.getByRole('button', { name: 'Add cards to collection' }));
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('lets viewers browse without offering a collection write', async () => {
    renderGame(<PreconPage id={deck.id} />, { readOnly: true });
    await screen.findByRole('heading', { name: 'Deep Clue Sea' });
    expect(screen.queryByRole('button', { name: 'I own this precon' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save as deck' }),
    ).not.toBeInTheDocument();
  });
});
