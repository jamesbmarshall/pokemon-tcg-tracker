/**
 * Server-side card snapshots and collection reads. Card data (including prices) is stored once
 * per card in the cards table and shared by every collection, so pricing work scales with the
 * number of distinct cards, not with users. Value history is computed here from those prices.
 */
import { configureCatalog, getCardsByIds, toSnapshot } from '@poketracker/shared/catalog';
import { FALLBACK_RATES, todayKey, valuePoint, type Rates } from '@poketracker/shared/value';
import type { CardPriceHistory, CardSnapshot, CollectionEntry, GradedCopy, MoverCard, PokemonCard, PriceHistorySeries, PriceHistorySource, ValuePoint } from '@poketracker/shared/types';
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
      const merged = !old || priced
        ? next
        : { ...next, prices: old.prices, tcgplayerUrl: old.tcgplayerUrl, cardmarketUrl: old.cardmarketUrl, tcgplayerUpdatedAt: old.tcgplayerUpdatedAt, cardmarketUpdatedAt: old.cardmarketUpdatedAt };
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
 * Upserts today's market price per card/variant/source, in that source's native currency
 * (TCGplayer USD, Cardmarket EUR). `INSERT OR REPLACE` on the (card, variant, source, date)
 * primary key makes this idempotent: refreshing the same card again today just updates today's
 * row rather than creating a duplicate.
 */
