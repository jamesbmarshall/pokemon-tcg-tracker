import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import PublicSharePage from './PublicSharePage';
import { renderWithProviders } from '../test/render';
import { mockApi, reply } from '../test/apiMock';
import { resetStores } from '../test/ui-helpers';
import { makeEntry, makeGraded, makeSealed, makeSnapshot } from '../test/fixtures';
import { getBackend, httpBackend } from '../api/backend';
import { publicBackend } from '../api/publicBackend';
import { useCollectionStore } from '../store/collectionStore';
import { useAuth } from '../store/authStore';
import type { PublicShare } from '../api/sharing';

const PIKA = makeSnapshot({ id: 'sv03-025', name: 'Pikachu', setName: 'Obsidian Flames', prices: { normal: 10 } });
const ZARD = makeSnapshot({ id: 'sv03-006', name: 'Charizard', setName: 'Obsidian Flames', prices: { holofoil: 30 } });
const MEW = makeSnapshot({ id: 'sv04-151', name: 'Mew', setName: 'Paradox Rift', prices: { normal: 5 } });

const data = (over: Partial<PublicShare> = {}, share: Partial<PublicShare['share']> = {}): PublicShare => ({
  share: { scope: 'collection', target: null, title: null, ownerName: 'Ash', hidePaid: true, hideValue: false, hideNotes: true, expiresAt: null, ...share },
  role: 'viewer',
  entries: [makeEntry({ cardId: PIKA.id, variant: 'normal', quantity: 2 })],
  graded: [makeGraded({ id: 'g1', cardId: ZARD.id, setId: 'sv03' })],
  sealed: [],
  wishlist: [{ cardId: MEW.id, addedAt: '2025-01-01' }],
  notes: [],
  history: [],
  lists: [],
  cards: [PIKA, ZARD, MEW],
  setStats: [],
  ...over,
});

const renderShare = (token = 'tok') => renderWithProviders(<PublicSharePage />, { route: `/s/${token}`, path: '/s/:token' });

beforeEach(async () => {
  await resetStores();
});

