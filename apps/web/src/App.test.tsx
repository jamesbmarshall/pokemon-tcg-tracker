import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { queryResult, resetStores, seedCollection } from './test/ui-helpers';
import { makeSet } from './test/fixtures';
import { useCollectionStore } from './store/collectionStore';
import { useAuth } from './store/authStore';
import { mockApi, reply } from './test/apiMock';
import { TEST_USER } from './test/setup';

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

describe('sign-in gate', () => {
  beforeEach(() => useAuth.setState({ status: 'loading', user: null }));

  it('shows first-run setup on a new server', async () => {
    mockApi({ 'GET /api/setup': { needed: true } });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Set up your server' })).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it('asks for sign-in, then opens the page that was asked for', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/setup': { needed: false },
      'GET /api/auth/me': () => (useAuth.getState().status === 'loading' ? reply(401, { error: 'Not signed in' }) : { user: TEST_USER }),
      'POST /api/auth/login': { user: TEST_USER },
    });
    renderAt('/wishlist');
    await user.type(await screen.findByLabelText('Username'), 'ash');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Wishlist page')).toBeInTheDocument();
    expect(here()).toBe('/wishlist');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the server is down', async () => {
    const user = userEvent.setup();
    const m = mockApi({ 'GET /api/setup': new TypeError('Failed to fetch') });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: "Can't reach PokéTracker" })).toBeInTheDocument();
    m.set('GET /api/setup', { needed: false });
    m.set('GET /api/auth/me', { user: TEST_USER });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('opens invite links without signing in', async () => {
    mockApi({ 'GET /api/setup': { needed: false }, 'GET /api/auth/me': reply(401, {}), 'GET /api/invites/abc': { valid: true, role: 'member' } });
    renderAt('/invite/abc');
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('returns to sign-in when the session ends', async () => {
    mockApi({ 'GET /api/setup': { needed: false }, 'GET /api/auth/me': { user: TEST_USER } });
    renderAt('/');
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    act(() => useAuth.getState().signedOut());
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
