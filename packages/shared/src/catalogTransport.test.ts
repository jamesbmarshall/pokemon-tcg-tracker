import { describe, expect, it, vi, afterEach } from 'vitest';
import { catalogueJson, CATALOGUE_RESPONSE_LIMIT } from './catalogTransport';
import { rest } from './catalog';
afterEach(() => vi.unstubAllGlobals());
describe('catalogue transport bounds', () => {
  it('decodes streamed multilingual JSON without corrupting split UTF-8 characters', async () => {
    const bytes = new TextEncoder().encode('{"name":"ピカチュウ"}');
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
    expect(await catalogueJson(response)).toEqual({ name: 'ピカチュウ' });
  });
  it('rejects an oversized declared response before consuming it', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(CATALOGUE_RESPONSE_LIMIT + 1) } });
    await expect(catalogueJson(response)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds chunked bodies even when Content-Length lies', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel }), { headers: { 'content-length': '1' } });
    await expect(catalogueJson(response)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects malformed JSON', async () => { await expect(catalogueJson(new Response('{'))).rejects.toThrow(); });
  it('forbids upstream redirects and preserves a supplied cancellation signal', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await rest('/cards/sv01-001', undefined, signal);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', signal }));
  });
});
