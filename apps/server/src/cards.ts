import { dirname } from 'node:path';
import { protectWriteProtocol } from './mutations.ts';
import { classifyPrintings, POLICY_VERSION } from '@poketracker/shared/printingRules';
import { readPrintingProfile } from './printingCatalog.ts';
import { PRINTING_VERSION, resolvePrintings } from '@poketracker/shared/printings';
/**
 * Server-side card snapshots and collection reads. Card data (including prices) is stored once
 * per card in the cards table and shared by every collection, so pricing work scales with the
 * number of distinct cards, not with users. Value history is computed here from those prices.
 */
import { configureCatalog, toSnapshot } from '@poketracker/shared/catalog';
import { FALLBACK_RATES, todayKey, valuePoint, type Rates } from '@poketracker/shared/value';
import type { CardPriceHistory, CardSnapshot, CollectionEntry, GradedCopy, MoverCard, PokemonCard, PriceHistorySeries, PriceHistorySource, ValuePoint } from '@poketracker/shared/types';
import { json, type Db } from './db.ts';
import type { Ctx } from './context.ts';
import { readSealed } from './sealed.ts';
import { tcgdexProvider } from './providers/tcgdex.ts';
import { pcCardFallback, pcConfigured } from './providers/pricecharting.ts';

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
  configureCatalog({ base: ctx.config.tcgdexBase, eurPerUsd: () => currentRates(ctx.db).EUR, storage: {
    profile: (setId) => readPrintingProfile(ctx.db, setId),
    rawCard: (cardId) => {
      const row = ctx.db.get<{ data: string; fetched_at: number }>('SELECT data, fetched_at FROM printing_raw_cards WHERE card_id = ?', cardId);
      const data = row && Date.now() - row.fetched_at < 6 * 3600_000 ? json(row.data, undefined) : undefined;
      return row && data ? { data, at: row.fetched_at } : undefined;
    },
    saveRawCard: (cardId, raw, at) => { ctx.db.run('INSERT OR REPLACE INTO printing_raw_cards (card_id, data, fetched_at) VALUES (?, ?, ?)', cardId, JSON.stringify(raw), at); },
    invalidateRawCard: (cardId) => { ctx.db.run('DELETE FROM printing_raw_cards WHERE card_id = ?', cardId); },
  } });
}

/** Reads stored snapshots by id. Missing or corrupt rows are simply absent from the map. */
export function readCards(db: Db, ids: Iterable<string>, classify = true): Map<string, CardSnapshot> {
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
  if (classify && out.size) {
    // The fingerprint is stored with the totals in the same transaction as the catalogue.
    // Most snapshots already match it: don't load/parse every set's full profile to return
    // a collection, especially when SQLite lives on a network filesystem.
    const setIds = [...new Set([...out.values()].map((c) => c.setId))];
    const fingerprints = new Map<string, string | null>();
    for (let i = 0; i < setIds.length; i += 500) {
      const chunk = setIds.slice(i, i + 500);
      const rows = db.all<{ set_id: string; profile: string | null }>(`SELECT c.set_id, s.profile FROM printing_catalogues c LEFT JOIN set_stats s ON s.set_id = c.set_id AND s.printing_version = c.printing_version WHERE c.printing_version = ? AND c.policy_version = ? AND c.set_id IN (${chunk.map(() => '?').join(',')})`, PRINTING_VERSION, POLICY_VERSION, ...chunk);
      for (const row of rows) fingerprints.set(row.set_id, row.profile);
    }
    const profiles = new Map<string, ReturnType<typeof readPrintingProfile>>();
    for (const c of out.values()) {
      const fingerprint = fingerprints.get(c.setId);
      if (c.printingVersion === PRINTING_VERSION && (fingerprint === undefined || (fingerprint !== null && c.printingProfile === fingerprint))) continue;
      if (!profiles.has(c.setId)) profiles.set(c.setId, readPrintingProfile(db, c.setId));
      const profile = profiles.get(c.setId);
      // Re-evaluate old snapshots without changing identity, prices or holdings.
      if (c.printingVersion !== PRINTING_VERSION || (profile && c.printingProfile !== profile.fingerprint)) {
        const observed = profile?.cards[c.id];
        const printings = observed?.printings ?? c.printings ?? resolvePrintings(c.id, c.variants);
        c.printings = classifyPrintings(c.id, printings.map((p) => ({ ...p, dataQuality: p.dataQuality ?? (p.raw ? p.providerId === 'generated' ? 'generated' : 'detailed' : 'flags') })), observed?.context ?? c.printingContext, profile);
        if (observed) c.variants = c.printings.map((p) => p.id);
        c.printingProfile = profile?.fingerprint;
        c.printingCoverage = profile?.complete && observed ? 'complete' : 'partial';
      }
    }
  }
  return out;
}