describe('PublicSharePage', () => {
  it('shows a shared collection read-only, with no links into the app', async () => {
    mockApi({ 'GET /api/public/tok': data() });
    renderShare();
    expect(await screen.findByRole('heading', { name: "Ash's collection" })).toBeInTheDocument();
    expect(screen.getByText('Shared by Ash')).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cards/ })).toHaveTextContent('2');
    expect(screen.getByRole('heading', { name: /Wishlist/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Pikachu .*owned ×2/ })).toBeInTheDocument();
    // 2×$10 + slab raw price $30 = $50 → £25.00
    expect(screen.getByText('£25.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pikachu/ })).not.toBeInTheDocument();
    expect(useCollectionStore.getState().readOnly).toBe(true);
    expect(getBackend().readOnly).toBe(true);
  });

  it('uses the title, hides the total when values are hidden, and notes the expiry', async () => {
    mockApi({ 'GET /api/public/tok': data({}, { title: 'Ash’s binder', hideValue: true, expiresAt: '2030-06-01T00:00:00Z' }) });
    renderShare();
    expect(await screen.findByRole('heading', { name: 'Ash’s binder' })).toBeInTheDocument();
    expect(screen.queryByText('£25.00')).not.toBeInTheDocument();
    expect(screen.getByText(/This link works until/)).toBeInTheDocument();
  });

  it('shows just the wishlist for a wishlist share', async () => {
    mockApi({ 'GET /api/public/tok': data({ entries: [], graded: [], cards: [MEW] }, { scope: 'wishlist' }) });
    renderShare();
    expect(await screen.findByRole('heading', { name: "Ash's wishlist" })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Mew/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Pikachu/ })).not.toBeInTheDocument();
  });

  it('shows sealed products with quantity and value for a sealed share', async () => {
    const sealed = [
      makeSealed({ id: 's1', name: 'Obsidian Flames booster box', productType: 'booster_box', quantity: 2, pcPrice: 90, pcProductId: 'pc-1' }),
      makeSealed({ id: 's2', name: '151 ETB', productType: 'etb', status: 'opened', valueUsd: 0 }),
    ];
    mockApi({ 'GET /api/public/tok': data({ entries: [], graded: [], sealed, cards: [] }, { scope: 'sealed' }) });
    renderShare();
    expect(await screen.findByRole('heading', { name: "Ash's sealed products" })).toBeInTheDocument();
    expect(screen.getByText('Obsidian Flames booster box')).toBeInTheDocument();
    expect(screen.getByText('Qty 2')).toBeInTheDocument();
    expect(screen.getAllByText('£90.00').length).toBeGreaterThan(0); // 2 × $90 × 0.5
    expect(screen.getByText('151 ETB')).toBeInTheDocument();
    expect(screen.getByText('Opened')).toBeInTheDocument();
  });

  it('hides sealed values when the share hides value', async () => {
    // Redaction happens server-side: with hideValue, the API sends no pcPrice/valueUsd at all.
    const sealed = [makeSealed({ id: 's1', pcPrice: undefined, pcProductId: undefined })];
    mockApi({ 'GET /api/public/tok': data({ entries: [], graded: [], sealed, cards: [] }, { scope: 'sealed', hideValue: true }) });
    renderShare();
    await screen.findByText('Obsidian Flames booster box');
    expect(screen.queryByText(/£/)).not.toBeInTheDocument();
  });

  it('says there is nothing sealed yet', async () => {
    mockApi({ 'GET /api/public/tok': data({ entries: [], graded: [], sealed: [], cards: [] }, { scope: 'sealed' }) });
    renderShare();
    expect(await screen.findByText('No sealed products yet.')).toBeInTheDocument();
  });

  it('shows a list in its own order', async () => {
    const list = { id: 'l1', name: 'Fire deck', description: 'Burn', createdAt: '', updatedAt: '', cards: [ZARD.id, PIKA.id], kind: 'list' as const, cardQtys: { [ZARD.id]: 1, [PIKA.id]: 1 } };
    mockApi({ 'GET /api/public/tok': data({ lists: [list] }, { scope: 'list', target: 'l1' }) });
    renderShare();
    expect(await screen.findByRole('heading', { name: 'Fire deck' })).toBeInTheDocument();
    expect(screen.getByText('Burn')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /owned|not owned/ }).map((e) => e.getAttribute('aria-label')!.split(' ')[0])).toEqual(['Charizard', 'Pikachu']);
  });

  it('says when a link is dead', async () => {
    mockApi({ 'GET /api/public/tok': reply(404, { error: 'This link has expired' }) });
    renderShare();
    expect(await screen.findByRole('heading', { name: "Can't open this link" })).toBeInTheDocument();
    expect(screen.getByText(/expired, been revoked/)).toBeInTheDocument();
  });

  it('asks signed-out visitors to sign in for links that need an account', async () => {
    useAuth.setState({ status: 'signed-out', user: null });
    mockApi({ 'GET /api/public/tok': reply(401, { error: 'Sign in', code: 'unauthenticated' }) });
    renderShare();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('puts the app back when you leave', async () => {
    mockApi({ 'GET /api/public/tok': data() });
    const { unmount } = renderShare();
    await screen.findByRole('heading', { name: "Ash's collection" });
    unmount();
    expect(getBackend()).toBe(httpBackend);
    expect(useCollectionStore.getState()).toMatchObject({ readOnly: false, collectionId: null, isLoaded: false });
    expect(useCollectionStore.getState().entries.size).toBe(0);
  });
});

describe('publicBackend', () => {
  it('reads photos through the share token and refuses writes', async () => {
    const api = mockApi({ 'GET /api/public/t%2F1/graded/g1/photos': [{ id: 'p1', side: 'front', addedAt: '2025-01-01' }] });
    const b = publicBackend('t/1');
    expect(b.readOnly).toBe(true);
    await expect(b.photos('x', 'g1')).resolves.toEqual([{ id: 'p1', side: 'front', addedAt: '2025-01-01', url: '/api/public/t%2F1/photos/p1' }]);
    await expect(b.putEntries('x', [])).rejects.toThrow('read-only');
    await expect(b.addToList('x', 'l', 'c')).rejects.toThrow('read-only');
    await waitFor(() => expect(api.calls).toHaveLength(1));
  });
});
