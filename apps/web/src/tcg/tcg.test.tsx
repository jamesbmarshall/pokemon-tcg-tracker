import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { GameContext, type GameContextValue } from './context';
import { magicModule } from '@poketracker/shared/tcg/registry';
import { fromScryfall } from '@poketracker/shared/tcg/scryfall';
import { TcgCardTile } from './Cards';
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
      screen.getByRole('button', { name: 'Create list' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Create.*deck/ }),
    ).not.toBeInTheDocument();
  });
  it('saves an incomplete Commander deck instead of blocking it on legality', async () => {
    const ctx = context();
    renderWithProviders(
      <GameContext.Provider value={ctx}>
        <DecksPage />
      </GameContext.Provider>,
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
