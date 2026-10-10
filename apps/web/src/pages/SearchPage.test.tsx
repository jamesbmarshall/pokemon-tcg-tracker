import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchPage from './SearchPage';
import { renderWithProviders } from '../test/render';
import { errorResult, queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeCard } from '../test/fixtures';
import type { SearchFilters } from '../api/client';
import type { PokemonCard } from '../api/types';

const mocks = vi.hoisted(() => ({ useSearch: vi.fn(), useRarities: vi.fn() }));
vi.mock('../api/hooks', () => ({ useSearch: mocks.useSearch, useRarities: mocks.useRarities }));

function pages(cards: PokemonCard[], totalCount = cards.length) {
  return { pages: [{ data: cards, page: 1, pageSize: 30, totalCount }], pageParams: [1] };
}
function searchResult(data: unknown, over: Record<string, unknown> = {}) {
  return { ...queryResult(data), fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false, ...over };
}
const lastCall = () => mocks.useSearch.mock.calls.at(-1) as [SearchFilters, boolean];
const location = () => screen.getByTestId('location').textContent;
const renderPage = (route = '/search') => renderWithProviders(<SearchPage />, { route, path: '/search' });

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  mocks.useRarities.mockReturnValue(queryResult(['Common', 'Rare Holo']));
  mocks.useSearch.mockReturnValue(searchResult(undefined));
});

