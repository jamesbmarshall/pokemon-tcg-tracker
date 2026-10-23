import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { games } from '@poketracker/shared/tcg/registry';
import type {
  GameRecord,
  TcgSearch,
  TcgCard,
  TcgSet,
} from '@poketracker/shared/tcg/types';
import { bad, notFound, requireUser, Limiter, type Ctx } from '../context.ts';
import { need, sniffImage } from '../collections.ts';
import { mutate } from '../mutations.ts';
import { publishPhoto } from '../photoStorage.ts';
import { sha256 } from '../security.ts';
import { pcProduct, pcGradedPrice } from '../providers/pricecharting.ts';
import { providerFor, readGameCards } from './provider.ts';
import { cardValue, quoteUsd } from '@poketracker/shared/tcg/collection';
import { currentRates } from '../cards.ts';
import {
  cleanGameRecord,
  gameState,
  putGameRecord,
  recordGameValue,
  recordCardIds,
} from './state.ts';
function game(req: FastifyRequest) {
  const id = (req.params as { game: string }).game;
  if (!games.get(id) || id === 'pokemon') throw notFound('Game not found');
  return id;
}
function reader(req: FastifyRequest) {
  if (!req.user && !req.shareToken) requireUser(req);
}
export function tcgRoutes(app: FastifyInstance, ctx: Ctx) {
  const limit = new Limiter(180, 60_000);
  app.get('/api/games', async (req) => {
    reader(req);
    return games
      .all()
      .map(
        ({
          id,
          name,
          shortName,
          languages,
          capabilities,
          searchFields,
          sealedTypes,
          formats,
        }) => ({
          id,
          name,
          shortName,
          languages,
          capabilities,
          searchFields,
          sealedTypes,
          formats: formats.map((f) => ({ id: f.id, name: f.name })),
        }),
      );
  });
  app.get('/api/games/:game/sets', async (req, reply) => {
    reader(req);
    limit.check(req.user?.id ?? req.ip, reply);
    const g = game(req);
    try {
      return await providerFor(ctx, g).sets();
    } catch (e) {
      const rows = ctx.db.all<{ data: string }>(
        'SELECT data FROM tcg_sets WHERE game = ?',
        g,
      );
      if (!rows.length) throw e;
      reply.header('x-catalog-stale', '1');
      return rows.map((r) => JSON.parse(r.data) as TcgSet);
    }
  });
  app.get('/api/games/:game/search', async (req, reply) => {
    reader(req);
    limit.check(req.user?.id ?? req.ip, reply);
    const g = game(req);
    const query = req.query as TcgSearch;
    if (
      Object.values(query).some((v) => typeof v !== 'string' || v.length > 500)
    )
      throw bad('Invalid search query');
    return providerFor(ctx, g).search(query);
  });
  app.get('/api/games/:game/sets/:setId', async (req, reply) => {
    reader(req);
    limit.check(req.user?.id ?? req.ip, reply);
    const g = game(req),
      id = (req.params as { setId: string }).setId;
    const language = String(
      (req.query as { language?: string }).language ?? 'en',
    );
    if (!games.require(g).languages.some((l) => l.code === language))
      throw bad('Unsupported language');
    const cards = await providerFor(ctx, g).setCards(id, language);
    const row = ctx.db.get<{ synced_at: number }>(
      'SELECT synced_at FROM tcg_catalogues WHERE game = ? AND set_id = ? AND language = ?',
      g,
      id,
      language,
    );
    return {
      cards,
      complete: !!row && Date.now() - row.synced_at < 24 * 3600_000,
      syncedAt: row?.synced_at ?? null,
    };
  });
  app.get('/api/games/:game/cards/:cardId', async (req, reply) => {
    reader(req);
    limit.check(req.user?.id ?? req.ip, reply);
    const g = game(req),
      id = (req.params as { cardId: string }).cardId;
    const cached = readGameCards(ctx, g, [id])[0];
    if (
      cached &&
      !(cached.details.meldResultId && cached.faces.length === 1) &&
      Date.now() - Date.parse(cached.fetchedAt) < 6 * 3600_000
    )
      return cached;
    try {
      return await providerFor(ctx, g).card(id);
    } catch (e) {
      if (cached) {
        reply.header('x-catalog-stale', '1');
        return cached;
      }
      throw e;
    }
  });
  app.get('/api/games/:game/cards/:cardId/prices', async (req) => {
    reader(req);
    const g = game(req),
      id = (req.params as { cardId: string }).cardId;
    return ctx.db.all(
      'SELECT finish,source,date,price,currency FROM tcg_price_history WHERE game = ? AND card_id = ? ORDER BY date',
      g,
      id,
    );
  });
  app.get('/api/collections/:id/games/:game/state', async (req, reply) => {
    const { id, role } = need(ctx, req, 'read');
    const state = gameState(ctx, id, game(req), role);
    reply.header('etag', `"${state.revision}"`);
    return state;
  });
  app.get('/api/collections/:id/games/:game/movers', async (req) => {
    const { id } = need(ctx, req, 'read'),
      g = game(req);
    const state = gameState(ctx, id, g),
      cards = new Map(state.cards.map((c) => [c.id, c]));
    const days = Number((req.query as { days?: string }).days) === 30 ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 86400_000)
        .toISOString()
        .slice(0, 10),
      eur = currentRates(ctx.db).EUR;
    return state.entries
      .filter((e) => e.quantity > 0 && e.valueUsd === undefined)
      .flatMap((entry) => {
        const card = cards.get(entry.cardId),
          quotes = card?.prices[entry.finish] ?? [];
        const quote =
          quotes.find((q) => q.currency === 'USD') ??
          quotes.find((q) => q.currency === 'EUR');
        if (!card || !quote) return [];
        const previous = ctx.db.get<{ price: number; currency: 'USD' | 'EUR' }>(
          'SELECT price,currency FROM tcg_price_history WHERE game = ? AND card_id = ? AND finish = ? AND source = ? AND date <= ? ORDER BY date DESC LIMIT 1',
          g,
          card.id,
          entry.finish,
          quote.source,
          cutoff,
        );
        if (!previous) return [];
        const before = quoteUsd(
            { ...quote, amount: previous.price, currency: previous.currency },
            eur,
          ),
          valueUsd = cardValue(card, entry.finish, eur)!;
        return [
          {
            cardId: card.id,
            name: card.name,
            finish: entry.finish,
            valueUsd,
            changeUsd: valueUsd - before,
            changePct: before ? ((valueUsd - before) / before) * 100 : null,
          },
        ];
      })
      .sort((a, b) => Math.abs(b.changeUsd) - Math.abs(a.changeUsd))
      .slice(0, 10);
  });
  app.put('/api/collections/:id/games/:game/records', async (req, reply) => {
    const { id } = need(ctx, req, 'write'),
      g = game(req);
    const records = (req.body as { records?: unknown })?.records;
    if (!Array.isArray(records) || records.length > 1000)
      throw bad('Expected at most 1000 records');
    const clean = records.map((r) => cleanGameRecord(ctx, g, r));
    return mutate(ctx, req, reply, () => {
      for (const r of clean) putGameRecord(ctx, id, g, r);
      recordGameValue(ctx, id, g);
      return { ok: true };
    });
  });
  app.delete(
    '/api/collections/:id/games/:game/records/:kind/:recordId',
    async (req, reply) => {
      const { id } = need(ctx, req, 'write'),
        g = game(req),
        { kind, recordId } = req.params as { kind: string; recordId: string };
      return mutate(ctx, req, reply, () => {
        ctx.db.run(
          'UPDATE tcg_records SET deleted_at = ? WHERE collection_id = ? AND game = ? AND kind = ? AND id = ?',
          new Date().toISOString(),
          id,
          g,
          kind,
          recordId,
        );
        recordGameValue(ctx, id, g);
        return { ok: true };
      });
    },
  );
  app.delete('/api/collections/:id/games/:game', async (req, reply) => {
    const { id } = need(ctx, req, 'own'),
      g = game(req);
    return mutate(ctx, req, reply, () => {
      ctx.db.run(
        'DELETE FROM tcg_records WHERE collection_id = ? AND game = ?',
        id,
        g,
      );
      ctx.db.run(
        'DELETE FROM tcg_value_history WHERE collection_id = ? AND game = ?',
        id,
        g,
      );
      return { ok: true };
    });
  });
  app.get('/api/collections/:id/games/:game/export', async (req) => {
    const { id, role } = need(ctx, req, 'read'),
      g = game(req);
    return {
      version: 7,
      exportedAt: new Date().toISOString(),
      games: { [g]: gameState(ctx, id, g, role) },
    };
  });
  app.post('/api/collections/:id/games/:game/import', async (req, reply) => {
    const { id } = need(ctx, req, 'write'),
      g = game(req);
    const b = req.body as { version?: number; games?: Record<string, unknown> };
    if (b?.version !== 7 || !b.games?.[g])
      throw bad('Expected a version-7 export containing this game');
    const raw = b.games[g] as Record<string, unknown>,
      records: GameRecord[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw bad('Invalid game state');
    for (const [key, kind] of [
      ['entries', 'entry'],
      ['graded', 'graded'],
      ['sealed', 'sealed'],
      ['notes', 'note'],
      ['lists', 'list'],
    ] as const) {
      if (raw[key] !== undefined && !Array.isArray(raw[key]))
        throw bad(`Invalid ${key}`);
      for (const row of (raw[key] ?? []) as Record<string, unknown>[]) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
          throw bad(`Invalid ${key} record`);
        records.push({ kind, id: String(row.id), data: row });
      }
    }
    if (raw.wishlist !== undefined && !Array.isArray(raw.wishlist))
      throw bad('Invalid wishlist');
    for (const id of (raw.wishlist ?? []) as string[]) {
      if (typeof id !== 'string') throw bad('Invalid wishlist card');
      records.push({ kind: 'wishlist', id, data: { id } });
    }
    if (records.length > 20_000) throw bad('Import exceeds 20,000 records');
    const ids = [...new Set(records.flatMap(recordCardIds))];
    const known = new Set(readGameCards(ctx, g, ids).map((c) => c.id));
    // Provider hydration keeps imported catalog payloads from poisoning the shared catalogue.
    for (const cardId of ids)
      if (!known.has(cardId)) await providerFor(ctx, g).card(cardId);
    const clean = records.map((r) => cleanGameRecord(ctx, g, r));
    const history = Array.isArray(raw.history)
      ? (raw.history as { date: string; valueUsd: number; cards: number }[])
      : [];
    if (
      history.some(
        (h) =>
          !h ||
          typeof h !== 'object' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(h.date) ||
          !Number.isFinite(h.valueUsd) ||
          h.valueUsd < 0 ||
          !Number.isSafeInteger(h.cards) ||
          h.cards < 0,
      )
    )
      throw bad('Invalid value history');
    return mutate(ctx, req, reply, () => {
      for (const record of clean) putGameRecord(ctx, id, g, record);
      for (const h of history)
        ctx.db.run(
          'INSERT OR IGNORE INTO tcg_value_history (collection_id,game,date,value_usd,cards) VALUES (?,?,?,?,?)',
          id,
          g,
          h.date,
          h.valueUsd,
          h.cards,
        );
      recordGameValue(ctx, id, g);
      return { imported: clean.length };
    });
  });
  app.post('/api/games/:game/decks/resolve', async (req, reply) => {
    requireUser(req);
    limit.check(req.user!.id, reply);
    const g = game(req);
    const tools = games.require(g).deckTools;
    const provider = providerFor(ctx, g);
    if (!tools || !provider.resolve)
      throw bad('No deck text adapter for this game');
    const text = (req.body as { text?: unknown })?.text;
    if (typeof text !== 'string') throw bad('Expected deck text');
    const parsed = tools.parse(text);
    if (parsed.rows.length > 500) throw bad('Too many deck rows');
    const resolved: {
      row: (typeof parsed.rows)[number];
      candidates: TcgCard[];
    }[] = [];
    for (const row of parsed.rows) {
      resolved.push({ row, candidates: await provider.resolve(row) });
    }
    return { resolved, errors: parsed.errors };
  });
  app.post(
    '/api/collections/:id/games/:game/records/:kind/:recordId/pricecharting',
    async (req, reply) => {
      const { id } = need(ctx, req, 'write'),
        g = game(req),
        { kind, recordId } = req.params as { kind: string; recordId: string };
      if (!['graded', 'sealed'].includes(kind))
        throw bad('Only slabs and sealed products can be linked');
      const row = ctx.db.get<{ data: string }>(
        'SELECT data FROM tcg_records WHERE collection_id = ? AND game = ? AND kind = ? AND id = ?',
        id,
        g,
        kind,
        recordId,
      );
      if (!row) throw notFound();
      const data = JSON.parse(row.data);
      const productId = (req.body as { productId?: unknown })?.productId;
      if (typeof productId !== 'string' || !/^\d{1,20}$/.test(productId))
        throw bad('Invalid product ID');
      const product = await pcProduct(ctx, productId);
      const price =
        kind === 'graded'
          ? pcGradedPrice(product, data.company, data.grade)
          : Number(product.raw['new-price'] ?? product.raw['loose-price']) /
            100;
      if (!Number.isFinite(price) || Number(price) < 0)
        throw bad('No matching price is available');
      return mutate(ctx, req, reply, () => {
        const next = { ...data, pcProductId: productId, pcPrice: price };
        putGameRecord(ctx, id, g, {
          kind: kind as 'graded' | 'sealed',
          id: recordId,
          data: next,
        });
        recordGameValue(ctx, id, g);
        return next;
      });
    },
  );
  app.get(
    '/api/collections/:id/games/:game/records/:kind/:recordId/photos',
    async (req) => {
      const { id } = need(ctx, req, 'read'),
        g = game(req),
        { kind, recordId } = req.params as { kind: string; recordId: string };
      return ctx.db.all(
        'SELECT id,added_at AS addedAt FROM tcg_photos WHERE collection_id = ? AND game = ? AND kind = ? AND record_id = ?',
        id,
        g,
        kind,
        recordId,
      );
    },
  );
  app.post(
    '/api/collections/:id/games/:game/records/:kind/:recordId/photos',
    async (req, reply) => {
      const { id } = need(ctx, req, 'write'),
        g = game(req),
        { kind, recordId } = req.params as { kind: string; recordId: string };
      if (
        !['graded', 'sealed'].includes(kind) ||
        !ctx.db.get(
          'SELECT 1 FROM tcg_records WHERE collection_id = ? AND game = ? AND kind = ? AND id = ?',
          id,
          g,
          kind,
          recordId,
        )
      )
        throw notFound();
      const file = await req.file();
      if (!file) throw bad('Choose a photo');
      const bytes = await file.toBuffer(),
        mime = sniffImage(bytes);
      if (!mime) throw bad('Choose a JPEG, PNG or WebP image');
      const photoId = sha256(
        `${req.headers['idempotency-key']}:${id}:${g}:${kind}:${recordId}:${sha256(bytes)}`,
      ).slice(0, 48);
      return mutate(
        ctx,
        req,
        reply,
        () => {
          if (!existsSync(join(ctx.config.dataDir, 'photos', photoId)))
            publishPhoto(ctx, 'photos', photoId, bytes);
          ctx.db.run(
            'INSERT OR IGNORE INTO tcg_photos (id,collection_id,game,kind,record_id,mime,added_at) VALUES (?,?,?,?,?,?,?)',
            photoId,
            id,
            g,
            kind,
            recordId,
            mime,
            new Date().toISOString(),
          );
          return { id: photoId };
        },
        { fingerprint: sha256(bytes) },
      );
    },
  );
  app.get(
    '/api/collections/:id/games/:game/photos/:photoId',
    async (req, reply) => {
      const { id } = need(ctx, req, 'read'),
        g = game(req),
        photoId = (req.params as { photoId: string }).photoId;
      const row = ctx.db.get<{ mime: string }>(
        'SELECT mime FROM tcg_photos WHERE id = ? AND collection_id = ? AND game = ?',
        photoId,
        id,
        g,
      );
      if (
        !row ||
        !/^[\w-]{1,64}$/.test(photoId) ||
        !existsSync(join(ctx.config.dataDir, 'photos', photoId))
      )
        throw notFound();
      return reply
        .type(row.mime)
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(join(ctx.config.dataDir, 'photos', photoId)));
    },
  );
  app.delete(
    '/api/collections/:id/games/:game/photos/:photoId',
    async (req, reply) => {
      const { id } = need(ctx, req, 'write'),
        g = game(req),
        photoId = (req.params as { photoId: string }).photoId;
      return mutate(ctx, req, reply, () => {
        ctx.db.run(
          'DELETE FROM tcg_photos WHERE id = ? AND collection_id = ? AND game = ?',
          photoId,
          id,
          g,
        );
        return { ok: true };
      });
    },
  );
}