function writePriceHistory(db: Db, cards: PokemonCard[]) {
  if (!cards.length) return;
  const date = todayKey();
  db.tx(() => {
    for (const card of cards) {
      const sources: Array<[PriceHistorySource, { prices: Record<string, { market?: number }> } | undefined, 'USD' | 'EUR']> = [
        ['tcgplayer', card.tcgplayer, 'USD'],
        ['cardmarket', card.cardmarket, 'EUR'],
      ];
      for (const [source, block, currency] of sources) {
        if (!block) continue;
        for (const [variant, price] of Object.entries(block.prices)) {
          if (price.market == null) continue;
          db.run(
            'INSERT OR REPLACE INTO price_history (card_id, variant, source, date, price, currency) VALUES (?, ?, ?, ?, ?, ?)',
            card.id,
            variant,
            source,
            date,
            price.market,
            currency,
          );
        }
      }
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
      writePriceHistory(ctx.db, fresh);
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
 * Daily price history for one card, per variant and source, within the last `days`.
 * Source `updatedAt`/`url` come from the current snapshot rather than the history rows, since
 * that is the latest provenance TCGdex gave us for that source.
 */
export function readPriceHistory(db: Db, cardId: string, days: number): CardPriceHistory {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = db.all<{ variant: string; source: PriceHistorySource; date: string; price: number; currency: 'USD' | 'EUR' }>(
    'SELECT variant, source, date, price, currency FROM price_history WHERE card_id = ? AND date >= ? ORDER BY date',
    cardId,
    since,
  );
  const card = readCards(db, [cardId]).get(cardId);
  const series = new Map<string, PriceHistorySeries>();
  for (const r of rows) {
    const key = `${r.variant}::${r.source}`;
    let s = series.get(key);
    if (!s) {
      s = {
        variant: r.variant,
        source: r.source,
        currency: r.currency,
        points: [],
        updatedAt: r.source === 'tcgplayer' ? card?.tcgplayerUpdatedAt : card?.cardmarketUpdatedAt,
        url: r.source === 'tcgplayer' ? card?.tcgplayerUrl : card?.cardmarketUrl,
      };
      series.set(key, s);
    }
    s.points.push({ date: r.date, price: r.price });
  }
  return { cardId, series: Array.from(series.values()) };
}

/** Deletes price history older than `days`. Returns the number of rows removed. */
export function prunePriceHistory(db: Db, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return Number(db.run('DELETE FROM price_history WHERE date < ?', cutoff).changes);
}

/**
 * The biggest value movers in a collection over `days`, split into gainers and losers (each up
 * to 5, sorted by the size of the change). A card needs both a current market price and a
 * price-history row at or before the cutoff to be considered, so a brand-new collection with
 * thin history simply yields an empty list rather than a misleading one.
 */
export function biggestMovers(ctx: Ctx, collectionId: string, days: number): { gainers: MoverCard[]; losers: MoverCard[] } {
  const entries = readEntries(ctx.db, collectionId);
  const graded = readGraded(ctx.db, collectionId);
  const byCard = new Map<string, string>(); // cardId -> representative variant
  for (const e of entries) if (!byCard.has(e.cardId)) byCard.set(e.cardId, e.variant);
  for (const g of graded) if (!byCard.has(g.cardId)) byCard.set(g.cardId, g.variant);
  const cards = readCards(ctx.db, byCard.keys());
  const rate = currentRates(ctx.db).EUR;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const movers: MoverCard[] = [];
  for (const [cardId, variant] of byCard) {
    const card = cards.get(cardId);
    const nowPrice = card?.prices[variant];
    if (!nowPrice) continue;
    // TCGplayer (USD) first, else Cardmarket converted at today's rate, matching usdPrices().
    const tcg = ctx.db.get<{ price: number }>(
      "SELECT price FROM price_history WHERE card_id = ? AND variant = ? AND source = 'tcgplayer' AND date <= ? ORDER BY date DESC LIMIT 1",
      cardId,
      variant,
      cutoff,
    );
    const row = tcg ?? (() => {
      const r = ctx.db.get<{ price: number }>(
        "SELECT price FROM price_history WHERE card_id = ? AND variant = ? AND source = 'cardmarket' AND date <= ? ORDER BY date DESC LIMIT 1",
        cardId,
        variant,
        cutoff,
      );
      return r && rate > 0 ? { price: Math.round((r.price / rate) * 100) / 100 } : undefined;
    })();
    if (!row || row.price <= 0) continue;
    const changeUsd = nowPrice - row.price;
    if (Math.abs(changeUsd) < 0.01) continue;
    movers.push({
      cardId,
      name: card!.name,
      image: card!.image,
      setName: card!.setName,
      variant,
      valueUsd: nowPrice,
      previousValueUsd: row.price,
      changeUsd,
      changePct: (changeUsd / row.price) * 100,
    });
  }
  const gainers = movers.filter((m) => m.changeUsd > 0).sort((a, b) => b.changeUsd - a.changeUsd).slice(0, 5);
  const losers = movers.filter((m) => m.changeUsd < 0).sort((a, b) => a.changeUsd - b.changeUsd).slice(0, 5);
  return { gainers, losers };
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

/**
 * Fetches in progress, keyed by card id. Callers that ask for a card already being fetched wait
 * on the same promise rather than skipping it: adding a card fires a background hydrate and the
 * client immediately asks /api/cards/hydrate for the priced card, and that request must not
 * return before the price has landed.
 */
const inFlight = new Map<string, Promise<number>>();

/**
 * Fetches snapshots for ids we have never priced, so a newly added card shows a value without
 * waiting for the next prices job. Resolves once every requested card has been fetched (by this
 * call or one already running). Fire-and-forget from mutations: it never rejects.
 */
export function hydrateMissing(ctx: Ctx, ids: string[]): Promise<number> {
  const known = readCards(ctx.db, ids);
  const waits = new Set<Promise<number>>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (Object.keys(known.get(id)?.prices ?? {}).length) continue;
    const running = inFlight.get(id);
    if (running) waits.add(running);
    else missing.push(id);
  }
  if (missing.length) {
    const job: Promise<number> = refreshCards(ctx, missing)
      .catch(() => 0)
      .finally(() => missing.forEach((id) => inFlight.get(id) === job && inFlight.delete(id)));
    for (const id of missing) inFlight.set(id, job);
    waits.add(job);
  }
  return Promise.all(waits).then(() => missing.length);
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
  ...(r.value_override ? { valueUsd: json<number | undefined>(r.value_override, undefined) } : {}),
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
