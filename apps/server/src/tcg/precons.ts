import type {
  PreconCard,
  PreconDetail,
  PreconSummary,
  ResolvedPrecon,
} from '@poketracker/shared/tcg/precons';
import type { ScryfallCard } from '@poketracker/shared/tcg/scryfall';
import { cachedUpstream } from '../catalog.ts';
import { bad, HttpError, notFound, type Ctx } from '../context.ts';
import { sha256 } from '../security.ts';
import {
  readGameCards,
  saveGameCards,
  scryfallGate,
  normalizeScryfall,
} from './provider.ts';

const MTGJSON = 'https://mtgjson.com/api/v5';
const DAY = 24 * 3600_000;
const FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
interface IndexRow {
  fileName: string;
  code: string;
  name: string;
  releaseDate: string;
  type: string;
  source?: string;
}
interface DeckCard {
  name: string;
  count: number;
  setCode: string;
  number: string;
  isFoil?: boolean;
  finishes?: string[];
  identifiers?: { scryfallId?: string };
}
interface DeckData {
  name: string;
  code: string;
  commander: DeckCard[];
  mainBoard: DeckCard[];
}
function httpsUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
async function mtgjson<T>(
  ctx: Ctx,
  path: string,
): Promise<{ data: T; stale: boolean }> {
  const result = await cachedUpstream(
    ctx,
    'mtgjson',
    `mtgjson:${path}`,
    `${MTGJSON}/${path}`,
    { headers: { accept: 'application/json' }, redirect: 'error' },
    DAY,
  );
  if (result.status !== 200)
    throw new HttpError(502, 'The precon catalogue is unavailable', 'upstream');
  try {
    return {
      data: (JSON.parse(result.body.toString()) as { data: T }).data,
      stale: !result.fresh,
    };
  } catch {
    throw new HttpError(
      502,
      'The precon catalogue returned invalid data',
      'upstream',
    );
  }
}
/** Kept separate from card providers so more games can register a deck catalogue. */
export interface PreconProvider {
  list(): Promise<{ decks: PreconSummary[]; stale: boolean }>;
  detail(id: string): Promise<PreconDetail>;
  resolve(id: string): Promise<ResolvedPrecon>;
}
export function magicPrecons(ctx: Ctx): PreconProvider {
  const list = async () => {
    const result = await mtgjson<IndexRow[]>(ctx, 'DeckList.json');
    if (!Array.isArray(result.data))
      throw new HttpError(
        502,
        'The precon catalogue returned invalid data',
        'upstream',
      );
    const decks = result.data
      .filter(
        (r) =>
          r != null &&
          typeof r === 'object' &&
          r.type === 'Commander Deck' &&
          typeof r.fileName === 'string' &&
          FILE.test(r.fileName) &&
          typeof r.name === 'string' &&
          typeof r.code === 'string' &&
          typeof r.releaseDate === 'string',
      )
      .map(
        (r): PreconSummary => ({
          id: r.fileName,
          game: 'mtg',
          name: r.name,
          setCode: r.code,
          releaseDate: r.releaseDate,
          format: 'commander',
          sourceUrl: httpsUrl(r.source),
        }),
      )
      .sort(
        (a, b) =>
          b.releaseDate.localeCompare(a.releaseDate) ||
          a.name.localeCompare(b.name),
      );
    return { decks, stale: result.stale };
  };
  const detail = async (id: string): Promise<PreconDetail> => {
    if (!FILE.test(id)) throw bad('Invalid precon ID');
    const catalogue = await list();
    const summary = catalogue.decks.find((d) => d.id === id);
    if (!summary) throw notFound('Precon not found');
    const result = await mtgjson<DeckData>(ctx, `decks/${id}.json`);
    const raw = result.data;
    if (
      !raw ||
      raw.name !== summary.name ||
      raw.code !== summary.setCode ||
      !Array.isArray(raw.commander) ||
      !Array.isArray(raw.mainBoard)
    )
      throw new HttpError(502, 'The precon decklist is incomplete', 'upstream');
    const cards: PreconCard[] = [];
    for (const [zone, rows] of [
      ['commander', raw.commander],
      ['main', raw.mainBoard],
    ] as const) {
      if (rows.length > 500)
        throw new HttpError(
          502,
          'The precon decklist is too large',
          'upstream',
        );
      for (const row of rows) {
        if (
          !row ||
          typeof row !== 'object' ||
          typeof row.name !== 'string' ||
          !Number.isInteger(row.count) ||
          row.count < 1 ||
          row.count > 1000 ||
          typeof row.setCode !== 'string' ||
          typeof row.number !== 'string' ||
          (row.isFoil !== undefined && typeof row.isFoil !== 'boolean') ||
          (row.finishes !== undefined &&
            (!Array.isArray(row.finishes) ||
              row.finishes.some((finish) => typeof finish !== 'string')))
        )
          throw new HttpError(
            502,
            'The precon contains invalid card data',
            'upstream',
          );
        cards.push({
          name: row.name,
          quantity: row.count,
          zone,
          finish: row.isFoil
            ? row.finishes?.includes('etched') && !row.finishes.includes('foil')
              ? 'etched'
              : 'foil'
            : 'nonfoil',
          setCode: row.setCode,
          number: row.number,
          providerId:
            typeof row.identifiers?.scryfallId === 'string' &&
            UUID.test(row.identifiers.scryfallId)
              ? row.identifiers.scryfallId.toLowerCase()
              : '',
        });
      }
    }
    // Display commanders, tokens and auxiliary cards aren't part of the playable 100.
    for (const card of cards)
      if (card.providerId) {
        card.cardId = `mtg:${card.providerId}`;
        card.image = `https://cards.scryfall.io/normal/front/${card.providerId[0]}/${card.providerId[1]}/${card.providerId}.jpg`;
      }
    const total = cards.reduce((n, c) => n + c.quantity, 0);
    if (!cards.length || total > 1000)
      throw new HttpError(502, 'The precon decklist is incomplete', 'upstream');
    return {
      ...summary,
      cards,
      total,
      attribution:
        'Decklists from MTGJSON. Magic: The Gathering © Wizards of the Coast.',
      catalogueUrl: 'https://mtgjson.com/',
      stale: catalogue.stale || result.stale,
    };
  };
  return {
    list,
    detail,
    async resolve(id) {
      const deck = await detail(id);
      const ids = [
        ...new Set(deck.cards.map((c) => c.providerId).filter(Boolean)),
      ];
      const known = readGameCards(
        ctx,
        'mtg',
        ids.map((id) => `mtg:${id}`),
      );
      const knownIds = new Set(known.map((c) => c.providerId));
      const missing = ids.filter((id) => !knownIds.has(id));
      for (let n = 0; n < missing.length; n += 75) {
        const batch = missing.slice(n, n + 75).sort();
        await scryfallGate(ctx);
        const result = await cachedUpstream(
          ctx,
          'scryfall',
          `scryfall:precon:${sha256(JSON.stringify(batch))}`,
          'https://api.scryfall.com/cards/collection',
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }),
          },
          6 * 3600_000,
        );
        if (result.status !== 200)
          throw new HttpError(
            502,
            'Card printings could not be loaded. Try again.',
            'upstream',
          );
        let raw: { data?: ScryfallCard[] } | null;
        try {
          raw = JSON.parse(result.body.toString());
        } catch {
          throw new HttpError(
            502,
            'The card provider returned invalid data',
            'upstream',
          );
        }
        if (
          !raw ||
          !Array.isArray(raw.data) ||
          raw.data.some(
            (c) => !c || typeof c !== 'object' || typeof c.id !== 'string',
          )
        )
          throw new HttpError(
            502,
            'The card provider returned invalid data',
            'upstream',
          );
        const at =
          ctx.db.get<{ fetched_at: number }>(
            'SELECT fetched_at FROM http_cache WHERE key = ?',
            `scryfall:precon:${sha256(JSON.stringify(batch))}`,
          )?.fetched_at ?? Date.now();
        saveGameCards(
          ctx,
          raw.data
            .filter((c) => batch.includes(c.id))
            .map((c) => normalizeScryfall(c, new Date(at).toISOString()))
            .filter((c) => c.paper),
        );
      }
      const cards = readGameCards(
        ctx,
        'mtg',
        ids.map((id) => `mtg:${id}`),
      ).filter((c) => c.paper);
      const byId = new Map(cards.map((c) => [c.providerId, c]));
      const items: ResolvedPrecon['items'] = [];
      const bySection = new Map<string, ResolvedPrecon['items'][number]>();
      const unresolved: PreconCard[] = [];
      for (const row of deck.cards) {
        const card = byId.get(row.providerId);
        if (!card) {
          unresolved.push(row);
          continue;
        }
        const key = `${card.id}:${row.zone}`;
        const existing = bySection.get(key);
        if (existing) existing.quantity += row.quantity;
        else {
          const item = {
            cardId: card.id,
            zone: row.zone,
            quantity: row.quantity,
          };
          items.push(item);
          bySection.set(key, item);
        }
      }
      return { cards, items, unresolved };
    },
  };
}
const providers = new Map<string, (ctx: Ctx) => PreconProvider>([
  ['mtg', magicPrecons],
]);
export function preconsFor(ctx: Ctx, game: string): PreconProvider {
  const factory = providers.get(game);
  if (!factory) throw notFound('No precon catalogue for this game');
  return factory(ctx);
}
