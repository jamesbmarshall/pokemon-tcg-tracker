import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { queryResult, resetStores, seedCollection } from './test/ui-helpers';
import { makeSet } from './test/fixtures';
import { useCollectionStore } from './store/collectionStore';

const mocks = vi.hoisted(() => ({ useSets: vi.fn() }));
vi.mock('./api/hooks', () => ({ useSets: mocks.useSets }));

vi.mock('./pages/HomePage', () => ({ default: () => 'Home page' }));
vi.mock('./pages/SetsPage', () => ({ default: () => 'Sets page' }));
vi.mock('./pages/CollectionPage', () => ({ default: () => 'Collection page' }));
vi.mock('./pages/WishlistPage', () => ({ default: () => 'Wishlist page' }));
vi.mock('./pages/SearchPage', () => ({ default: () => 'Search page' }));
vi.mock('./pages/SettingsPage', () => ({ default: () => 'Settings page' }));
vi.mock('./pages/SetPage', async () => {
  const { useParams } = await import('react-router-dom');
  const SetPage = () => `Set page ${useParams().setId}`;
  return { default: SetPage };
});
vi.mock('./pages/CardPage', async () => {
  const { useParams } = await import('react-router-dom');
  const CardPage = () => `Card page ${useParams().cardId}`;
  return { default: CardPage };
});

const load = vi.fn(async () => {});

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(<App />);
}
const here = () => window.location.pathname + window.location.search;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  useCollectionStore.setState({ load });
  mocks.useSets.mockReturnValue(queryResult([makeSet()]));
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('loads the collection on start', () => {
    renderAt('/');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/', 'Home page'],
    ['/sets', 'Sets page'],
    ['/sets/sv03', 'Set page sv03'],
    ['/card/sv03-001', 'Card page sv03-001'],
    ['/collection', 'Collection page'],
    ['/wishlist', 'Wishlist page'],
    ['/search', 'Search page'],
    ['/settings', 'Settings page'],
  ])('renders %s inside the layout', (url, text) => {
    renderAt(url);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(here()).toBe(url);
  });

  it.each([
    ['/browse', '/sets', 'Sets page'],
    ['/browse/sv03', '/sets/sv03', 'Set page sv03'],
    ['/binder', '/collection?view=binder', 'Collection page'],
    ['/nowhere/at/all', '/', 'Home page'],
  ])('redirects %s to %s', async (from, to, text) => {
    renderAt(from);
    await waitFor(() => expect(here()).toBe(to));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('navigates between pages through the layout', async () => {
    renderAt('/');
    await userEvent.click(screen.getAllByRole('link', { name: /^Wishlist/ })[0]);
    expect(await screen.findByText('Wishlist page')).toBeInTheDocument();
    expect(here()).toBe('/wishlist');
  });
});
