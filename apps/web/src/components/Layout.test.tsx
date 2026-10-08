import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import Layout from './Layout';
import { renderWithProviders } from '../test/render';
import { queryResult, resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSet, makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';
import { getBackend } from '../api/backend';

const mocks = vi.hoisted(() => ({ useSets: vi.fn() }));
vi.mock('../api/hooks', () => ({ useSets: mocks.useSets }));

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  mocks.useSets.mockReturnValue(queryResult([makeSet()]));
});

function renderLayout(route = '/') {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<p>Home content</p>} />
        <Route path="sets" element={<p>Sets content</p>} />
        <Route path="settings" element={<p>Settings content</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('Layout', () => {
  it('renders the outlet, footer and nav links in sidebar and tab bar', () => {
    renderLayout();
    expect(screen.getByText('Home content')).toBeInTheDocument();
    for (const name of ['Dashboard', 'Sets', 'Collection', 'Wishlist']) {
      expect(screen.getAllByRole('link', { name: new RegExp(`^${name}`) })).toHaveLength(2);
    }
    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'TCGdex' })).toHaveAttribute('href', 'https://tcgdex.dev');
  });

  it('navigates with the nav links and marks the active one', async () => {
    renderLayout();
    const [sidebarSets] = screen.getAllByRole('link', { name: /^Sets/ });
    await userEvent.click(sidebarSets);
    expect(screen.getByTestId('location')).toHaveTextContent('/sets');
    expect(screen.getByText('Sets content')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Sets/ })[0]).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link', { name: /^Dashboard/ })[0]).not.toHaveAttribute('aria-current');
  });

  it('shows the collection value and card count', () => {
    seedCollection({
      entries: [makeEntry({ quantity: 2 }), makeEntry({ variant: 'reverseHolofoil', quantity: 1 })],
      cards: [makeSnapshot({ prices: { normal: 3, reverseHolofoil: 4 } })],
    });
    renderLayout();
    expect(screen.getByText('3 cards')).toBeInTheDocument();
    // (2×$3 + $4) at £0.50/$
    expect(screen.getByText('£5.00')).toBeInTheDocument();
  });

  it('shows the wishlist count in the sidebar', () => {
    seedCollection({ wishlist: [{ cardId: 'a-1', addedAt: '2025-01-01' }, { cardId: 'a-2', addedAt: '2025-01-01' }] });
    renderLayout();
    expect(screen.getAllByRole('link', { name: /^Wishlist/ })[0]).toHaveTextContent('Wishlist2');
  });

  it('opens and toggles the palette with Ctrl+K / ⌘K', () => {
    renderLayout();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'K', metaKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("opens the palette with '/' unless typing", () => {
    renderLayout();
    const ev = fireEvent.keyDown(document.body, { key: '/' });
    expect(ev).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Escape from within the palette closes it
    fireEvent.keyDown(screen.getByPlaceholderText('Search cards and sets…'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("does not open the palette for '/' typed into a field", async () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<input aria-label="field" />} />
        </Route>
      </Routes>,
    );
    await userEvent.type(screen.getByLabelText('field'), '/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('field')).toHaveValue('/');
  });

  it('opens the palette from the quick search and mobile search buttons', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: /Quick search/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick search/ })).toHaveTextContent('Ctrl K');
    fireEvent.keyDown(screen.getByPlaceholderText('Search cards and sets…'), { key: 'Escape' });
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the palette after navigating from it', async () => {
    renderLayout();
    fireEvent.keyDown(document.body, { key: '/' });
    await userEvent.type(screen.getByPlaceholderText('Search cards and sets…'), 'obs{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/sets/sv03');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refreshes prices from the value badge', async () => {
    const syncPrices = vi.fn(async () => 3);
    useCollectionStore.setState({ syncPrices });
    renderLayout();
    await userEvent.click(screen.getByTitle('Refresh prices'));
    expect(syncPrices).toHaveBeenCalledWith(true);
    expect(screen.queryByText(/weren't refreshed|Couldn't reach/)).not.toBeInTheDocument();
  });

  it('toasts the reason when the price refresh fails', async () => {
    const reason = "Couldn't reach the PokéTracker server. Check your connection.";
    useCollectionStore.setState({ syncPrices: vi.fn(async () => (useCollectionStore.setState({ syncError: reason }), -1)) });
    renderLayout();
    await userEvent.click(screen.getByTitle('Refresh prices'));
    expect(await screen.findByText(reason)).toBeInTheDocument();
  });

  it('shows sync state and last sync time', () => {
    useCollectionStore.setState({ lastSync: new Date(Date.now() - 2 * 3600_000).toISOString() });
    const { unmount } = renderLayout();
    expect(screen.getByTitle('Refresh prices')).toHaveTextContent('2h ago');
    unmount();
    useCollectionStore.setState({ syncing: true });
    renderLayout();
    expect(screen.getByTitle('Refresh prices')).toHaveTextContent('Syncing');
    expect(screen.getByTitle('Refresh prices')).toBeDisabled();
  });

  it('shows Sync when prices were never refreshed', () => {
    renderLayout();
    expect(screen.getByTitle('Refresh prices')).toHaveTextContent('Sync');
  });

  it('scrolls to the top on navigation', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    renderLayout();
    scrollTo.mockClear();
    await userEvent.click(screen.getAllByRole('link', { name: /^Sets/ })[0]);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('offers a collection switcher only when there is more than one collection', async () => {
    const { unmount } = renderLayout();
    expect(screen.queryByRole('combobox', { name: 'Collection' })).not.toBeInTheDocument();
    unmount();

    const load = vi.fn(async () => {});
    useCollectionStore.setState({
      load,
      collections: [
        { id: 'c-personal', name: 'My collection', kind: 'personal', role: 'owner', ownerName: 'Ash', mine: true },
        { id: 'c-gym', name: 'Gym stash', kind: 'shared', role: 'viewer', ownerName: 'Brock', mine: false },
      ],
    });
    renderLayout();
    const [sidebar] = screen.getAllByRole('combobox', { name: 'Collection' });
    expect(within(sidebar).getAllByRole('option').map((o) => o.textContent)).toEqual(['My collection (yours)', 'Gym stash · Brock']);
    await userEvent.selectOptions(sidebar, 'c-gym');
    expect(load).toHaveBeenCalledWith('c-gym');
  });

  it('marks a view-only collection and links to Lists and Sharing', () => {
    useCollectionStore.setState({
      readOnly: true,
      role: 'viewer',
      collections: [
        { id: 'c-personal', name: 'My collection', kind: 'personal', role: 'owner', ownerName: 'Ash', mine: true },
        { id: 'c-gym', name: 'Gym stash', kind: 'shared', role: 'viewer', ownerName: 'Brock', mine: false },
      ],
    });
    renderLayout();
    expect(screen.getAllByText('View only').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /^Lists/ })[0]).toHaveAttribute('href', '/lists');
    expect(screen.getAllByRole('link', { name: /Sharing/ })[0]).toHaveAttribute('href', '/sharing');
  });

  it('shows a dismissible demo banner when the server reports demoMode, and hides it on sign-off', async () => {
    vi.spyOn(getBackend(), 'status').mockResolvedValue({ version: 'test', lastPriceSync: null, fxAt: null, demoMode: true });
    renderLayout();
    const banner = await screen.findByText(/viewing a demo/i);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(banner).not.toBeInTheDocument();
  });

  it('shows no demo banner for an ordinary server', async () => {
    vi.spyOn(getBackend(), 'status').mockResolvedValue({ version: 'test', lastPriceSync: null, fxAt: null });
    renderLayout();
    await screen.findByText('Home content');
    expect(screen.queryByText(/viewing a demo/i)).not.toBeInTheDocument();
  });
});
