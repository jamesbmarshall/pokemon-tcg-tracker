import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './http';
import { acceptCollectionRevision, observeMutationProtocol, resetCollectionRevisions } from './concurrency';
beforeEach(() => { resetCollectionRevisions(); observeMutationProtocol('1'); });

it('retries a lost response with the same receipt key and advances the committed revision', async () => {
  acceptCollectionRevision('audit', 3);
  const f = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(new Response('{"ok":true}', { headers: { etag: '"4"' } }));
  vi.stubGlobal('fetch', f);
  await expect(api('/api/collections/audit/entries', { method: 'PUT', body: { entries: [] } })).resolves.toEqual({ ok: true });
  expect(f).toHaveBeenCalledTimes(2);
  expect(f.mock.calls[0][1].headers['idempotency-key']).toBe(f.mock.calls[1][1].headers['idempotency-key']);
  expect(f.mock.calls[0][1].headers['if-match']).toBe('"3"');
  vi.unstubAllGlobals();
});

it('never authorizes an edit using a background response the UI did not accept', async () => {
  const f = vi.fn().mockResolvedValue(new Response('{"revision":99}', { headers: { etag: '"99"' } }));
  vi.stubGlobal('fetch', f);
  await api('/api/collections/audit/state');
  await expect(api('/api/collections/audit/entries', { method: 'PUT', body: {} })).rejects.toMatchObject({ status: 428 });
  expect(f).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
