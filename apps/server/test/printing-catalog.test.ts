import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY_VERSION } from '@poketracker/shared/printingRules';
import { configureCatalog, type RawCard } from '@poketracker/shared/catalog';
import { readCards, saveSnapshots } from '../src/cards.ts';
import { catalogSets, discoverSets, getCatalogSet, getCatalogSetForDisplay, readPrintingProfile, syncPrintingCatalogues } from '../src/printingCatalog.ts';
import { personalId, setupOwner, startServer, type TestServer } from './helpers.ts';

let server: TestServer;
let cards: RawCard[];
let omitted: string | undefined;
let missingDetail: string | undefined;
let fetchMock: ReturnType<typeof vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>>;
const setId = 'future-policy-test';
beforeEach(async () => {
  omitted = missingDetail = undefined;
  cards = Array.from({ length: 12 }, (_, i) => ({ id: `${setId}-${i + 1}`, localId: String(i + 1), name: `Card ${i}`, category: 'Pokemon', rarity: 'Common', set: { id: setId, name: 'New release' }, variants_detailed: [
    { type: 'normal', thirdParty: { cardmarket: i + 100 } },
    { type: 'reverse', thirdParty: { cardmarket: i + 100 } },
    ...(i ? [] : [{ type: 'holo', thirdParty: { cardmarket: 999 }, pricing: { cardmarket: { trend: 5 } } }]),
  ] }));
  const set = { id: setId, name: 'New release', releaseDate: '2026-10-14', cardCount: { official: 12, total: 12 }, serie: { id: 'future', name: 'Future' } };
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ data: { sets: [set], cards: cards.filter((c) => c.id !== omitted).map((card) => init.body?.toString().includes('localId') ? card : { id: card.id }) } });
    if (String(url).includes('/sets/')) return Response.json(set);
    const card = cards.find((c) => String(url).endsWith(`/cards/${c.id}`));
    return card && card.id !== missingDetail ? Response.json(card) : new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  server = await startServer();
});
afterEach(async () => { await server.close(); configureCatalog({ storage: null }); vi.unstubAllGlobals(); });

