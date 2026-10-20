import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer, setupOwner, personalId, type TestServer } from './helpers.ts';
let s: TestServer;
beforeEach(async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response('[]'))); s = await startServer(); });
afterEach(async () => { await s.close(); vi.unstubAllGlobals(); });

describe('portable collection exports', () => {
  it('preserves list-only decks, order, quantities and metadata across repeated cross-collection imports', async () => {
    const c = await setupOwner(s.app);
    const source = await personalId(c);
    const list = (await c.post(`/api/collections/${source}/lists`, { name: 'My deck', description: 'Deck notes', kind: 'deck', format: 'standard' })).json();
    await c.put(`/api/collections/${source}/lists/${list.id}/cards/sv1-002`, { qty: 4 });
    await c.put(`/api/collections/${source}/lists/${list.id}/cards/sv1-001`, { qty: 2 });
    const exported = (await c.get(`/api/collections/${source}/export`)).json();
    expect(exported.version).toBe(6);
    const target = (await c.post('/api/collections', { name: 'Restored' })).json().id;
    for (let i = 0; i < 2; i++) {
      const result = await c.post(`/api/collections/${target}/import`, exported);
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ lists: 0, decks: 1, warnings: [] });
      const restored = (await c.get(`/api/collections/${target}/state`)).json().lists;
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({ name: 'My deck', description: 'Deck notes', kind: 'deck', format: 'standard', cards: ['sv1-002', 'sv1-001'], cardQtys: { 'sv1-002': 4, 'sv1-001': 2 } });
      expect(restored[0].id).not.toBe(list.id);
    }
    expect((await c.get(`/api/collections/${source}/state`)).json().lists[0]).toEqual(exported.lists[0]);
  });
  it('rejects future formats without modifying the destination', async () => {
    const c = await setupOwner(s.app); const id = await personalId(c);
    const res = await c.post(`/api/collections/${id}/import`, { version: 999, lists: [{ name: 'future', cards: [] }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('import_version');
    expect((await c.get(`/api/collections/${id}/state`)).json().lists).toEqual([]);
  });
});