/** Listing cards carry no prices; never let them wipe a priced snapshot. */
export function saveSnapshots(db: Db, snaps: CardSnapshot[]) {
  if (!snaps.length) return;
  const prev = readCards(db, snaps.map((s) => s.id), false);
  db.tx(() => {
    const changedCollections = new Set<string>();
    for (let next of snaps) {
      const old = prev.get(next.id);
      if (old?.printingCoverage === 'complete' && next.printingCoverage !== 'complete' && !next.pricingComplete) next = { ...next, variants: old.variants, printings: old.printings, printingVersion: old.printingVersion, printingContext: old.printingContext, printingProfile: old.printingProfile, printingCoverage: old.printingCoverage };
      const signature = (c: CardSnapshot | undefined) => JSON.stringify(c?.printings?.map((p) => ({ id: p.id, label: p.label, distribution: p.distribution, status: p.status, sourceProduct: p.sourceProduct, evidence: p.evidence, role: p.role, decision: p.decision })).sort((a, b) => a.id.localeCompare(b.id)));
      if (next.printings?.length && signature(old) !== signature(next)) db.run(
        'INSERT INTO printing_changes (card_id, previous_data, next_data, printing_version, changed_at) VALUES (?, ?, ?, ?, ?)',
        next.id, old ? JSON.stringify(old.printings ?? old.variants) : null, JSON.stringify(next.printings), next.printingVersion ?? 0, new Date().toISOString(),
      );
      for (const printing of next.printings ?? []) for (const alias of printing.legacyAliases ?? []) {
        if (alias === printing.id) continue;
        const rows = db.all<{ collection_id: string }>('SELECT collection_id FROM entries WHERE card_id = ? AND variant = ?', next.id, alias);
        for (const row of rows) {
          if (db.get('SELECT 1 FROM entries WHERE collection_id = ? AND card_id = ? AND variant = ?', row.collection_id, next.id, printing.id)) continue;
          changedCollections.add(row.collection_id);
          db.run('UPDATE entries SET id = ?, variant = ? WHERE collection_id = ? AND card_id = ? AND variant = ?', `${next.id}::${printing.id}`, printing.id, row.collection_id, next.id, alias);
          db.run('INSERT INTO printing_reassignments (collection_id, card_id, from_variant, to_variant, reason, changed_at) VALUES (?, ?, ?, ?, ?, ?)', row.collection_id, next.id, alias, printing.id, 'unambiguous catalogue alias', new Date().toISOString());
        }
        for (const row of db.all<{ collection_id: string; id: string; data: string }>('SELECT collection_id, id, data FROM graded WHERE card_id = ?', next.id)) {
          const copy = json<GradedCopy | null>(row.data, null);
          if (!copy || copy.variant !== alias) continue;
          changedCollections.add(row.collection_id);
          db.run('UPDATE graded SET data = ? WHERE collection_id = ? AND id = ?', JSON.stringify({ ...copy, variant: printing.id }), row.collection_id, row.id);
          db.run('INSERT INTO printing_reassignments (collection_id, card_id, from_variant, to_variant, reason, changed_at) VALUES (?, ?, ?, ?, ?, ?)', row.collection_id, next.id, alias, printing.id, `unambiguous graded alias: ${row.id}`, new Date().toISOString());
        }
      }
      const priced = Object.keys(next.prices).length > 0 || next.pricingComplete;
      const merged = !old || priced
        ? next
        : { ...next, prices: old.prices, tcgplayerUrl: old.tcgplayerUrl, cardmarketUrl: old.cardmarketUrl, tcgplayerUpdatedAt: old.tcgplayerUpdatedAt, cardmarketUpdatedAt: old.cardmarketUpdatedAt, pricechartingUpdatedAt: old.pricechartingUpdatedAt };
      db.run(
        'INSERT OR REPLACE INTO cards (id, set_id, data, priced, synced_at) VALUES (?, ?, ?, ?, ?)',
        merged.id,
        merged.setId,
        JSON.stringify(merged),
        Object.keys(merged.prices).length ? 1 : 0,
        merged.syncedAt,
      );
    }
    if (changedCollections.size && db.file !== ':memory:') protectWriteProtocol(dirname(db.file));
    for (const id of changedCollections) db.run('UPDATE collections SET revision = revision + 1 WHERE id = ?', id);
  });
}

/**
 * Upserts today's market price per card/variant/source, in that source's native currency
 * (TCGplayer USD, Cardmarket EUR), plus any PriceCharting fallback prices supplied for variants
 * TCGdex had no price for. `INSERT OR REPLACE` on the (card, variant, source, date) primary key
 * makes this idempotent: refreshing the same card again today just updates today's row rather
 * than creating a duplicate.
 */