describe('automatic catalogue lifecycle', () => {
  it('opens a cold set and card while the rest of the printing import is blocked', async () => {
    const client = await setupOwner(server.app);
    const original = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes('/cards/') && !String(url).endsWith(`/cards/${cards[0].id}`)) await blocked;
      return original(url, init);
    });
    try {
      const responses: Awaited<ReturnType<typeof client.get>>[] = [];
      void Promise.all([client.get(`/api/catalog/set/${setId}`), client.get(`/api/catalog/card/${cards[0].id}`)])
        .then((result) => responses.push(...result));
      await vi.waitFor(() => expect(responses).toHaveLength(2), { timeout: 1000 });
      expect(responses.map((res) => res.statusCode)).toEqual([200, 200]);
      expect(responses[0].json()).toHaveLength(cards.length);
      expect(responses[1].json()).toMatchObject({ id: cards[0].id, detailed: true, printingCoverage: 'partial' });
      expect(readPrintingProfile(server.ctx.db, setId)).toBeUndefined();
      expect(server.ctx.db.get('SELECT master_total FROM set_stats WHERE set_id = ?', setId)).toBeUndefined();
      expect(fetchMock.mock.calls.filter(([, init]) => init?.body?.toString().includes('sets {'))).toHaveLength(0);
    } finally {
      release();
      await getCatalogSet(server.ctx, setId);
    }
    expect(readPrintingProfile(server.ctx.db, setId)?.complete).toBe(true);
    expect((await getCatalogSetForDisplay(server.ctx, setId))[0].printingCoverage).toBe('complete');
  });

  it('reclassifies a stale collection snapshot and preserves its prices', async () => {
    await getCatalogSet(server.ctx, setId);
    const original = readCards(server.ctx.db, [cards[0].id]).get(cards[0].id)!;
    const stale = { ...original, printingProfile: 'previous-profile', printings: [], variants: [], prices: { normal: 12 } };
    server.ctx.db.run('UPDATE cards SET data = ? WHERE id = ?', JSON.stringify(stale), stale.id);
    const refreshed = readCards(server.ctx.db, [stale.id]).get(stale.id)!;
    expect(refreshed).toMatchObject({
      printingProfile: original.printingProfile,
      printingCoverage: 'complete', prices: { normal: 12 },
    });
    expect(refreshed.variants.toSorted()).toEqual(original.variants.toSorted());
    expect(refreshed.printings?.map((p) => [p.id, p.role]).sort()).toEqual(original.printings?.map((p) => [p.id, p.role]).sort());
  });

  it('serves an expired complete catalogue immediately while its refresh is blocked', async () => {
    const initial = await getCatalogSet(server.ctx, setId);
    server.ctx.db.run('UPDATE printing_catalogues SET synced_at = 0');
    const original = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async (url, init) => { await blocked; return original(url, init); });
    try {
      let result: unknown;
      void getCatalogSetForDisplay(server.ctx, setId).then((cards) => { result = cards; });
      await vi.waitFor(() => expect(result).toEqual(initial), { timeout: 1000 });
    } finally {
      release();
      await getCatalogSet(server.ctx, setId);
    }
  });

  it('discovers an unseen set, imports it without holdings, and serves one classification everywhere', async () => {
    await discoverSets(server.ctx, 'en');
    expect(await syncPrintingCatalogues(server.ctx)).toMatchObject({ imported: 1, failed: 0 });
    const client = await setupOwner(server.app);
    const set = (await client.get(`/api/catalog/set/${setId}`)).json();
    const detail = (await client.get(`/api/catalog/card/${cards[0].id}`)).json();
    const known = (await client.get(`/api/catalog/known?ids=${cards[0].id}`)).json();
    expect(detail.printings.map((p: { role: string }) => p.role)).toEqual(['core', 'parallel', 'additional']);
    expect(detail).toEqual(set[0]);
    expect(known[0]).toEqual(detail);
    expect(readCards(server.ctx.db, [detail.id]).get(detail.id)?.printings).toEqual(detail.printings);
    expect(server.ctx.db.get('SELECT master_total, all_total, unresolved_total, additional_total FROM set_stats WHERE set_id = ?', setId)).toMatchObject({ master_total: 24, all_total: 25, unresolved_total: 0, additional_total: 1 });
    expect(server.ctx.db.get<{ next_at: number }>('SELECT next_at FROM printing_sync_queue WHERE set_id = ?', setId)!.next_at).toBeGreaterThan(Date.now());
  });

  it('reclassifies dependent cards and totals without changing holdings or prices', async () => {
    const initial = await getCatalogSet(server.ctx, setId);
    const client = await setupOwner(server.app);
    const collection = await personalId(client);
    await client.put(`/api/collections/${collection}/entries`, { entries: [{ cardId: cards[0].id, variant: 'holofoil', quantity: 2, condition: 'LP', notes: 'Keep', paid: { amount: 9, currency: 'GBP' }, addedAt: new Date().toISOString() }] });
    await client.put(`/api/collections/${collection}/graded/slab`, { cardId: cards[0].id, variant: 'holofoil', company: 'PSA', grade: '10', countsTowardSet: true });
    const before = (await client.get(`/api/collections/${collection}/state`)).json();
    for (const c of cards.slice(1)) c.variants_detailed!.push({ type: 'holo', thirdParty: { cardmarket: 999 } });
    server.ctx.db.run('UPDATE printing_raw_cards SET fetched_at = 0');
    const updated = await getCatalogSet(server.ctx, setId, true);
    expect(updated[0].printingProfile).not.toBe(initial[0].printingProfile);
    expect(updated[0].printings![2].role).toBe('core');
    expect(updated[0].cardmarket?.prices).toEqual(initial[0].cardmarket?.prices);
    const after = (await client.get(`/api/collections/${collection}/state`)).json();
    expect(after.entries).toEqual(before.entries);
    expect(after.graded).toEqual(before.graded);
    expect(after.setStats[0].masterTotal).toBe(36);
    expect(server.ctx.db.all('SELECT * FROM printing_reassignments')).toHaveLength(0);
    const snapshot = readCards(server.ctx.db, [cards[0].id]).get(cards[0].id)!;
    saveSnapshots(server.ctx.db, [{ ...snapshot, printings: [], variants: [], printingCoverage: 'partial', pricingComplete: false, prices: {} }]);
    expect(readCards(server.ctx.db, [cards[0].id]).get(cards[0].id)?.printings).toEqual(snapshot.printings);
  });

  it('retains the last complete import on failure and retries automatically', async () => {
    const initial = await getCatalogSet(server.ctx, setId);
    const profile = readPrintingProfile(server.ctx.db, setId);
    server.ctx.db.run('UPDATE printing_catalogues SET synced_at = 0');
    omitted = cards[1].id;
    expect(await getCatalogSet(server.ctx, setId)).toEqual(initial);
    expect(readPrintingProfile(server.ctx.db, setId)).toEqual(profile);
    expect(server.ctx.db.get('SELECT last_error FROM printing_sync_queue WHERE set_id = ?', setId)?.last_error).toBeTruthy();
    omitted = undefined;
    server.ctx.db.run('UPDATE printing_sync_queue SET next_at = 0');
    expect(await syncPrintingCatalogues(server.ctx)).toMatchObject({ imported: 1, failed: 0 });
    expect(server.ctx.db.get('SELECT last_error FROM printing_sync_queue WHERE set_id = ?', setId)?.last_error).toBeNull();
  });

  it('resumes partial detail downloads and deduplicates concurrent imports', async () => {
    missingDetail = cards[1].id;
    await expect(getCatalogSet(server.ctx, setId)).rejects.toThrow();
    expect(readPrintingProfile(server.ctx.db, setId)).toBeUndefined();
    expect(server.ctx.db.all('SELECT card_id FROM printing_raw_cards')).toHaveLength(11);
    missingDetail = undefined;
    fetchMock.mockClear();
    const [a, b] = await Promise.all([getCatalogSet(server.ctx, setId), getCatalogSet(server.ctx, setId)]);
    expect(a).toEqual(b);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/cards/'))).toHaveLength(1);
    await discoverSets(server.ctx, 'en');
    fetchMock.mockClear();
    expect((await catalogSets(server.ctx, 'en'))[0].id).toBe(setId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('automatically invalidates a previous policy even when its refresh is not due', async () => {
    await getCatalogSet(server.ctx, setId);
    server.ctx.db.run('UPDATE printing_catalogues SET policy_version = 0');
    expect(readPrintingProfile(server.ctx.db, setId)).toBeUndefined();
    expect(await syncPrintingCatalogues(server.ctx)).toMatchObject({ imported: 1, failed: 0 });
    expect(readPrintingProfile(server.ctx.db, setId)?.version).toBe(POLICY_VERSION);
  });
});
