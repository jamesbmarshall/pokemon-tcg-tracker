/**
 * Server-side card snapshots and collection reads. Card data (including prices) is stored once
 * per card in the cards table and shared by every collection, so pricing work scales with the
 * number of distinct cards, not with users. Value history is computed here from those prices.
 */
import { configureCatalog, getCardsByIds, toSnapshot } from '@poketracker/shared/catalog';
import { FALLBACK_RATES, valuePoint, type Rates } from '@poketracker/shared/value';
import type { CardSnapshot, CollectionEntry, GradedCopy, ValuePoint } from '@poketracker/shared/types';
import { json, type Db } from './db.ts';
import type { Ctx } from './context.ts';

/** Latest stored FX rates, or built-in fallbacks before the first successful fx job. */
export function currentRates(db: Db): Rates {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'fx'");
  return json<{ rates?: Rates }>(row?.value, {}).rates ?? FALLBACK_RATES;
}

/**
 * Points the shared catalogue client at our configured TCGdex base. The rate is a callback so
 * it picks up new FX rates without reconfiguring.
 */
export function initCatalog(ctx: Ctx) {
  configureCatalog({ base: ctx.config.tcgdexBase, eurPerUsd: () => currentRates(ctx.db).EUR });
}

/** Reads stored snapshots by id. Missing or corrupt rows are simply absent from the map. */
export function readCards(db: Db, ids: Iterable<string>): Map<string, CardSnapshot> {
  const out = new Map<string, CardSnapshot>();
  const list = Array.from(new Set(ids));
  // Chunked to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const rows = db.all<{ data: string }>(`SELECT data FROM cards WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
    for (const r of rows) {
      const c = json<CardSnapshot | null>(r.data, null);
      if (c) out.set(c.id, c);
    }
  }
  return out;
}

/** Listing cards carry no prices; never let them wipe a priced snapshot. */
export function saveSnapshots(db: Db, snaps: CardSnapshot[]) {
  if (!snaps.length) return;
  const prev = readCards(db, snaps.map((s) => s.id));
  db.tx(() => {
    for (const next of snaps) {
      const old = prev.get(next.id);
      const priced = Object.keys(next.prices).length > 0;
      const merged = !old || priced ? next : { ...next, prices: old.prices, tcgplayerUrl: old.tcgplayerUrl, cardmarketUrl: old.cardmarketUrl };
      db.run(
        'INSERT OR REPLACE INTO cards (id, set_id, data, priced, synced_at) VALUES (?, ?, ?, ?, ?)',
        merged.id,
        merged.setId,
        JSON.stringify(merged),
        Object.keys(merged.prices).length ? 1 : 0,
        merged.syncedAt,
      );
    }
  });
}

/**
 * Fetches full (priced) snapshots from TCGdex and stores them. Returns how many were refreshed.
 * A failed batch is logged and skipped so the rest still refresh; the call only throws when
 * every batch failed, which points at TCGdex being down rather than a few bad ids.
 */
export async function refreshCards(ctx: Ctx, ids: string[]): Promise<number> {
  let refreshed = 0;
  let failed = 0;
  // Saved batch by batch so a long run keeps its progress if a later batch fails.
  for (let i = 0; i < ids.length; i += 40) {
    try {
      const fresh = await getCardsByIds(ids.slice(i, i + 40));
      saveSnapshots(ctx.db, fresh.map(toSnapshot));
      refreshed += fresh.length;
    } catch (err) {
      failed++;
      ctx.log.warn({ err }, 'card refresh batch failed');
    }
  }
  if (ids.length && refreshed === 0 && failed > 0) throw new Error('Card API unavailable');
  return refreshed;
}

/**
 * Card ids anybody owns, wishlists, grades or lists. These are kept priced and cached.
 * UNION (not UNION ALL) deduplicates across users and collections, so the price and image jobs
 * fetch each card once however many people hold it.
 */
export function trackedCardIds(db: Db): string[] {
  return db
    .all<{ id: string }>(
      `SELECT card_id AS id FROM entries UNION SELECT card_id FROM wishlist UNION SELECT card_id FROM graded WHERE deleted_at IS NULL
       UNION SELECT card_id FROM list_cards`,
    )
    .map((r) => r.id);
}

/** Ids being hydrated right now, so rapid repeated mutations don't fetch the same card twice. */
const inFlight = new Set<string>();

/**
 * Fetches snapshots for ids we have never priced, so a newly added card shows a value without
 * waiting for the next prices job. Fire-and-forget from mutations: it never rejects.
 */
export function hydrateMissing(ctx: Ctx, ids: string[]) {
  const known = readCards(ctx.db, ids);
  const missing = ids.filter((id) => !inFlight.has(id) && !Object.keys(known.get(id)?.prices ?? {}).length);
  if (!missing.length) return Promise.resolve(0);
  for (const id of missing) inFlight.add(id);
  return refreshCards(ctx, missing)
    .catch(() => 0)
    .finally(() => missing.forEach((id) => inFlight.delete(id)));
}

// ---------------------------------------------------------------- collection data

export interface Holdings {
  entries: CollectionEntry[];
  graded: GradedCopy[];
}

/** Maps an entries row to the shared type, leaving out empty optional fields rather than sending nulls. */
export const rowToEntry = (r: Record<string, unknown>): CollectionEntry => ({
  id: r.id as string,
  cardId: r.card_id as string,
  setId: r.set_id as string,
  variant: r.variant as string,
  quantity: r.quantity as number,
  ...(r.condition ? { condition: r.condition as CollectionEntry['condition'] } : {}),
  ...(r.notes ? { notes: r.notes as string } : {}),
  ...(r.paid ? { paid: json(r.paid, undefined) } : {}),
  addedAt: r.added_at as string,
  ...(r.updated_at ? { updatedAt: r.updated_at as string } : {}),
});

export function readEntries(db: Db, collectionId: string): CollectionEntry[] {
  return db.all('SELECT * FROM entries WHERE collection_id = ? ORDER BY added_at', collectionId).map(rowToEntry);
}

export function readGraded(db: Db, collectionId: string): GradedCopy[] {
  return db
    .all<{ data: string }>('SELECT data FROM graded WHERE collection_id = ? AND deleted_at IS NULL', collectionId)
    .map((r) => json<GradedCopy | null>(r.data, null))
    .filter((g): g is GradedCopy => !!g);
}

export function readHistory(db: Db, collectionId: string): ValuePoint[] {
  return db.all<{ data: string }>('SELECT data FROM value_history WHERE collection_id = ? ORDER BY date', collectionId).map((r) => json<ValuePoint>(r.data, {} as ValuePoint));
}

/**
 * Records today's value point for one collection, computed from server-side prices. Done on
 * the server so history keeps growing while nobody has the app open. hasHistory lets
 * valuePoint skip writing an empty first point for a collection that has never held anything.
 */
export function recordValue(ctx: Ctx, collectionId: string): ValuePoint | undefined {
  const entries = readEntries(ctx.db, collectionId);
  const graded = readGraded(ctx.db, collectionId);
  const cards = readCards(ctx.db, [...entries.map((e) => e.cardId), ...graded.map((g) => g.cardId)]);
  const hasHistory = !!ctx.db.get('SELECT 1 FROM value_history WHERE collection_id = ? LIMIT 1', collectionId);
  const point = valuePoint(entries, cards, graded, currentRates(ctx.db), hasHistory);
  if (point) ctx.db.run('INSERT OR REPLACE INTO value_history (collection_id, date, data) VALUES (?, ?, ?)', collectionId, point.date, JSON.stringify(point));
  return point;
}