function writePriceHistory(db: Db, cards: PokemonCard[], pcFallbacks: Map<string, { price: number; variants: string[] }>) {
  if (!cards.length && !pcFallbacks.size) return;
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
            'INSERT OR REPLACE INTO price_history (card_id, variant, source, date, price, currency, printing_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
            card.id,
            variant,
            source,
            date,
            price.market,
            currency,
            card.printingVersion ?? 0,
          );
        }
      }
      const pc = pcFallbacks.get(card.id);
      if (pc) {
        for (const variant of pc.variants) {
          db.run(
            'INSERT OR REPLACE INTO price_history (card_id, variant, source, date, price, currency, printing_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
            card.id,
            variant,
            'pricecharting',
            date,
            pc.price,
            'USD',
            card.printingVersion ?? 0,
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
 *
 * For legacy cards without physical printing records, a configured PriceCharting key can
 * supply missing variant prices. Detailed printings never receive this generic ungraded
 * quote, which cannot distinguish treatments. See usdPrices() for market-source precedence;
 * entryValue() applies manual valuations separately.
 */
export async function refreshCards(ctx: Ctx, ids: string[]): Promise<number> {
  for (const setId of new Set(ids.map((id) => id.slice(0, id.lastIndexOf('-'))))) {
    if (!readPrintingProfile(ctx.db, setId)) ctx.db.run('INSERT OR IGNORE INTO printing_sync_queue (set_id, release_date, next_at) VALUES (?, ?, 0)', setId, '');
  }
  let refreshed = 0;
  let failed = 0;
  // Saved batch by batch so a long run keeps its progress if a later batch fails.
  for (let i = 0; i < ids.length; i += 40) {
    try {
      const fresh = await tcgdexProvider.getCardsByIds(ids.slice(i, i + 40));
      const pcFallbacks = new Map<string, { price: number; variants: string[] }>();
      const snaps: CardSnapshot[] = [];
      for (const card of fresh) {
        const withoutPc = toSnapshot(card);
        const missing = card.printings?.length ? [] : card.variants.filter((v) => withoutPc.prices[v] == null);
        let pcPrice: number | undefined;
        if (missing.length && pcConfigured(ctx)) {
          try {
            pcPrice = await pcCardFallback(ctx, card);
          } catch (err) {
            ctx.log.warn({ err, cardId: card.id }, 'pricecharting card fallback failed');
          }
        }
        if (pcPrice != null) {
          pcFallbacks.set(card.id, { price: pcPrice, variants: missing });
          snaps.push({ ...toSnapshot(card, pcPrice), pricechartingUpdatedAt: new Date().toISOString() });
        } else {
          snaps.push(withoutPc);
        }
      }
      saveSnapshots(ctx.db, snaps);
      writePriceHistory(ctx.db, fresh, pcFallbacks);
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
  const rows = db.all<{ variant: string; source: PriceHistorySource; date: string; price: number; currency: 'USD' | 'EUR'; printing_version: number }>(
    'SELECT variant, source, date, price, currency, printing_version FROM price_history WHERE card_id = ? AND date >= ? ORDER BY date',
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
        updatedAt: r.source === 'tcgplayer' ? card?.tcgplayerUpdatedAt : r.source === 'cardmarket' ? card?.cardmarketUpdatedAt : card?.pricechartingUpdatedAt,
        url: r.source === 'tcgplayer' ? (card?.printings?.find((p) => p.id === r.variant)?.productIds?.tcgplayer ? `https://www.tcgplayer.com/product/${card.printings.find((p) => p.id === r.variant)!.productIds!.tcgplayer}` : card?.tcgplayerUrl) : r.source === 'cardmarket' ? card?.cardmarketUrl : undefined,
      };
      series.set(key, s);
    }
    if (!r.printing_version) s.legacyAttribution = true;
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
    if (known.get(id)?.printingVersion === PRINTING_VERSION && Object.keys(known.get(id)?.prices ?? {}).length) continue;
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
  const sealed = readSealed(ctx, collectionId);
  const cards = readCards(ctx.db, [...entries.map((e) => e.cardId), ...graded.map((g) => g.cardId)]);
  const hasHistory = !!ctx.db.get('SELECT 1 FROM value_history WHERE collection_id = ? LIMIT 1', collectionId);
  const point = valuePoint(entries, cards, graded, currentRates(ctx.db), hasHistory, sealed);
  if (point) ctx.db.run('INSERT OR REPLACE INTO value_history (collection_id, date, data) VALUES (?, ?, ?)', collectionId, point.date, JSON.stringify(point));
  return point;
}
