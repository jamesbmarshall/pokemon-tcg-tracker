import type {
  GameRecord,
  GameState,
  Holding,
  Slab,
  SealedProduct,
  TcgList,
  TcgCard,
} from '@poketracker/shared/tcg/types';
import { games } from '@poketracker/shared/tcg/registry';
import { collectionValue, holdingId } from '@poketracker/shared/tcg/collection';
import { bad, now, type Ctx } from '../context.ts';
import { revisionOf } from '../mutations.ts';
import { currentRates } from '../cards.ts';
import { readGameCards } from './provider.ts';
const obj = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw bad('Expected an object');
  return value as Record<string, unknown>;
};
const string = (value: unknown, max = 1000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const number = (value: unknown, max = 1_000_000_000) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  )
    throw bad('Invalid non-negative number');
  return value;
};
const quantity = (value: unknown) => {
  const n = number(value, 100_000);
  if (!Number.isInteger(n)) throw bad('Quantity must be a whole number');
  return n;
};
const optionalValue = (value: unknown) =>
  value == null ? undefined : number(value);
const paid = (value: unknown): Holding['paid'] => {
  if (value == null) return;
  const p = obj(value);
  if (!['USD', 'EUR', 'GBP'].includes(String(p.currency)))
    throw bad('Unsupported purchase currency');
  return {
    amount: number(p.amount),
    currency: p.currency as 'USD' | 'EUR' | 'GBP',
  };
};
export function recordCardIds(raw: unknown): string[] {
  const record = obj(raw);
  const d = obj(record.data);
  if (record.kind === 'list')
    return Array.isArray(d.items)
      ? d.items.flatMap((item) => {
          const value = obj(item);
          return typeof value.cardId === 'string' ? [value.cardId] : [];
        })
      : [];
  if (record.kind === 'note' || record.kind === 'wishlist') {
    if (typeof record.id !== 'string') throw bad('Invalid card ID');
    return [record.id];
  }
  return typeof d.cardId === 'string' ? [d.cardId] : [];
}
export function cleanGameRecord(
  ctx: Ctx,
  game: string,
  raw: unknown,
  catalogue?: ReadonlyMap<string, TcgCard>,
): GameRecord {
  const r = obj(raw),
    d = obj(r.data),
    kind = String(r.kind) as GameRecord['kind'];
  const module = games.require(game);
  if ((kind === 'entry' || kind === 'graded') && typeof d.finish !== 'string')
    throw bad('Choose a finish for this printing');
  let id = string(r.id, 180);
  if (!/^[\w:.-]{1,180}$/.test(id)) throw bad('Invalid record ID');
  const stamp =
    typeof d.addedAt === 'string' && Number.isFinite(Date.parse(d.addedAt))
      ? new Date(d.addedAt).toISOString()
      : now();
  const card = (id: unknown, finish?: unknown): TcgCard => {
    if (typeof id !== 'string' || !id.startsWith(`${game}:`))
      throw bad('Card belongs to another game');
    const found = catalogue
      ? catalogue.get(id)
      : readGameCards(ctx, game, [id])[0];
    if (!found) throw bad('Load the card from the catalogue before adding it');
    if (
      finish !== undefined &&
      (typeof finish !== 'string' || !found.finishes.includes(finish))
    )
      throw bad('This finish is not available for this printing');
    return found;
  };
  let data: unknown;
  if (kind === 'entry') {
    const c = card(d.cardId, d.finish);
    id = holdingId(c.id, String(d.finish));
    const condition = string(d.condition, 4);
    if (condition && !['M', 'NM', 'LP', 'MP', 'HP', 'DMG'].includes(condition))
      throw bad('Invalid condition');
    data = {
      id,
      cardId: c.id,
      finish: String(d.finish),
      quantity: quantity(d.quantity),
      condition: condition || undefined,
      valueUsd: optionalValue(d.valueUsd),
      paid: paid(d.paid),
      notes: string(d.notes, 5000) || undefined,
      addedAt: stamp,
    } satisfies Holding;
  } else if (kind === 'wishlist' || kind === 'note') {
    card(id);
    data = kind === 'note' ? { id, text: string(d.text, 5000) } : { id };
  } else if (kind === 'graded') {
    const c = card(d.cardId, d.finish);
    if (!module.capabilities.graded) throw bad('Grading is not supported');
    if (!string(d.company, 40) || !string(d.grade, 30))
      throw bad('Enter grader and grade');
    data = {
      id,
      cardId: c.id,
      finish: String(d.finish),
      company: string(d.company, 40),
      grade: string(d.grade, 30),
      certNumber: string(d.certNumber, 100),
      countsTowardSet: d.countsTowardSet === true,
      valueUsd: optionalValue(d.valueUsd),
      paid: paid(d.paid),
      notes: string(d.notes, 5000),
      addedAt: stamp,
    } satisfies Slab;
  } else if (kind === 'sealed') {
    if (
      !module.capabilities.sealed ||
      !module.sealedTypes.includes(String(d.productType))
    )
      throw bad('Unsupported sealed product type');
    if (!string(d.name, 200)) throw bad('Enter a product name');
    if (
      d.setId &&
      (typeof d.setId !== 'string' || !d.setId.startsWith(`${game}:`))
    )
      throw bad('Set belongs to another game');
    data = {
      id,
      name: string(d.name, 200),
      productType: String(d.productType),
      setId: string(d.setId, 100) || undefined,
      language: string(d.language, 20) || undefined,
      quantity: quantity(d.quantity),
      status: d.status === 'opened' ? 'opened' : 'sealed',
      valueUsd: optionalValue(d.valueUsd),
      paid: paid(d.paid),
      notes: string(d.notes, 5000),
      addedAt: stamp,
    } satisfies SealedProduct;
  } else if (kind === 'list') {
    const format =
      d.kind === 'deck'
        ? module.formats.find((f) => f.id === d.format)
        : undefined;
    if (
      (d.kind !== 'deck' && d.kind !== 'list') ||
      (d.kind === 'deck' && !format)
    )
      throw bad('Unsupported list or deck format');
    if (
      !string(d.name, 100) ||
      !Array.isArray(d.items) ||
      d.items.length > 1000
    )
      throw bad('Invalid list');
    const seen = new Set<string>();
    const items = d.items.map((rawItem) => {
      const i = obj(rawItem),
        c = card(i.cardId);
      const zone = String(i.zone);
      if (!['main', 'commander', 'companion', 'maybeboard'].includes(zone))
        throw bad('Invalid deck zone');
      if (d.kind === 'list' && zone !== 'main')
        throw bad('Lists only use the main section');
      const key = `${c.id}:${zone}`;
      if (seen.has(key)) throw bad('Duplicate card in deck section');
      seen.add(key);
      const qty = quantity(i.quantity);
      if (qty < 1 || qty > 1000)
        throw bad('Deck quantity must be between 1 and 1000');
      return {
        cardId: c.id,
        quantity: d.kind === 'list' ? 1 : qty,
        zone: zone as 'main' | 'commander' | 'companion' | 'maybeboard',
      };
    });
    data = {
      id,
      game,
      name: string(d.name, 100),
      kind: d.kind,
      format: format?.id,
      description: string(d.description, 500),
      items,
      addedAt: stamp,
    } satisfies TcgList;
  } else throw bad('Unsupported record type');
  return { kind, id, data };
}
export function putGameRecord(
  ctx: Ctx,
  collectionId: string,
  game: string,
  record: GameRecord,
) {
  if (record.kind === 'graded' || record.kind === 'sealed') {
    const row = ctx.db.get<{ data: string }>(
      'SELECT data FROM tcg_records WHERE collection_id = ? AND game = ? AND kind = ? AND id = ?',
      collectionId,
      game,
      record.kind,
      record.id,
    );
    const old = row ? JSON.parse(row.data) : undefined;
    const next = record.data as Record<string, unknown>;
    if (
      old &&
      (record.kind === 'graded'
        ? ['cardId', 'finish', 'company', 'grade']
        : ['name', 'productType', 'setId', 'language']
      ).every((key) => old[key] === next[key]) &&
      next.pcProductId === undefined
    ) {
      record = {
        ...record,
        data: { ...next, pcProductId: old.pcProductId, pcPrice: old.pcPrice },
      };
    }
  }
  ctx.db.run(
    'INSERT INTO tcg_records (collection_id,game,kind,id,data) VALUES (?,?,?,?,?) ON CONFLICT(collection_id,game,kind,id) DO UPDATE SET data=excluded.data,deleted_at=NULL',
    collectionId,
    game,
    record.kind,
    record.id,
    JSON.stringify(record.data),
  );
}
export function gameState(
  ctx: Ctx,
  collectionId: string,
  game: string,
  role = 'viewer',
  includeHistory = true,
): GameState {
  const records = ctx.db.all<{ kind: string; id: string; data: string }>(
    'SELECT kind,id,data FROM tcg_records WHERE collection_id = ? AND game = ? AND deleted_at IS NULL',
    collectionId,
    game,
  );
  const parsed = records.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  const pick = <T>(kind: string) =>
    parsed.filter((r) => r.kind === kind).map((r) => r.data as T);
  const ids = new Set(
    parsed.flatMap((r) =>
      recordCardIds({
        kind: r.kind as GameRecord['kind'],
        id: r.id,
        data: r.data,
      }),
    ),
  );
  return {
    game,
    role,
    revision: revisionOf(ctx, collectionId) ?? 0,
    cards: readGameCards(ctx, game, [...ids]),
    entries: pick('entry'),
    graded: pick('graded'),
    sealed: pick('sealed'),
    wishlist: records.filter((r) => r.kind === 'wishlist').map((r) => r.id),
    notes: pick('note'),
    lists: pick('list'),
    history: includeHistory
      ? ctx.db.all<{ date: string; valueUsd: number; cards: number }>(
          'SELECT date,value_usd AS valueUsd,cards FROM tcg_value_history WHERE collection_id = ? AND game = ? ORDER BY date',
          collectionId,
          game,
        )
      : [],
  };
}
export function recordGameValue(ctx: Ctx, id: string, game: string) {
  const state = gameState(ctx, id, game, 'viewer', false);
  const value = collectionValue(
    state.cards,
    state.entries,
    state.graded,
    state.sealed,
    currentRates(ctx.db).EUR,
  );
  ctx.db.run(
    'INSERT OR REPLACE INTO tcg_value_history (collection_id,game,date,value_usd,cards) VALUES (?,?,?,?,?)',
    id,
    game,
    now().slice(0, 10),
    value.valueUsd,
    value.cards,
  );
}
export interface GameShareOptions {
  game_language?: string;
  scope: string;
  target: string | null;
  hide_paid: number;
  hide_value: number;
  hide_notes: number;
}
/** Construct public DTOs from validated fields, then remove hidden values at every level. */
export function gameShareState(
  ctx: Ctx,
  id: string,
  game: string,
  share: GameShareOptions,
): GameState {
  const s = gameState(ctx, id, game);
  if (share.scope === 'set') {
    const language = share.game_language ?? 'en';
    const rows = ctx.db.all<{ data: string }>(
      'SELECT data FROM tcg_cards WHERE game = ? AND set_id = ?',
      game,
      share.target,
    );
    const catalogue = rows
      .map((row) => JSON.parse(row.data) as TcgCard)
      .filter((card) => card.language === language);
    s.cards = [
      ...new Map(
        [...s.cards, ...catalogue].map((card) => [card.id, card]),
      ).values(),
    ];
  }
  const all = share.scope === 'collection';
  const list = s.lists.find((l) => l.id === share.target);
  const setIds = new Set(
    s.cards
      .filter(
        (c) =>
          c.setId === share.target &&
          c.language === (share.game_language ?? 'en'),
      )
      .map((c) => c.id),
  );
  const ids = all
    ? new Set(s.cards.map((c) => c.id))
    : share.scope === 'set'
      ? setIds
      : share.scope === 'list'
        ? new Set(list?.items.map((i) => i.cardId))
        : share.scope === 'wishlist'
          ? new Set(s.wishlist)
          : share.scope === 'graded'
            ? new Set(s.graded.map((g) => g.cardId))
            : new Set<string>();
  s.entries =
    all || share.scope === 'set' || share.scope === 'list'
      ? s.entries.filter((e) => ids.has(e.cardId))
      : [];
  s.graded =
    all || ['set', 'list', 'graded'].includes(share.scope)
      ? s.graded.filter((g) => ids.has(g.cardId))
      : [];
  s.sealed =
    all || share.scope === 'sealed'
      ? s.sealed
      : share.scope === 'set'
        ? s.sealed.filter(
            (p) =>
              p.setId === share.target &&
              p.language === (share.game_language ?? 'en'),
          )
        : [];
  s.wishlist =
    all || ['set', 'wishlist'].includes(share.scope)
      ? s.wishlist.filter((i) => ids.has(i))
      : [];
  s.notes = share.hide_notes ? [] : s.notes.filter((n) => ids.has(n.id));
  s.lists = all ? s.lists : share.scope === 'list' && list ? [list] : [];
  s.cards = s.cards.filter((c) => ids.has(c.id));
  s.history = all && !share.hide_value ? s.history : [];
  for (const item of [...s.entries, ...s.graded, ...s.sealed]) {
    if (share.hide_paid) delete item.paid;
    if (share.hide_notes) delete item.notes;
    if (share.hide_value) {
      delete item.valueUsd;
      if ('pcPrice' in item) delete item.pcPrice;
      if ('pcProductId' in item) delete item.pcProductId;
    }
  }
  if (share.hide_notes)
    s.lists.forEach((l) => {
      delete l.description;
    });
  if (share.hide_value)
    s.cards.forEach((c) => {
      c.prices = {};
    });
  s.revision = 0;
  return s;
}
