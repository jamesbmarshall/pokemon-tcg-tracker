import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { GameContext, type GameContextValue } from './context';
import { magicModule } from '@poketracker/shared/tcg/registry';
import { fromScryfall } from '@poketracker/shared/tcg/scryfall';
import { TcgCardTile, HoldingForm } from './Cards';
import { GameSearch } from './Views';
import { gameApi } from './api';
import { DecksPage } from './Decks';
import { GamePublicView } from './GamePage';
import type { GameState } from '@poketracker/shared/tcg/types';
vi.mock('../hooks/useMoney', () => ({
  useMoney: () => (n: number) => `USD ${n ?? 0}`,
}));
const card = fromScryfall({
  id: 'test',
  oracle_id: 'oracle',
  name: 'Card',
  lang: 'ja',
  set: 'tst',
  set_name: 'Set',
  collector_number: '1',
  games: ['paper'],
  finishes: ['nonfoil', 'foil'],
  type_line: 'Legendary Creature',
  legalities: { commander: 'legal' },
  color_identity: [],
  colors: [],
  cmc: 1,
});
const state: GameState = {
  game: 'mtg',
  role: 'owner',
  revision: 0,
  cards: [card],
  entries: [],
  graded: [],
  sealed: [],
  wishlist: [],
  notes: [],
  lists: [],
  history: [],
};
function context(patch: Partial<GameContextValue> = {}): GameContextValue {
  return {
    module: magicModule,
    state,
    collectionId: 'test-collection',
    readOnly: false,
    busy: false,
    language: 'en',
    setLanguage: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    ...patch,
  };
}
describe('shared game UI', () => {
  it('collects the selected finish of the exact language-specific printing', async () => {
    const ctx = context();
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <TcgCardTile card={card} />
      </GameContext.Provider>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Add foil Card' }),
    );
    expect(ctx.save).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'entry',
        data: expect.objectContaining({
          cardId: 'mtg:test',
          finish: 'foil',
          quantity: 1,
        }),
      }),
    ]);
  });
  it('removes all editing controls for a read-only share', () => {
    const ctx = context({ readOnly: true });
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <TcgCardTile card={card} />
      </GameContext.Provider>,
    );
    expect(
      screen.queryByRole('button', { name: /Add|wishlist/i }),
    ).not.toBeInTheDocument();
  });
  it('hides unsupported deck creation for another registered game', () => {
    const ctx = context({
      module: {
        ...magicModule,
        id: 'example',
        name: 'Example',
        capabilities: {
          decks: false,
          graded: false,
          sealed: false,
          scanning: false,
        },
        formats: [],
        deckTools: undefined,
      },
    });
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <DecksPage />
      </GameContext.Provider>,
    );
    expect(
      screen.getByRole('button', { name: 'New list' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /New.*deck/ }),
    ).not.toBeInTheDocument();
  });
  it('saves an incomplete Commander deck instead of blocking it on legality', async () => {
    const ctx = context();
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <DecksPage />
      </GameContext.Provider>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'New Commander deck' }),
    );
    await userEvent.type(screen.getByLabelText('List or deck name'), 'Draft');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create Commander deck' }),
    );
    expect(ctx.save).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Draft',
          format: 'commander',
          items: [],
        }),
      }),
    ]);
  });
  it('keeps copy details in the dialog when a save fails', async () => {
    const ctx = context({ save: vi.fn().mockResolvedValue(false) });
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <HoldingForm card={card} finish="foil" />
      </GameContext.Provider>,
    );
    expect(screen.queryByLabelText('Paid per copy')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Edit details/ }));
    await userEvent.type(screen.getByLabelText('Paid per copy'), '12.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Paid per copy')).toHaveValue(12.5);
  });
  it('does not remove a wishlist card if collecting it fails', async () => {
    const ctx = context({ save: vi.fn().mockResolvedValue(false) });
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <TcgCardTile card={card} wishlist />
      </GameContext.Provider>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Got it · add to collection' }),
    );
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.remove).not.toHaveBeenCalled();
  });
  it('searches after typing and retains the query in the URL', async () => {
    const search = vi
      .spyOn(gameApi, 'search')
      .mockResolvedValue({ cards: [card], hasMore: false, total: 1 });
    renderWithProviders(
      <GameContext.Provider value={context()}>
        <GameSearch />
      </GameContext.Provider>,
    );
    expect(search).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Name or query'), 'Sol Ring');
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        'mtg',
        expect.objectContaining({ q: 'Sol Ring', language: 'en', page: 1 }),
      ),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('q=Sol+Ring');
    search.mockRestore();
  });
  it('saves a deck quantity once the field loses focus', async () => {
    const list = {
      id: 'draft',
      game: 'mtg',
      name: 'Draft',
      kind: 'deck' as const,
      format: 'commander',
      items: [{ cardId: card.id, zone: 'main' as const, quantity: 1 }],
      addedAt: '',
    };
    const ctx = context({ state: { ...state, lists: [list] } });
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <DecksPage listId="draft" />
      </GameContext.Provider>,
    );
    const input = screen.getByLabelText('Quantity of Card');
    await userEvent.clear(input);
    await userEvent.type(input, '12');
    expect(ctx.save).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.save).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          items: [expect.objectContaining({ quantity: 12 })],
        }),
      }),
    ]);
  });
  it('renders shared Magic deck quantities without exposing write controls', () => {
    const list = {
      id: 'deck',
      game: 'mtg',
      name: 'Shared deck',
      kind: 'deck' as const,
      format: 'commander',
      items: [{ cardId: card.id, zone: 'commander' as const, quantity: 1 }],
      addedAt: '',
    };
    renderWithProviders(
      <GamePublicView
        data={{
          ...state,
          role: 'viewer',
          lists: [list],
          share: {
            game: 'mtg',
            scope: 'list',
            target: 'deck',
            title: null,
            ownerName: 'Owner',
            hideValue: true,
            hidePaid: true,
            hideNotes: true,
          },
        }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Shared deck' }),
    ).toBeInTheDocument();
    expect(screen.getByText('commander · 1 × Card')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Add|Save/ }),
    ).not.toBeInTheDocument();
  });
});
