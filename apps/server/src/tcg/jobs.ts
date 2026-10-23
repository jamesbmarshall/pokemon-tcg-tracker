import { games } from '@poketracker/shared/tcg/registry';
import type { ScryfallCard } from '@poketracker/shared/tcg/scryfall';
import type { Ctx } from '../context.ts';
import { assertStorage } from '../resourceLimits.ts';
import { recordGameValue } from './state.ts';
import { providerFor, scryfallJson, normalizeScryfall } from './provider.ts';
import {
  pcConfigured,
  pcProduct,
  pcGradedPrice,
} from '../providers/pricecharting.ts';
/** Incremental JSON-array decoder: memory is bounded by one card and one write batch. */
export async function* jsonObjects(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let object = '',
    depth = 0,
    quoted = false,
    escaped = false,
    total = 0;
  let started = false,
    ended = false,
    needComma = false,
    allowEnd = true;
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > 4 * 1024 ** 3) throw new Error('Bulk catalogue exceeds 4 GiB');
    for (const char of decoder.decode(chunk, { stream: true })) {
      if (!started) {
        if (/\s/.test(char)) continue;
        if (char !== '[') throw new Error('Expected JSON array');
        started = true;
        continue;
      }
      if (depth === 0) {
        if (/\s/.test(char)) continue;
        if (ended) throw new Error('Invalid bulk array');
        if (needComma) {
          if (char === ']') {
            ended = true;
            continue;
          }
          if (char !== ',') throw new Error('Invalid bulk array');
          needComma = false;
          allowEnd = false;
          continue;
        }
        if (char === ']' && allowEnd) {
          ended = true;
          continue;
        }
        if (char !== '{') throw new Error('Invalid bulk array');
      }
      object += char;
      if (object.length > 2 * 1024 ** 2)
        throw new Error('Bulk record exceeds 2 MiB');
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          yield JSON.parse(object);
          object = '';
          needComma = true;
        }
      }
    }
  }
  if (!ended || depth !== 0 || quoted)
    throw new Error('Incomplete bulk catalogue');
}
const busy = new WeakSet<Ctx>();
export async function refreshGameSets(ctx: Ctx) {
  let sets = 0;
  for (const game of games.all().filter((g) => g.id !== 'pokemon')) {
    if (ctx.db.get('SELECT 1 FROM tcg_cards WHERE game = ? LIMIT 1', game.id))
      sets += (await providerFor(ctx, game.id).sets()).length;
  }
  return { sets };
}
export async function refreshGameCatalogues(ctx: Ctx) {
  if (busy.has(ctx)) return { running: true };
  if (!ctx.db.get('SELECT 1 FROM tcg_cards LIMIT 1')) return { enabled: false };
  busy.add(ctx);
  try {
    await providerFor(ctx, 'mtg').sets();
    const bulk = await scryfallJson<{
      data: { type: string; updated_at: string; download_uri: string }[];
    }>(ctx, '/bulk-data', 24 * 3600_000);
    const source = bulk.data.find((d) => d.type === 'all_cards');
    if (!source) throw new Error('All-language bulk catalogue unavailable');
    const version = ctx.db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'mtg_bulk_version'",
    )?.value;
    if (version === source.updated_at) return { unchanged: true };
    const url = new URL(source.download_uri);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'data.scryfall.io' ||
      url.port ||
      url.username
    )
      throw new Error('Invalid bulk download host');
    assertStorage(ctx, 256 * 1024 ** 2);
    const response = await fetch(url, {
      headers: {
        'user-agent': `PokeTracker/${ctx.config.version}`,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (!response.ok || !response.body) throw new Error('Bulk download failed');
    ctx.db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS tcg_bulk_stage (game TEXT, id TEXT PRIMARY KEY, set_id TEXT, data TEXT, fetched_at INTEGER)',
    );
    ctx.db.exec('DELETE FROM tcg_bulk_stage');
    let count = 0,
      batch: ScryfallCard[] = [];
    const flush = () => {
      assertStorage(ctx, 4 * 1024 ** 2);
      ctx.db.tx(() => {
        for (const raw of batch) {
          const card = normalizeScryfall(raw, source.updated_at);
          if (!card.paper) continue;
          ctx.db.run(
            'INSERT OR REPLACE INTO tcg_bulk_stage VALUES (?,?,?,?,?)',
            'mtg',
            card.id,
            card.setId,
            JSON.stringify(card),
            Date.parse(source.updated_at),
          );
          count++;
        }
      });
      batch = [];
    };
    try {
      for await (const raw of jsonObjects(
        response.body as unknown as AsyncIterable<Uint8Array>,
      )) {
        batch.push(raw as ScryfallCard);
        if (batch.length >= 100) {
          flush();
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      flush();
      if (count === 0) throw new Error('Empty bulk catalogue');
      ctx.db.tx(() => {
        ctx.db.exec(
          'INSERT OR REPLACE INTO tcg_cards SELECT s.* FROM tcg_bulk_stage s LEFT JOIN tcg_cards c ON c.game = s.game AND c.id = s.id WHERE c.id IS NULL OR c.fetched_at <= s.fetched_at',
        );
        ctx.db.run(
          "INSERT OR REPLACE INTO settings (key,value) VALUES ('mtg_bulk_version',?)",
          source.updated_at,
        );
        ctx.db.run('DELETE FROM tcg_catalogues WHERE game = ?', 'mtg');
      });
    } finally {
      ctx.db.exec('DELETE FROM tcg_bulk_stage');
    }
    return { cards: count, version: source.updated_at };
  } finally {
    busy.delete(ctx);
  }
}
export async function refreshGamePrices(ctx: Ctx) {
  let refreshed = 0;
  ctx.db.run(
    'DELETE FROM tcg_records WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    new Date(Date.now() - 86400_000).toISOString(),
  );
  const ids = new Map<string, Set<string>>();
  for (const row of ctx.db.all<{
    game: string;
    kind: string;
    id: string;
    data: string;
  }>('SELECT game,kind,id,data FROM tcg_records WHERE deleted_at IS NULL')) {
    const data = JSON.parse(row.data);
    const set = ids.get(row.game) ?? new Set<string>();
    if (data.cardId) set.add(data.cardId);
    if (row.kind === 'wishlist' || row.kind === 'note') set.add(row.id);
    if (row.kind === 'list')
      for (const item of data.items) set.add(item.cardId);
    ids.set(row.game, set);
  }
  for (const [game, cards] of ids)
    for (const id of cards) {
      try {
        const card = await providerFor(ctx, game).card(id);
        if (Date.now() - Date.parse(card.fetchedAt) < 6 * 3600_000) refreshed++;
      } catch {
        /* retain last quote */
      }
    }
  if (pcConfigured(ctx)) {
    const linked = ctx.db.all<{
      collection_id: string;
      game: string;
      kind: string;
      id: string;
      data: string;
    }>(
      "SELECT * FROM tcg_records WHERE kind IN ('graded','sealed') AND deleted_at IS NULL",
    );
    for (const record of linked) {
      const data = JSON.parse(record.data);
      if (!data.pcProductId) continue;
      try {
        const product = await pcProduct(ctx, data.pcProductId);
        const price =
          record.kind === 'graded'
            ? pcGradedPrice(product, data.company, data.grade)
            : Number(product.raw['new-price'] ?? product.raw['loose-price']) /
              100;
        if (price === undefined || !Number.isFinite(price) || price < 0)
          continue;
        const row = ctx.db.get<{ data: string }>(
          'SELECT data FROM tcg_records WHERE collection_id = ? AND game = ? AND kind = ? AND id = ? AND deleted_at IS NULL',
          record.collection_id,
          record.game,
          record.kind,
          record.id,
        );
        const current = row && JSON.parse(row.data);
        if (
          current &&
          current.pcProductId === data.pcProductId &&
          current.grade === data.grade &&
          current.company === data.company
        )
          ctx.db.run(
            'UPDATE tcg_records SET data = ? WHERE collection_id = ? AND game = ? AND kind = ? AND id = ?',
            JSON.stringify({ ...current, pcPrice: price }),
            record.collection_id,
            record.game,
            record.kind,
            record.id,
          );
      } catch {
        /* retain the last successful quote */
      }
    }
  }
  for (const c of ctx.db.all<{ id: string }>('SELECT id FROM collections'))
    for (const game of games.all().filter((g) => g.id !== 'pokemon'))
      recordGameValue(ctx, c.id, game.id);
  ctx.db.run(
    'DELETE FROM tcg_price_history WHERE date < ?',
    new Date(Date.now() - ctx.config.priceHistoryDays * 86400_000)
      .toISOString()
      .slice(0, 10),
  );
  const requested = [...ids.values()].reduce(
    (sum, cards) => sum + cards.size,
    0,
  );
  if (requested && !refreshed)
    throw new Error(
      'No tracked game prices could be refreshed; previous quotes retained',
    );
  return { refreshed, requested, missing: requested - refreshed };
}
