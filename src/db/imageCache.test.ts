import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './dexie';
import { cacheImages, cachedImageUrl, countCachedImages, loadCachedImage, pruneImages } from './imageCache';
import { mockFetch } from '../test/fetchMock';
import { makeSnapshot } from '../test/fixtures';

// jsdom's Blob can't be wrapped in Node's Response, so fake the bits cacheImages uses.
const png = () => ({ ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) }) as unknown as Response;
const fetchWith = (reply: (url: string) => Response | Promise<Response>) => {
  const fn = vi.fn(async (url: string) => reply(url));
  vi.stubGlobal('fetch', fn);
  return fn;
};

beforeEach(async () => {
  await db.images.clear();
});

describe('cacheImages', () => {
  it('stores TCGdex images only, skipping ones already cached', async () => {
    const fetch = fetchWith(png);
    await db.images.put({ id: 'sv03-002', blob: new Blob(['old'], { type: 'image/png' }), savedAt: 'x' });
    await cacheImages([
      makeSnapshot({ id: 'sv03-001' }),
      makeSnapshot({ id: 'sv03-002' }),
      makeSnapshot({ id: 'base1-4', image: 'https://images.pokemontcg.io/base1/4.png' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('sv03-001');
    expect(await countCachedImages()).toBe(2);
    const row = await db.images.get('sv03-001');
    expect(Date.parse(row!.savedAt)).not.toBeNaN();
  });

  it('ignores failed responses, non-images and network errors', async () => {
    fetchWith((url) => {
      if (url.includes('sv03-001')) return { ok: false } as Response;
      if (url.includes('sv03-002')) return { ok: true, blob: async () => new Blob(['<html>'], { type: 'text/html' }) } as unknown as Response;
      throw new TypeError('Failed to fetch');
    });
    await expect(cacheImages(['sv03-001', 'sv03-002', 'sv03-003'].map((id) => makeSnapshot({ id })))).resolves.toBeUndefined();
    expect(await countCachedImages()).toBe(0);
  });

  it('does nothing when there are no eligible cards', async () => {
    const fetch = mockFetch([]);
    await cacheImages([makeSnapshot({ image: '' })]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads in batches of four', async () => {
    let active = 0;
    let peak = 0;
    fetchWith(() => {
      peak = Math.max(peak, ++active);
      return new Promise<Response>((r) =>
        setTimeout(() => {
          active--;
          r(png());
        }, 5),
      );
    });
    await cacheImages(Array.from({ length: 10 }, (_, i) => makeSnapshot({ id: `sv03-${i}` })));
    expect(peak).toBeLessThanOrEqual(4);
    expect(await countCachedImages()).toBe(10);
  });
});

describe('loadCachedImage', () => {
  it('returns an object URL for a cached image and memoises it', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sv03-001');
    await db.images.put({ id: 'sv03-001', blob: new Blob(['x'], { type: 'image/png' }), savedAt: 'x' });
    expect(await loadCachedImage('sv03-001')).toBe('blob:sv03-001');
    expect(await loadCachedImage('sv03-001')).toBe('blob:sv03-001');
    expect(create).toHaveBeenCalledTimes(1);
    expect(cachedImageUrl('sv03-001')).toBe('blob:sv03-001');
  });

  it('returns undefined for misses and retries them later', async () => {
    expect(await loadCachedImage('nope-1')).toBeUndefined();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:later');
    await db.images.put({ id: 'nope-1', blob: new Blob(['x'], { type: 'image/png' }), savedAt: 'x' });
    expect(await loadCachedImage('nope-1')).toBe('blob:later');
  });

  it('returns undefined when the database read fails', async () => {
    vi.spyOn(db.images, 'get').mockRejectedValueOnce(new Error('boom'));
    expect(await loadCachedImage('broken-1')).toBeUndefined();
  });
});

describe('pruneImages', () => {
  it('deletes images that are no longer needed and revokes their URLs', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:drop');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await db.images.bulkPut(['keep-1', 'drop-1'].map((id) => ({ id, blob: new Blob(['x'], { type: 'image/png' }), savedAt: 'x' })));
    await loadCachedImage('drop-1');
    await pruneImages(new Set(['keep-1']));
    expect(await db.images.toCollection().primaryKeys()).toEqual(['keep-1']);
    expect(revoke).toHaveBeenCalledWith('blob:drop');
    expect(cachedImageUrl('drop-1')).toBeUndefined();
    await pruneImages(new Set(['keep-1']));
    expect(await countCachedImages()).toBe(1);
  });
});
