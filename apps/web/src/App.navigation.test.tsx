import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { resetStores, seedCollection } from './test/ui-helpers';
import { mockApi } from './test/apiMock';
import { useCollectionStore } from './store/collectionStore';
import { useAuth } from './store/authStore';
import type { GameState } from '@poketracker/shared/tcg/types';

vi.mock('./pages/HomePage', () => ({ default: () => 'Pokémon home' }));

const state: GameState = {
  game: 'mtg', role: 'owner', revision: 0, cards: [], entries: [], graded: [],
  sealed: [], wishlist: [], notes: [], lists: [], history: [],
};

beforeEach(async () => {
  await resetStores();
  seedCollection();
  useCollectionStore.setState({ load: vi.fn(async () => {}) });
  // An admin can manage the instance without triggering the owner's backup/update queries.
  useAuth.setState({ user: { ...useAuth.getState().user!, role: 'admin' } });
  mockApi({
    [`GET /api/collections/${useCollectionStore.getState().collectionId}/games/mtg/state`]: state,
    [`GET /api/collections/${useCollectionStore.getState().collectionId}/games/mtg/movers`]: [],
    'GET /api/admin/users': [],
    'GET /api/account/sessions': [],
    'GET /api/shares': [],
  });
});

afterEach(() => window.history.replaceState({}, '', '/'));

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

function expectGame(game: string) {
  for (const select of screen.getAllByRole('combobox', { name: 'Trading card game' })) {
    expect(select).toHaveValue(game);
  }
}

describe('universal navigation', () => {
  it('keeps Magic selected through Settings, Admin, Sharing and Account, then switches to Pokémon', async () => {
    renderAt('/');
    await userEvent.selectOptions(screen.getAllByRole('combobox', { name: 'Trading card game' })[0], 'mtg');
    await screen.findByRole('heading', { name: 'Magic: The Gathering' });
    await userEvent.click(screen.getAllByRole('link', { name: 'Settings' })[0]);
    expect(window.location.pathname).toBe('/settings');
    await screen.findByRole('heading', { name: 'Magic data' });
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Server' })).toBeInTheDocument();
    expect(screen.queryByText('Clear everything')).not.toBeInTheDocument();
    expectGame('mtg');

    await userEvent.click(screen.getByRole('link', { name: 'Users, invites, jobs & backups' }));
    expect(window.location.pathname).toBe('/admin');
    expectGame('mtg');
    expect(screen.getAllByRole('link', { name: 'Collection' })[0]).toHaveAttribute('href', '/mtg/collection');

    // Exercise the mobile links as well as the desktop sidebar.
    await userEvent.click(screen.getAllByRole('link', { name: 'Sharing' })[1]);
    expect(window.location.pathname).toBe('/sharing');
    await screen.findByRole('heading', { name: 'Share Magic' });
    expectGame('mtg');
    await userEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(window.location.pathname).toBe('/account');
    expectGame('mtg');
    await userEvent.click(screen.getAllByRole('link', { name: 'Settings' })[1]);
    expectGame('mtg');

    await userEvent.selectOptions(screen.getAllByRole('combobox', { name: 'Trading card game' })[0], 'pokemon');
    await screen.findByText('Pokémon home');
    await userEvent.click(screen.getAllByRole('link', { name: 'Settings' })[0]);
    expectGame('pokemon');
    expect(screen.getByRole('heading', { name: 'Backup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Magic data' })).not.toBeInTheDocument();
  });

  it.each(['settings', 'sharing', 'admin', 'account'])('keeps old /mtg/%s bookmarks working', async (section) => {
    renderAt(`/mtg/${section}`);
    await waitFor(() => expect(window.location.pathname).toBe(`/${section}`));
    expectGame('mtg');
    expect(localStorage.getItem('poketracker-game')).toBe('mtg');
  });

  it.each(['settings', 'sharing', 'admin', 'account'])('restores Magic on a direct /%s visit', (section) => {
    localStorage.setItem('poketracker-game', 'mtg');
    renderAt(`/${section}`);
    expectGame('mtg');
  });

  it('uses Pokémon for an invalid saved game', () => {
    localStorage.setItem('poketracker-game', 'unknown');
    renderAt('/settings');
    expectGame('pokemon');
  });
});
