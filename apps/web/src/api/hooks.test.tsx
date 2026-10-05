import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeCard, makeSet } from '../test/fixtures';

const c = vi.hoisted(() => ({
  getSets: vi.fn(),
  getSet: vi.fn(),
  getSetCards: vi.fn(),
  getCard: vi.fn(),
  searchCards: vi.fn(),
  getPrintings: vi.fn(),
  getRarities: vi.fn(),
  primeSets: vi.fn(),
}));
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), ...c }));

type Hooks = typeof import('./hooks');
let h: Hooks;
let store: typeof import('../store/collectionStore');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  for (const fn of Object.values(c)) fn.mockReset();
  localStorage.setItem('poketracker-sets', 'old');
  localStorage.setItem('poketracker-sets-v2', JSON.stringify({ at: 123, data: [makeSet()] }));
  vi.resetModules();
  h = await import('./hooks');
  store = await import('../store/collectionStore');
});

describe('module init', () => {
  it('drops the legacy sets cache and primes the client from the cached list', () => {
    expect(localStorage.getItem('poketracker-sets')).toBeNull();
    expect(c.primeSets).toHaveBeenCalledWith([expect.objectContaining({ id: 'sv03' })], 'en');
  });

  it('tolerates a corrupt cache', async () => {
    localStorage.setItem('poketracker-sets-v2', '{nope');
    vi.resetModules();
    c.primeSets.mockReset();
    await import('./hooks');
    expect(c.primeSets).toHaveBeenCalledWith(undefined, 'en');
  });
});

describe('useSets', () => {
  it('serves cached sets immediately, then refreshes and re-caches', async () => {
    c.getSets.mockResolvedValue([makeSet({ id: 'new' })]);
    const { result } = renderHook(() => h.useSets(), { wrapper });
    expect(result.current.data?.[0].id).toBe('sv03');
    await waitFor(() => expect(result.current.data?.[0].id).toBe('new'));
    expect(JSON.parse(localStorage.getItem('poketracker-sets-v2')!).data[0].id).toBe('new');
  });

  it('survives storage quota errors', async () => {
    localStorage.removeItem('poketracker-sets-v2');
    c.getSets.mockResolvedValue([makeSet()]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const { result } = renderHook(() => h.useSets(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useSetCards', () => {
  it('records the master-set total from the card variants', async () => {
    c.getSetCards.mockResolvedValue([makeCard({ variants: ['normal', 'reverseHolofoil'] }), makeCard({ id: 'sv03-002', variants: [] })]);
    const { result } = renderHook(() => h.useSetCards('sv03'), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    await waitFor(() => expect(store.useCollectionStore.getState().setStats.get('sv03')?.masterTotal).toBe(3));
  });

  it('is disabled without a set id', () => {
    renderHook(() => h.useSetCards(''), { wrapper });
    expect(c.getSetCards).not.toHaveBeenCalled();
  });
});

describe('simple queries', () => {
  it('useSet, useCard, usePrintings and useRarities call through', async () => {
    c.getSet.mockResolvedValue(makeSet());
    c.getCard.mockResolvedValue(makeCard());
    c.getPrintings.mockResolvedValue([]);
    c.getRarities.mockResolvedValue(['Common']);
    const { result } = renderHook(() => [h.useSet('sv03'), h.useCard('sv03-001'), h.usePrintings('Charmander'), h.useRarities()] as const, { wrapper });
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true));
    expect(c.getSet).toHaveBeenCalledWith('sv03');
    expect(c.getCard).toHaveBeenCalledWith('sv03-001');
    expect(c.getPrintings).toHaveBeenCalledWith('Charmander', 'en');
  });

  it('disabled when ids are empty', () => {
    renderHook(() => [h.useSet(''), h.useCard(''), h.usePrintings('')], { wrapper });
    expect(c.getSet).not.toHaveBeenCalled();
    expect(c.getCard).not.toHaveBeenCalled();
    expect(c.getPrintings).not.toHaveBeenCalled();
  });
});

describe('useSearch', () => {
  it('pages until every result is loaded', async () => {
    c.searchCards.mockImplementation(async (_f, page: number) => ({ data: [makeCard({ id: `x-${page}` })], page, pageSize: 1, totalCount: 2 }));
    const { result } = renderHook(() => h.useSearch({ name: 'x' }, true), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(c.searchCards).toHaveBeenLastCalledWith({ name: 'x' }, 2, expect.any(AbortSignal));
  });

  it('does not run when disabled', () => {
    renderHook(() => h.useSearch({}, false), { wrapper });
    expect(c.searchCards).not.toHaveBeenCalled();
  });
});
