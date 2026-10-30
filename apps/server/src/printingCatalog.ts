/**
 * Complete set imports shared by pages and scheduled jobs. Publish cards, the classification
 * profile and completion totals together; an incomplete refresh must not replace a catalogue.
 * See docs/printings.md for refresh schedules and the identity-preserving migration policy.
 */
import { getCardDetails, getSet, getSetCardsBrief, getSetCardsObservation, getSets, setIdFromCardId, toSnapshot, type Lang } from '@poketracker/shared/catalog';
import { applyPrintingProfile, buildPrintingProfile, POLICY_VERSION, type PrintingProfile } from '@poketracker/shared/printingRules';
import { fromPokemon, pokemonSet } from '@poketracker/shared/tcg/pokemon';
import { splitId } from '@poketracker/shared/languages';
import { PRINTING_VERSION } from '@poketracker/shared/printings';
import { setProgress } from '@poketracker/shared/completion';
import type { CardSet, PokemonCard } from '@poketracker/shared/types';
import { saveSnapshots } from './cards.ts';
import { json, type Db } from './db.ts';
import { notFound, type Ctx } from './context.ts';

const HOUR = 3600_000;
const running = new WeakMap<Db, Map<string, Promise<PokemonCard[]>>>();
const slots = new WeakMap<Db, { active: number; waiting: (() => void)[] }>();
async function importWithSlot(ctx: Ctx, setId: string) {
  // At most two set imports per database. Hand the occupied slot to the next waiter so new
  // arrivals cannot overtake it; requests for the same set share a promise in getCatalogSet().
  let pool = slots.get(ctx.db);
  if (!pool) { pool = { active: 0, waiting: [] }; slots.set(ctx.db, pool); }
  if (pool.active >= 2) await new Promise<void>((resolve) => pool!.waiting.push(resolve));
  else pool.active++;
  try {
    const observation = await getSetCardsObservation(setId);
    return persistCatalogue(ctx, setId, observation.cards, observation.at);
  }
  finally { const next = pool.waiting.shift(); if (next) next(); else pool.active--; }
}
export function readPrintingProfile(db: Db, setId: string): PrintingProfile | undefined {
  const row = db.get<{ profile: string }>('SELECT profile FROM printing_catalogues WHERE set_id = ? AND printing_version = ? AND policy_version = ?', setId, PRINTING_VERSION, POLICY_VERSION);
  const p = json<PrintingProfile | undefined>(row?.profile, undefined);
  return p?.version === POLICY_VERSION ? p : undefined;
}
export function readCatalogCards(db: Db, setId: string): PokemonCard[] | undefined {
  const row = db.get<{ data: string }>('SELECT data FROM printing_catalogues WHERE set_id = ? AND printing_version = ? AND policy_version = ?', setId, PRINTING_VERSION, POLICY_VERSION);
  return json<PokemonCard[] | undefined>(row?.data, undefined);
}
export function persistCatalogue(ctx: Ctx, setId: string, cards: PokemonCard[], observedAt = Date.now()) {
  const total = cards[0]?.set.total;
  if (!cards.length || !Number.isSafeInteger(total) || total !== cards.length ||
    new Set(cards.map((card) => card.id)).size !== cards.length ||
    cards.some((c) => c.set.id !== setId || c.set.total !== total || c.printingCoverage !== 'complete') ||
    !Number.isFinite(observedAt)) throw new Error('Refusing an incomplete catalogue');
  const profile = buildPrintingProfile(setId, cards, true);
  const classified = cards.map((c) => applyPrintingProfile(c, profile));
  for (const card of classified) fromPokemon(card, new Date().toISOString());
  const progress = setProgress(classified, new Map());
  const syncedAt = new Date(observedAt).toISOString();
  ctx.db.tx(() => {
    ctx.db.run('INSERT OR REPLACE INTO printing_catalogues (set_id, data, profile, printing_version, policy_version, synced_at) VALUES (?, ?, ?, ?, ?, ?)', setId, JSON.stringify(classified), JSON.stringify(profile), PRINTING_VERSION, POLICY_VERSION, observedAt);
    ctx.db.run('INSERT OR REPLACE INTO set_stats (set_id, master_total, all_total, provisional, unresolved_total, additional_total, profile, printing_version, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', setId, progress.master.total, progress.all.total, progress.provisional ? 1 : 0, progress.unresolved, progress.additional, profile.fingerprint, PRINTING_VERSION, syncedAt);
    saveSnapshots(ctx.db, classified.map((c) => toSnapshot(c)));
    const recent = Date.parse(cards[0].set.releaseDate) > Date.now() - 90 * 24 * HOUR;
    ctx.db.run('INSERT INTO printing_sync_queue (set_id, release_date, next_at) VALUES (?, ?, ?) ON CONFLICT(set_id) DO UPDATE SET next_at = excluded.next_at, release_date = excluded.release_date, last_error = NULL', setId, cards[0].set.releaseDate, Date.now() + (recent ? 24 : 168) * HOUR);
  });
  return classified;
}
export async function getCatalogSet(ctx: Ctx, setId: string, force = false): Promise<PokemonCard[]> {
  const previous = readCatalogCards(ctx.db, setId);
  const row = ctx.db.get<{ synced_at: number }>('SELECT synced_at FROM printing_catalogues WHERE set_id = ? AND printing_version = ?', setId, PRINTING_VERSION);
  if (!force && previous && row && Date.now() - row.synced_at < 6 * HOUR) return previous;
  const retry = ctx.db.get<{ next_at: number; last_error: string | null }>('SELECT next_at, last_error FROM printing_sync_queue WHERE set_id = ?', setId);
  if (!force && previous && retry?.last_error && retry.next_at > Date.now()) return previous;
  let jobs = running.get(ctx.db);
  if (!jobs) { jobs = new Map(); running.set(ctx.db, jobs); }
  let job = jobs.get(setId);
  if (!job) {
    job = importWithSlot(ctx, setId).catch((err) => {
      ctx.db.run('INSERT INTO printing_sync_queue (set_id, release_date, next_at, last_error) VALUES (?, ?, ?, ?) ON CONFLICT(set_id) DO UPDATE SET next_at = excluded.next_at, last_error = excluded.last_error', setId, previous?.[0]?.set.releaseDate ?? '', Date.now() + HOUR, 'Catalogue import failed; will retry automatically');
      throw err;
    }).finally(() => jobs!.delete(setId));
    jobs.set(setId, job);
  }
  try { return await job; }
  catch (err) { if (previous && !force) return previous; throw err; }
}
// Browsing must never wait for a complete printing import. Keep that atomic operation in
// getCatalogSet() for the scheduled job, and retain partial coverage on lightweight responses.
const displayRequests = new WeakMap<Db, Map<string, Promise<unknown>>>();
function queueCatalogue(ctx: Ctx, setId: string) {
  ctx.db.run('INSERT OR IGNORE INTO printing_sync_queue (set_id, release_date, next_at) VALUES (?, ?, 0)', setId, '');
}
function refreshCatalogueInBackground(ctx: Ctx, setId: string, hasCatalogue = false) {
  if (hasCatalogue) {
    const row = ctx.db.get<{ synced_at: number }>('SELECT synced_at FROM printing_catalogues WHERE set_id = ?', setId);
    if (row && Date.now() - row.synced_at < 6 * HOUR) return;
  }
  queueCatalogue(ctx, setId);
  const retry = ctx.db.get<{ next_at: number; last_error: string | null }>('SELECT next_at, last_error FROM printing_sync_queue WHERE set_id = ?', setId);
  if (retry?.last_error && retry.next_at > Date.now()) return;
  void getCatalogSet(ctx, setId).catch((err) => ctx.log.warn({ err, setId }, 'Background catalogue import will retry'));
}
/** Shared stale-while-revalidate cache for internal catalogue projections. */
export interface CatalogueObservation<T> { data: T; at: number }
export function displayObservation<T>(ctx: Ctx, key: string, load: () => Promise<T>, requireFresh = false): Promise<CatalogueObservation<T>> {
  const row = ctx.db.get<{ body: Uint8Array; fetched_at: number }>('SELECT body, fetched_at FROM http_cache WHERE key = ?', key);
  const previous = row ? json<T | undefined>(Buffer.from(row.body).toString(), undefined) : undefined;
  if (previous !== undefined && row && Date.now() - row.fetched_at < 6 * HOUR) return Promise.resolve({ data: previous, at: row!.fetched_at });
  let requests = displayRequests.get(ctx.db);
  if (!requests) { requests = new Map(); displayRequests.set(ctx.db, requests); }
  let request = requests.get(key) as Promise<CatalogueObservation<T>> | undefined;
  if (!request) {
    request = load().then((data) => {
      const at = Date.now();
      ctx.db.run('INSERT OR REPLACE INTO http_cache (key, status, content_type, body, fetched_at) VALUES (?, 200, ?, ?, ?)', key, 'application/json', Buffer.from(JSON.stringify(data)), at);
      return { data, at };
    }).finally(() => requests!.delete(key));
    requests.set(key, request);
  }
  if (previous !== undefined && !requireFresh) {
    void request.catch((err) => ctx.log.warn({ err }, 'Background catalogue display refresh failed'));
    return Promise.resolve({ data: previous, at: row!.fetched_at });
  }
  return request;
}
export async function displayCached<T>(ctx: Ctx, key: string, load: () => Promise<T>, requireFresh = false): Promise<T> {
  return (await displayObservation(ctx, key, load, requireFresh)).data;
}
function storedCatalogue(ctx: Ctx, setId: string): CatalogueObservation<PokemonCard[]> | undefined {
  const row = ctx.db.get<{ data: string; synced_at: number }>('SELECT data,synced_at FROM printing_catalogues WHERE set_id = ? AND printing_version = ? AND policy_version = ?', setId, PRINTING_VERSION, POLICY_VERSION);
  const data = json<PokemonCard[] | undefined>(row?.data, undefined);
  return data && row ? { data, at: row.synced_at } : undefined;
}
export async function catalogSetObservation(ctx: Ctx, setId: string): Promise<CatalogueObservation<PokemonCard[]>> {
  const previous = storedCatalogue(ctx, setId);
  if (previous) { refreshCatalogueInBackground(ctx, setId, true); return previous; }
  const result = await displayObservation(ctx, `catalogue-display:${PRINTING_VERSION}:${POLICY_VERSION}:set-complete-v2:${setId}`, async () => {
    const cards = await getSetCardsBrief(setId, true);
    for (const card of cards) {
      if (card.set.id !== setId) throw new Error('Mismatched set listing');
      fromPokemon(card, new Date().toISOString());
    }
    return cards;
  });
  refreshCatalogueInBackground(ctx, setId);
  return result;
}
export async function getCatalogSetForDisplay(ctx: Ctx, setId: string): Promise<PokemonCard[]> {
  return (await catalogSetObservation(ctx, setId)).data;
}
export async function catalogCardObservation(ctx: Ctx, cardId: string): Promise<CatalogueObservation<PokemonCard>> {
  const setId = setIdFromCardId(cardId);
  const previous = storedCatalogue(ctx, setId);
  if (previous) {
    refreshCatalogueInBackground(ctx, setId, true);
    const card = previous.data.find((c) => c.id === cardId);
    if (!card) throw notFound('Card not found in this set');
    return { data: card, at: previous.at };
  }
  const result = await displayObservation(ctx, `catalogue-display:${PRINTING_VERSION}:${POLICY_VERSION}:card:${cardId}`, async () => {
    const [card, set] = await Promise.all([getCardDetails(cardId, undefined, { fresh: true }), getSet(setId)]);
    const data = { ...card, set };
    if (data.id !== cardId || set.id !== setId) throw new Error('Mismatched card details');
    fromPokemon(data, new Date().toISOString());
    return data;
  });
  refreshCatalogueInBackground(ctx, setId);
  return result;
}
export async function getCatalogCard(ctx: Ctx, cardId: string): Promise<PokemonCard> {
  return (await catalogCardObservation(ctx, cardId)).data;
}
export async function discoverSets(ctx: Ctx, lang: Lang): Promise<CardSet[]> {
  const sets = await getSets(lang);
  if (new Set(sets.map((set) => set.id)).size !== sets.length) throw new Error('Duplicate set in catalogue response');
  for (const set of sets) {
    pokemonSet(set);
    if (splitId(set.id).lang !== lang) throw new Error('Mismatched set language');
  }
  ctx.db.tx(() => {
    ctx.db.run('INSERT OR REPLACE INTO catalogue_set_lists (language, data, fetched_at) VALUES (?, ?, ?)', lang, JSON.stringify(sets), Date.now());
    for (const set of sets) ctx.db.run('INSERT INTO printing_sync_queue (set_id, release_date, next_at) VALUES (?, ?, 0) ON CONFLICT(set_id) DO UPDATE SET release_date = excluded.release_date', set.id, set.releaseDate);
  });
  return sets;
}
export async function catalogSetsObservation(ctx: Ctx, lang: Lang): Promise<CatalogueObservation<CardSet[]>> {
  const row = ctx.db.get<{ data: string; fetched_at: number }>('SELECT data, fetched_at FROM catalogue_set_lists WHERE language = ?', lang);
  if (row && Date.now() - row.fetched_at < 6 * HOUR) return { data: json(row.data, []), at: row.fetched_at };
  try {
    const data = await discoverSets(ctx, lang);
    const published = ctx.db.get<{ data: string; fetched_at: number }>('SELECT data, fetched_at FROM catalogue_set_lists WHERE language = ?', lang)!;
    // Return the published row as a single observation even if another discovery won the race.
    return { data: json(published.data, data), at: published.fetched_at };
  } catch (err) { if (row) return { data: json(row.data, []), at: row.fetched_at }; throw err; }
}
export async function catalogSets(ctx: Ctx, lang: Lang): Promise<CardSet[]> {
  return (await catalogSetsObservation(ctx, lang)).data;
}
/**
 * Processes due or version-invalidated sets from the durable queue, sequentially in this job.
 * On-demand imports share the global slots; the raw-card cache resumes interrupted downloads.
 */
export async function syncPrintingCatalogues(ctx: Ctx, limit = 8) {
  const pending = ctx.db.all<{ set_id: string }>('SELECT q.set_id FROM printing_sync_queue q LEFT JOIN printing_catalogues c ON c.set_id = q.set_id WHERE q.next_at <= ? OR c.printing_version != ? OR c.policy_version != ? ORDER BY q.next_at, q.release_date DESC, q.set_id LIMIT ?', Date.now(), PRINTING_VERSION, POLICY_VERSION, limit);
  let imported = 0;
  for (const { set_id } of pending) {
    try { await getCatalogSet(ctx, set_id, true); imported++; }
    catch (err) { ctx.log.warn({ err, setId: set_id }, 'Printing catalogue import will retry'); }
  }
  return { imported, failed: pending.length - imported, queued: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM printing_sync_queue WHERE next_at <= ?', Date.now())!.n };
}
