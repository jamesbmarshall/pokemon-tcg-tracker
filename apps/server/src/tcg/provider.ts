import type {
  TcgProvider,
  TcgSearch,
  TcgPage,
  TcgCard,
  TcgSet,
} from '@poketracker/shared/tcg/types';
import {
  fromScryfall,
  scryfallSet,
  scryfallQuery,
  type ScryfallCard,
} from '@poketracker/shared/tcg/scryfall';
import { cachedUpstream } from '../catalog.ts';
import { HttpError, bad, type Ctx } from '../context.ts';
const BASE = 'https://api.scryfall.com';
interface Page {
  data: ScryfallCard[];
  has_more: boolean;
  total_cards?: number;
}
const delays = new WeakMap<Ctx, Promise<void>>();
/** One request gate per instance, including concurrent searches and jobs. */
async function gate(ctx: Ctx) {
  const previous = delays.get(ctx) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 110)));
  delays.set(ctx, next);
  await next;
}
export async function scryfallJson<T>(
  ctx: Ctx,
  path: string,
  ttl = 6 * 3600_000,
  observe?: (metadata: { at: number; stale: boolean }) => void,
): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw bad('Invalid catalogue path');
  // Gate only network misses; cachedUpstream still provides retry/circuit-breaker/stale fallback.
  await gate(ctx);
  const r = await cachedUpstream(
    ctx,
    'scryfall',
    `scryfall:${path}`,
    `${BASE}${path}`,
    { headers: { accept: 'application/json' } },
    ttl,
  );
  if (r.status === 404)
    throw new HttpError(404, 'No matching Magic cards were found', 'not_found');
  if (r.status !== 200)
    throw new HttpError(502, 'Magic catalogue is unavailable', 'upstream');
  const cached = ctx.db.get<{ fetched_at: number }>(
    'SELECT fetched_at FROM http_cache WHERE key = ?',
    `scryfall:${path}`,
  );
  observe?.({ at: cached?.fetched_at ?? Date.now(), stale: !r.fresh });
  return JSON.parse(r.body.toString()) as T;
}
export function saveGameCards(ctx: Ctx, cards: TcgCard[]) {
  ctx.db.tx(() => {
    for (const c of cards) {
      const previous = ctx.db.get<{ fetched_at: number }>(
        'SELECT fetched_at FROM tcg_cards WHERE game = ? AND id = ?',
        c.game,
        c.id,
      );
      const at = Date.parse(c.fetchedAt);
      if (previous && previous.fetched_at > at) continue;
      ctx.db.run(
        'INSERT OR REPLACE INTO tcg_cards (game,id,set_id,data,fetched_at) VALUES (?,?,?,?,?)',
        c.game,
        c.id,
        c.setId,
        JSON.stringify(c),
        at,
      );
      for (const [finish, quotes] of Object.entries(c.prices))
        for (const q of quotes)
          ctx.db.run(
            'INSERT OR REPLACE INTO tcg_price_history (game,card_id,finish,source,date,price,currency) VALUES (?,?,?,?,?,?,?)',
            c.game,
            c.id,
            finish,
            q.source,
            q.at.slice(0, 10),
            q.amount,
            q.currency,
          );
    }
  });
}
export function readGameCards(
  ctx: Ctx,
  game: string,
  ids?: string[],
): TcgCard[] {
  if (!ids)
    return ctx.db
      .all<{ data: string }>('SELECT data FROM tcg_cards WHERE game = ?', game)
      .map((r) => JSON.parse(r.data));
  const out: TcgCard[] = [];
  for (let n = 0; n < ids.length; n += 400) {
    const part = ids.slice(n, n + 400);
    if (!part.length) continue;
    out.push(
      ...ctx.db
        .all<{
          data: string;
        }>(
          `SELECT data FROM tcg_cards WHERE game = ? AND id IN (${part.map(() => '?').join(',')})`,
          game,
          ...part,
        )
        .map((r) => JSON.parse(r.data) as TcgCard),
    );
  }
  return out;
}
export function magicProvider(ctx: Ctx): TcgProvider {
  async function search(query: TcgSearch): Promise<TcgPage> {
    const params = new URLSearchParams({
      q: scryfallQuery(query),
      unique: 'prints',
      order: 'set',
      page: String(Math.max(1, Math.min(1000, Number(query.page) || 1))),
    });
    let page: Page;
    let metadata = { at: Date.now(), stale: false };
    try {
      page = await scryfallJson<Page>(
        ctx,
        `/cards/search?${params}`,
        6 * 3600_000,
        (value) => {
          metadata = value;
        },
      );
    } catch (e) {
      if (e instanceof HttpError && e.status === 404)
        return { cards: [], total: 0, hasMore: false };
      throw e;
    }
    const cards = page.data
      .map((c) => fromScryfall(c, new Date(metadata.at).toISOString()))
      .filter((c) => c.paper);
    saveGameCards(ctx, cards);
    const canonical = new Map(
      readGameCards(
        ctx,
        'mtg',
        cards.map((card) => card.id),
      ).map((card) => [card.id, card]),
    );
    return {
      cards: cards.map((card) => canonical.get(card.id) ?? card),
      hasMore: page.has_more,
      total: page.total_cards ?? cards.length,
      stale: metadata.stale,
    };
  }
  return {
    name: 'scryfall',
    game: 'mtg',
    async resolve(row) {
      const query =
        row.set && row.number
          ? { set: row.set, number: row.number }
          : { q: `!"${row.name.replace(/["\\]/g, '')}"`, language: 'en' };
      const page = await search(query);
      return page.cards.filter(
        (c) =>
          c.name.toLowerCase() === row.name.toLowerCase() ||
          c.printedName?.toLowerCase() === row.name.toLowerCase(),
      );
    },
    search,
    async sets(): Promise<TcgSet[]> {
      const result = await scryfallJson<{
        data: Parameters<typeof scryfallSet>[0][];
      }>(ctx, '/sets');
      const sets = result.data
        .filter(
          (s) =>
            ![
              'alchemy',
              'treasure_chest',
              'masters_online',
              'vanguard',
            ].includes(s.set_type ?? ''),
        )
        .map(scryfallSet);
      ctx.db.tx(() => {
        for (const set of sets)
          ctx.db.run(
            'INSERT OR REPLACE INTO tcg_sets (game,id,data) VALUES (?,?,?)',
            'mtg',
            set.id,
            JSON.stringify(set),
          );
      });
      return sets;
    },
    async card(id) {
      if (!/^mtg:[a-f0-9-]{36}$/.test(id)) throw bad('Invalid Magic card ID');
      let at = Date.now();
      const raw = await scryfallJson<ScryfallCard>(
        ctx,
        `/cards/${id.slice(4)}`,
        6 * 3600_000,
        (metadata) => {
          at = metadata.at;
        },
      );
      const card = fromScryfall(raw, new Date(at).toISOString());
      if (
        card.details.meldResultId &&
        /^[a-f0-9-]{36}$/.test(card.details.meldResultId)
      ) {
        const result = fromScryfall(
          await scryfallJson<ScryfallCard>(
            ctx,
            `/cards/${card.details.meldResultId}`,
          ),
        );
        card.faces = [...card.faces, ...result.faces];
      }
      if (!card.paper) throw bad('This printing is not a paper card');
      saveGameCards(ctx, [card]);
      return readGameCards(ctx, 'mtg', [card.id])[0] ?? card;
    },
    async setCards(id, language) {
      if (!/^mtg:[a-z0-9]{2,12}$/.test(id)) throw bad('Invalid Magic set');
      const previous = ctx.db.get<{ data: string; synced_at: number }>(
        'SELECT * FROM tcg_catalogues WHERE game = ? AND set_id = ? AND language = ?',
        'mtg',
        id,
        language,
      );
      if (previous && Date.now() - previous.synced_at < 24 * 3600_000)
        return JSON.parse(previous.data);
      try {
        const cards: TcgCard[] = [];
        let page = 1;
        while (page <= 100) {
          const result = await search({ set: id.slice(4), language, page });
          if (result.stale)
            throw new HttpError(
              502,
              'The set catalogue is out of date; retry when the provider recovers',
              'upstream',
            );
          cards.push(...result.cards);
          if (!result.hasMore) break;
          page++;
        }
        if (page > 100) throw new Error('Set catalogue exceeded page limit');
        ctx.db.run(
          'INSERT OR REPLACE INTO tcg_catalogues (game,set_id,language,data,synced_at) VALUES (?,?,?,?,?)',
          'mtg',
          id,
          language,
          JSON.stringify(cards),
          Date.now(),
        );
        return cards;
      } catch (e) {
        if (previous) return JSON.parse(previous.data);
        throw e;
      }
    },
  };
}
/** Provider registry is separate from the game/rules registry. */
export function providerFor(ctx: Ctx, game: string): TcgProvider {
  const factories: Record<string, (ctx: Ctx) => TcgProvider> = {
    mtg: magicProvider,
  };
  const factory = factories[game];
  if (!factory) throw bad('This game uses the legacy catalogue adapter');
  return factory(ctx);
}