describe('SearchPage', () => {
  it('shows popular suggestions and disables the query without input', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText(/Type at least two letters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charizard' })).toBeInTheDocument();
    expect(lastCall()[1]).toBe(false);
    expect(screen.getByPlaceholderText(/Card name/)).toHaveFocus();
  });

  it('does not search for a single letter', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Card name/), 'P');
    await waitFor(() => expect(location()).toBe('/search?q=P'));
    expect(lastCall()[1]).toBe(false);
    expect(screen.getByText(/Type at least two letters/)).toBeInTheDocument();
  });

  it('debounces a suggestion into the URL and runs the search', async () => {
    mocks.useSearch.mockImplementation((_: SearchFilters, enabled: boolean) =>
      enabled ? searchResult(pages([makeCard({ name: 'Pikachu' }), makeCard({ id: 'sv03-002', name: 'Pikachu' })], 1234)) : searchResult(undefined),
    );
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Pikachu' }));
    expect(screen.getByPlaceholderText(/Card name/)).toHaveValue('Pikachu');
    await waitFor(() => expect(location()).toBe('/search?q=Pikachu'));
    expect(lastCall()).toEqual([{ name: 'Pikachu', artist: '', types: [], rarity: '', supertype: '', sort: 'newest', langs: ['en', 'ja'] }, true]);
    expect(screen.getByText('1,234 cards')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Pikachu .*not owned/ })).toHaveLength(2);
  });

  it('reads the query from the URL and clears it', async () => {
    mocks.useSearch.mockReturnValue(searchResult(pages([makeCard()])));
    renderPage('/search?q=Charm');
    expect(screen.getByPlaceholderText(/Card name/)).toHaveValue('Charm');
    expect(screen.getByText('1 cards')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByPlaceholderText(/Card name/)).toHaveValue('');
    await waitFor(() => expect(location()).toBe('/search'));
  });

  it('shows a spinner instead of Clear while fetching', () => {
    mocks.useSearch.mockReturnValue(searchResult(pages([makeCard()]), { isFetching: true }));
    renderPage('/search?q=Charm');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    mocks.useSearch.mockReturnValue(searchResult(undefined, { isLoading: true }));
    renderPage('/search?q=Charm');
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(/cards$/)).not.toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    const err = searchResult(undefined, errorResult('Rate limited'));
    mocks.useSearch.mockReturnValue(err);
    renderPage('/search?q=Charm');
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Rate limited');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(err.refetch).toHaveBeenCalled();
  });

  it('shows a no-results message', () => {
    mocks.useSearch.mockReturnValue(searchResult(pages([])));
    renderPage('/search?q=Zzzz');
    expect(screen.getByText(/No cards found/)).toBeInTheDocument();
  });

  it('coerces unknown sort params to newest', () => {
    renderPage('/search?q=Mew&sort=bogus');
    expect(lastCall()[0].sort).toBe('newest');
  });

  it.each(['oldest', 'name'] as const)('keeps the %s sort', (sort) => {
    renderPage(`/search?q=Mew&sort=${sort}`);
    expect(lastCall()[0].sort).toBe(sort);
  });

  it('keeps filters closed by default and opens them on demand', async () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Fire/ })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Fire/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('combobox', { name: 'Card type' }).closest('.grid')).toHaveClass('grid-cols-1');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('opens filters automatically when the URL has filter params', () => {
    renderPage('/search?types=Fire,Water&rarity=Common&supertype=Trainer&sort=name');
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: /Fire/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Rarity' })).toHaveValue('Common');
    expect(screen.getByRole('combobox', { name: 'Card type' })).toHaveValue('Trainer');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('name');
    expect(lastCall()).toEqual([{ name: '', artist: '', types: ['Fire', 'Water'], rarity: 'Common', supertype: 'Trainer', sort: 'name', langs: ['en', 'ja'] }, true]);
  });

  it('toggles energy types in the URL', async () => {
    renderPage('/search?types=Fire');
    await userEvent.click(screen.getByRole('button', { name: /Water/ }));
    expect(location()).toBe('/search?types=Fire%2CWater');
    await userEvent.click(screen.getByRole('button', { name: /Fire/ }));
    expect(location()).toBe('/search?types=Water');
    await userEvent.click(screen.getByRole('button', { name: /Water/ }));
    expect(location()).toBe('/search');
  });

  it('writes select filters to the URL and lists rarities', async () => {
    renderPage('/search?rarity=Common');
    expect(screen.getByRole('option', { name: 'Rare Holo' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Card type' }), 'Energy');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'oldest');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rarity' }), '');
    expect(location()).toBe('/search?supertype=Energy&sort=oldest');
  });

  it('debounces the illustrator filter', async () => {
    renderPage('/search?artist=Arita');
    const input = screen.getByPlaceholderText(/Mitsuhiro Arita/);
    expect(input).toHaveValue('Arita');
    await userEvent.clear(input);
    await userEvent.type(input, 'Sugimori');
    await waitFor(() => expect(location()).toBe('/search?artist=Sugimori'));
    expect(lastCall()[0].artist).toBe('Sugimori');
  });

  it('clears filters but keeps the name query', async () => {
    renderPage('/search?q=Mew&types=Fire&artist=Arita&sort=name');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/search?q=Mew');
    expect(screen.getByPlaceholderText(/Mitsuhiro Arita/)).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('loads the next page when the sentinel scrolls into view', () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof fire) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const res = searchResult(pages([makeCard()], 60), { hasNextPage: true });
    mocks.useSearch.mockReturnValue(res);
    renderPage('/search?q=Charm');
    fire([{ isIntersecting: false }]);
    expect(res.fetchNextPage).not.toHaveBeenCalled();
    fire([{ isIntersecting: true }]);
    expect(res.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not fetch another page while one is loading', () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof fire) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const res = searchResult(pages([makeCard()], 60), { hasNextPage: true, isFetchingNextPage: true, isFetching: true });
    mocks.useSearch.mockReturnValue(res);
    renderPage('/search?q=Charm');
    fire([{ isIntersecting: true }]);
    expect(res.fetchNextPage).not.toHaveBeenCalled();
    // The input keeps its Clear button because the spinner moves to the sentinel
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('searches English and Japanese by default, and remembers language choices', async () => {
    const first = renderPage();
    expect(lastCall()[0].langs).toEqual(['en', 'ja']);
    expect(screen.getByText('Searching English + Japanese')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Japanese' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Japanese' }));
    expect(lastCall()[0].langs).toEqual(['en']);
    expect(location()).toBe('/search?langs=en');
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(lastCall()[0].langs).toEqual(['en']);
    await userEvent.click(screen.getByRole('button', { name: 'French' }));
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(lastCall()[0].langs).toEqual(['fr']);
    expect(mocks.useRarities).toHaveBeenLastCalledWith('fr');
    expect(screen.getByPlaceholderText(/ピカチュウ/)).toBeInTheDocument();
    first.unmount();
    renderPage();
    expect(lastCall()[0].langs).toEqual(['fr']);
  });
});
