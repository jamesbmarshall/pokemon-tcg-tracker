import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fromScryfall } from '@poketracker/shared/tcg/scryfall';
import { magicModule } from '@poketracker/shared/tcg/registry';
import type { GameState } from '@poketracker/shared/tcg/types';
import { GameContext, type GameContextValue } from './context';
import { GameCard } from './CardPage';
import { gameApi } from './api';
import { renderWithProviders } from '../test/render';

vi.mock('../hooks/useMoney', () => ({
  useMoney: () => (n?: number) => (n == null ? '—' : `$${n.toFixed(2)}`),
  useFx: () => ({
    rates: { USD: 1, GBP: 1, EUR: 1 },
    currency: 'USD',
    rate: 1,
  }),
}));
vi.mock('../api/http', () => ({
  api: vi.fn(async (path: string) =>
    path.endsWith('/prices')
      ? [
          {
            date: '2026-10-01',
            finish: 'nonfoil',
            source: 'tcgplayer',
            currency: 'USD',
            price: 2,
          },
          {
            date: '2026-10-02',
            finish: 'nonfoil',
            source: 'tcgplayer',
            currency: 'USD',
            price: 3,
          },
        ]
      : path === '/api/integrations'
        ? { pricecharting: { configured: false } }
        : [],
  ),
}));
const card = fromScryfall({
  id: 'sol',
  name: 'Sol Ring',
  set: 'tst',
  set_name: 'Fixture set',
  collector_number: '2',
  lang: 'en',
  finishes: ['nonfoil', 'foil'],
  artist: 'Test Artist',
  type_line: 'Artifact',
  mana_cost: '{1}',
  oracle_text: '{T}: Add {C}{C}.',
  prices: { usd: '3', usd_foil: '6' },
  legalities: { commander: 'legal' },
  games: ['paper'],
});
const before = { ...card, id: 'mtg:before', number: '1', name: 'Before' };
const after = { ...card, id: 'mtg:after', number: '3', name: 'After' };
const initial: GameState = {
  game: 'mtg',
  role: 'owner',
  revision: 1,
  cards: [card],
  entries: [
    {
      id: `${card.id}::nonfoil`,
      cardId: card.id,
      finish: 'nonfoil',
      quantity: 2,
      condition: 'NM',
      paid: { amount: 1, currency: 'USD' },
      valueUsd: 4,
      addedAt: '',
    },
  ],
  graded: [],
  notes: [],
  wishlist: [],
  lists: [],
  sealed: [],
  history: [],
};
function renderCard(patch: Partial<GameContextValue> = {}) {
  const ctx: GameContextValue = {
    module: magicModule,
    state: initial,
    collectionId: 'test',
    readOnly: false,
    busy: false,
    language: 'en',
    setLanguage: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    ...patch,
  };
  return {
    ctx,
    ...renderWithProviders(
      <GameContext.Provider value={ctx}>
        <GameCard id={card.id} />
      </GameContext.Provider>,
      { route: `/mtg/card/${card.id}` },
    ),
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(gameApi, 'card').mockResolvedValue(card);
  vi.spyOn(gameApi, 'set').mockResolvedValue({
    cards: [after, card, before],
    complete: true,
  });
  vi.spyOn(gameApi, 'sets').mockResolvedValue([
    {
      game: 'mtg',
      id: card.setId,
      providerId: 'tst',
      code: 'tst',
      name: card.setName,
      releaseDate: '2026-01-01',
      total: 3,
      type: 'expansion',
    },
  ]);
  vi.spyOn(gameApi, 'search').mockResolvedValue({
    cards: [],
    total: 0,
    hasMore: false,
  });
});
describe('Magic card detail adapter', () => {
  it('uses the shared page hierarchy with collecting before card text', async () => {
    const { container } = renderCard();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sol Ring' }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-card-columns] > [data-card-artwork]'),
    ).toBeInTheDocument();
    const content = container.querySelector('[data-card-content]')!;
    const sections = [...content.children];
    expect(sections[0]).toHaveAttribute('data-card-identity');
    expect(sections[1]).toHaveAttribute('data-card-collection');
    expect(sections[2]).toHaveAttribute('data-card-graded');
    expect(
      within(sections[3] as HTMLElement).getByRole('heading', {
        name: 'Notes',
      }),
    ).toBeInTheDocument();
    expect(sections[4]).toHaveAttribute('data-card-market');
    expect(sections[5]).toHaveAttribute('data-card-text');
    expect(
      within(sections[1] as HTMLElement).getByText(/2 copies/),
    ).toHaveTextContent('$8.00');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Show price history' }),
      ).toBeInTheDocument(),
    );
  });
  it('adds the chosen finish and edits copy condition using the same compact controls', async () => {
    const { ctx } = renderCard();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Foil copy' }),
    );
    expect(ctx.save).toHaveBeenLastCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          cardId: card.id,
          finish: 'foil',
          quantity: 1,
        }),
      }),
    ]);
    await userEvent.selectOptions(
      screen.getByLabelText('Condition of Normal copy'),
      'LP',
    );
    expect(ctx.save).toHaveBeenLastCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 2,
          condition: 'LP',
          valueUsd: 4,
          paid: { amount: 1, currency: 'USD' },
        }),
      }),
    ]);
  });
  it('browses the actual language-specific set in collector-number order', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('2/3')).toBeInTheDocument());
    expect(gameApi.set).toHaveBeenCalledWith('mtg', card.setId, 'en');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/mtg/card/mtg%3Aafter',
    );
  });
  it('autosaves notes and keeps a failed draft visible', async () => {
    const { ctx } = renderCard({ save: vi.fn().mockResolvedValue(false) });
    await userEvent.type(
      screen.getByLabelText('Notes about this card'),
      'At the card fair',
    );
    fireEvent.blur(screen.getByLabelText('Notes about this card'));
    await waitFor(() =>
      expect(ctx.save).toHaveBeenCalledWith([
        {
          kind: 'note',
          id: card.id,
          data: { id: card.id, text: 'At the card fair' },
        },
      ]),
    );
    expect(screen.getByLabelText('Notes about this card')).toHaveValue(
      'At the card fair',
    );
    expect(
      screen.queryByText('Saved', { exact: true }),
    ).not.toBeInTheDocument();
  });
  it('keeps the collection summary and notes visible for viewers without editing controls', () => {
    renderCard({
      readOnly: true,
      state: {
        ...initial,
        role: 'viewer',
        notes: [{ id: card.id, text: 'A shared note' }],
      },
    });
    expect(screen.getByText('A shared note')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Add|Wishlist|Lists|Remove/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('preserves slab metadata and identity when editing the grade', async () => {
    const slab = {
      id: 'slab',
      cardId: card.id,
      finish: 'nonfoil',
      company: 'PSA',
      grade: '9',
      countsTowardSet: true,
      addedAt: '2025-01-01',
      paid: { amount: 20, currency: 'USD' as const },
      notes: 'Keep me',
      pcProductId: '123',
    };
    const { ctx } = renderCard({ state: { ...initial, graded: [slab] } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit PSA 9' }));
    await userEvent.clear(screen.getByLabelText('Grade'));
    await userEvent.type(screen.getByLabelText('Grade'), '10');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Save details',
      }),
    );
    expect(ctx.save).toHaveBeenLastCalledWith([
      {
        kind: 'graded',
        id: 'slab',
        data: expect.objectContaining({ ...slab, grade: '10' }),
      },
    ]);
  });
});
