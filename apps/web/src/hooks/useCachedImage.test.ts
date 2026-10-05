import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const cache = vi.hoisted(() => ({ cachedImageUrl: vi.fn(), loadCachedImage: vi.fn() }));
vi.mock('../db/imageCache', () => cache);

import { useCachedImage } from './useCachedImage';

beforeEach(() => {
  cache.cachedImageUrl.mockReset().mockReturnValue(undefined);
  cache.loadCachedImage.mockReset().mockResolvedValue(undefined);
});

describe('useCachedImage', () => {
  it('returns nothing and skips lookups when disabled', () => {
    cache.cachedImageUrl.mockReturnValue('blob:x');
    const { result } = renderHook(() => useCachedImage('a-1', false));
    expect(result.current).toBeUndefined();
    expect(cache.loadCachedImage).not.toHaveBeenCalled();
  });

  it('uses an already-resolved URL synchronously', () => {
    cache.cachedImageUrl.mockReturnValue('blob:ready');
    const { result } = renderHook(() => useCachedImage('a-1', true));
    expect(result.current).toBe('blob:ready');
    expect(cache.loadCachedImage).not.toHaveBeenCalled();
  });

  it('loads from IndexedDB and returns the URL once found', async () => {
    cache.loadCachedImage.mockResolvedValue('blob:loaded');
    const { result } = renderHook(() => useCachedImage('a-1', true));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('blob:loaded'));
  });

  it('does not return a stale URL after the id changes', async () => {
    cache.loadCachedImage.mockImplementation(async (id: string) => (id === 'a-1' ? 'blob:a' : undefined));
    const { result, rerender } = renderHook(({ id }) => useCachedImage(id, true), { initialProps: { id: 'a-1' } });
    await waitFor(() => expect(result.current).toBe('blob:a'));
    rerender({ id: 'b-2' });
    expect(result.current).toBeUndefined();
  });
});
