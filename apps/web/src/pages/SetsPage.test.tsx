import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetsPage from './SetsPage';
import { renderWithProviders } from '../test/render';
import { errorResult, loadingResult, queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSet, makeSnapshot } from '../test/fixtures';

const mocks = vi.hoisted(() => ({ useSets: vi.fn() }));
vi.mock('../api/hooks', () => ({ useSets: mocks.useSets }));

const SETS = [
  makeSet(),
  makeSet({ id: 'sv02', name: 'Paldea Evolved', ptcgoCode: 'PAL', printedTotal: 193, total: 193 }),
  makeSet({ id: 'tiny', name: 'Tiny Promo', series: 'Base', printedTotal: 1, total: 1, ptcgoCode: undefined, releaseDate: '1999-07-01' }),
  makeSet({ id: 'base1', name: 'Base', series: 'Base', printedTotal: 102, total: 102, ptcgoCode: undefined, releaseDate: '1999-01-09' }),
];

const renderPage = (route = '/sets') => renderWithProviders(<SetsPage />, { route, path: '/sets' });
const location = () => screen.getByTestId('location').textContent;
const tiles = () => screen.queryAllByRole('link').map((l) => l.getAttribute('href'));
const tile = (id: string) => screen.getAllByRole('link').find((l) => l.getAttribute('href') === `/sets/${id}`)!;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection({
    entries: [makeEntry(), makeEntry({ cardId: 'sv03-223', variant: 'holofoil' }), makeEntry({ cardId: 'tiny-1' })],
    cards: [makeSnapshot(), makeSnapshot({ id: 'sv03-223' }), makeSnapshot({ id: 'tiny-1', setId: 'tiny', printedTotal: 1 })],
  });
  mocks.useSets.mockReturnValue(queryResult(SETS));
});

describe('SetsPage', () => {
  it('shows a loading state', () => {
    mocks.useSets.mockReturnValue(loadingResult());
    renderPage();
    expect(screen.getByText('Loading catalogue')).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(12);
    expect(screen.queryByText('No sets match.')).not.toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    const err = errorResult('Offline');
    mocks.useSets.mockReturnValue(err);
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sets");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(err.refetch).toHaveBeenCalled();
  });

  it('groups sets by series with counts', () => {
    renderPage();
    expect(screen.getByText('4 sets · 2 series')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Scarlet & Violet', 'Base']);
    expect(headings[0].nextElementSibling).toHaveTextContent('2 sets');
    expect(tiles()).toEqual(['/sets/sv03', '/sets/sv02', '/sets/tiny', '/sets/base1']);
    expect(tile('sv03').parentElement).toHaveClass('grid-cols-1');
  });

  it('shows totals, secret counts and progress on tiles', () => {
    renderPage();
    const sv03 = tile('sv03');
    expect(within(sv03).getByText('OBF')).toBeInTheDocument();
    expect(sv03).toHaveTextContent('11 Aug 2023 · 197+33');
    expect(sv03).toHaveTextContent('1/197');
    expect(within(sv03).getByTitle('Cards numbered above the printed set total')).toHaveTextContent('+1 secret');
    expect(within(sv03).getByText('0%')).toBeInTheDocument();

    expect(tile('sv02')).toHaveTextContent('· 193');
    expect(tile('sv02')).not.toHaveTextContent('193+');
    expect(within(tile('sv02')).queryByText(/%$/)).not.toBeInTheDocument();

    expect(within(tile('tiny')).getByText('Base set complete')).toBeInTheDocument();
    expect(within(tile('tiny')).getByText('100%')).toBeInTheDocument();
  });

  it('filters by name or exact code and clears', async () => {
    renderPage();
    const input = screen.getByPlaceholderText(/Filter sets/);
    await userEvent.type(input, 'paldea');
    expect(tiles()).toEqual(['/sets/sv02']);
    await userEvent.clear(input);
    await userEvent.type(input, 'obf');
    expect(tiles()).toEqual(['/sets/sv03']);
    await userEvent.type(input, 'x');
    expect(screen.getByText('No sets match.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(tiles()).toHaveLength(4);
  });

  it('filters by series with toggling chips', async () => {
    renderPage();
    const allChip = screen.getByRole('button', { name: 'All series' });
    expect(allChip).toHaveAttribute('data-active', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Base' }));
    expect(location()).toBe('/sets?series=Base');
    expect(tiles()).toEqual(['/sets/tiny', '/sets/base1']);
    expect(allChip).toHaveAttribute('data-active', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Base' }));
    expect(location()).toBe('/sets');
    await userEvent.click(screen.getByRole('button', { name: 'Scarlet & Violet' }));
    await userEvent.click(allChip);
    expect(location()).toBe('/sets');
  });

  it('filters to started and complete sets', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'Started · 2' }));
    expect(location()).toBe('/sets?filter=started');
    expect(tiles()).toEqual(['/sets/sv03', '/sets/tiny']);
    await userEvent.click(screen.getByRole('radio', { name: 'Complete' }));
    expect(tiles()).toEqual(['/sets/tiny']);
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(location()).toBe('/sets');
  });

  it('reads filters from the URL and explains an empty started list', () => {
    seedCollection();
    renderPage('/sets?filter=started&series=Base');
    expect(screen.getByRole('radio', { name: 'Started' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/You haven’t started any sets yet/)).toBeInTheDocument();
  });

  it('remembers the last filter, but a filter in the URL wins', async () => {
    const first = renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'Started · 2' }));
    first.unmount();
    const second = renderPage();
    expect(screen.getByRole('radio', { name: /Started/ })).toHaveAttribute('aria-checked', 'true');
    expect(location()).toBe('/sets');
    expect(tiles()).toEqual(['/sets/sv03', '/sets/tiny']);
    second.unmount();
    renderPage('/sets?filter=complete');
    expect(screen.getByRole('radio', { name: 'Complete' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches catalogue language, remembers it and only counts that language as started', async () => {
    seedCollection({
      entries: [makeEntry(), makeEntry({ cardId: 'ja:SV4a-001', setId: 'ja:SV4a' })],
      cards: [makeSnapshot(), makeSnapshot({ id: 'ja:SV4a-001', setId: 'ja:SV4a' })],
    });
    mocks.useSets.mockImplementation((lang: string) => queryResult(lang === 'ja' ? [makeSet({ id: 'ja:SV4a', name: 'シャイニートレジャーex', series: 'SV' })] : SETS));
    const first = renderPage('/sets?series=Base');
    expect(mocks.useSets).toHaveBeenLastCalledWith('en');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Card language' }), 'ja');
    expect(mocks.useSets).toHaveBeenLastCalledWith('ja');
    expect(location()).toBe('/sets?lang=ja');
    expect(screen.getByText(/Japanese sets/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Started · 1' })).toBeInTheDocument();
    expect(tiles()).toEqual(['/sets/ja:SV4a']);
    first.unmount();
    renderPage();
    expect(mocks.useSets).toHaveBeenLastCalledWith('ja');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Card language' }), 'en');
    expect(mocks.useSets).toHaveBeenLastCalledWith('en');
  });
});
