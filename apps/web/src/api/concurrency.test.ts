import { collectionsApi } from './sharing';
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

it('member reads cannot silently advance the revision of a collection already being edited', async () => {
  acceptCollectionRevision('audit', 3);
  const fetch = vi.fn().mockResolvedValueOnce(new Response('[]', { headers: { etag: '"99"' } })).mockResolvedValueOnce(new Response('{"ok":true}', { headers: { etag: '"4"' } }));
  vi.stubGlobal('fetch', fetch);
  await collectionsApi.members('audit');
  await api('/api/collections/audit/entries', { method: 'PUT', body: { entries: [] } });
  expect(fetch.mock.calls[1][1].headers['if-match']).toBe('"3"');
  vi.unstubAllGlobals();
});

it('a commuting delta cannot authorize overwriting unseen intervening edits', async () => {
  acceptCollectionRevision('audit', 3);
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"ok":true}', { headers: { etag: '"9"' } })).mockResolvedValueOnce(new Response('{"error":"Review the newer edit"}', { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  await api('/api/collections/audit/entries/adjust', { method: 'POST', body: { cardId: 'sv1-001', variant: 'normal', delta: 1 } });
  await expect(api('/api/collections/audit/notes/sv1-001', { method: 'PUT', body: { text: 'My stale note' } })).rejects.toMatchObject({ status: 409 });
  expect(fetch.mock.calls[1][1].headers['if-match']).toBe('"3"');
  vi.unstubAllGlobals();
});
it('initial membership-only access can bootstrap a revision without accepting a later refresh', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('[]', { headers: { etag: '"9"' } })).mockResolvedValueOnce(new Response('{"ok":true}', { headers: { etag: '"10"' } })));
  await collectionsApi.members('audit');
  await expect(collectionsApi.setMember('audit', 'user-id', 'editor')).resolves.toEqual({ ok: true });
  expect(vi.mocked(fetch).mock.calls[1][1]!.headers).toMatchObject({ 'if-match': '"9"' });
  vi.unstubAllGlobals();
});
