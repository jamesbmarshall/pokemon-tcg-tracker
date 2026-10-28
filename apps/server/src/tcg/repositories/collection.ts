/** Internal read boundary. Native state is retained until lossless DTO parity is established. */
import type { GameState } from '@poketracker/shared/tcg/types';
import type { ValuePoint } from '@poketracker/shared/types';
import { collectionValue } from '@poketracker/shared/tcg/collection';
import { computeValue } from '@poketracker/shared/value';
import { games } from '@poketracker/shared/tcg/registry';
import { access, collectionState } from '../../collections.ts';
import { currentRates, readHistory } from '../../cards.ts';
import { notFound, type Ctx } from '../../context.ts';
import { gameState } from '../state.ts';

export interface CollectionValuation {
  valueUsd: number;
  cards: number;
  /** Only supplied by policies that calculate unique-card counts. */
  unique?: number;
}
export interface PhotoMetadata {
  id: string;
  kind: 'graded' | 'sealed';
  recordId: string;
  mime: string;
  addedAt: string;
  /** Legacy stores record these; generic stores do not. Never fabricate them. */
  side?: string;
  size?: number;
}
export type HistoryPoint = GameState['history'][number] & Partial<Pick<ValuePoint, 'unique' | 'costUsd' | 'costedValueUsd'>>;
type PokemonState = ReturnType<typeof collectionState>;
interface ReadEnvelope {
  collectionId: string;
  game: string;
  role: string;
  revision: number;
  valuation: CollectionValuation;
}
export type CollectionRead = ReadEnvelope & (
  | { storage: 'pokemon'; state: PokemonState }
  | { storage: 'generic'; state: GameState }
);

/** Scope is fixed at construction; IDs need not carry a game prefix.
 * Repository methods are privileged internals, not authorization checks or public DTOs.
 * Use readCollection() for authenticated member reads. Shares retain their existing
 * scope/redaction path and must never serialize these private snapshots directly.
 */
export interface CollectionRepository {
  read(role: string): CollectionRead;
  history(): HistoryPoint[];
  photos(): PhotoMetadata[];
}

function pokemonRepository(ctx: Ctx, collectionId: string): CollectionRepository {
  return {
    read(role) {
      const state = collectionState(ctx, collectionId);
      const value = computeValue(state.entries, new Map(state.cards.map((card) => [card.id, card])), state.graded, state.sealed);
      return { collectionId, game: 'pokemon', role, revision: state.revision, storage: 'pokemon', state,
        valuation: { valueUsd: value.valueUsd, cards: value.count, unique: value.unique } };
    },
    history: () => readHistory(ctx.db, collectionId),
    photos: () => [
      ...ctx.db.all<PhotoMetadata>(`SELECT p.id, 'graded' AS kind, p.graded_id AS recordId, p.side, p.mime, p.size, p.added_at AS addedAt
        FROM graded_photos p JOIN graded g ON g.collection_id = p.collection_id AND g.id = p.graded_id
        WHERE p.collection_id = ? AND g.deleted_at IS NULL ORDER BY p.added_at, p.id`, collectionId),
      ...ctx.db.all<PhotoMetadata>(`SELECT p.id, 'sealed' AS kind, p.sealed_id AS recordId, p.mime, p.size, p.added_at AS addedAt
        FROM sealed_photos p JOIN sealed s ON s.collection_id = p.collection_id AND s.id = p.sealed_id
        WHERE p.collection_id = ? ORDER BY p.added_at, p.id`, collectionId),
    ],
  };
}
function genericRepository(ctx: Ctx, collectionId: string, game: string): CollectionRepository {
  return {
    read(role) {
      const state = gameState(ctx, collectionId, game, role);
      return { collectionId, game, role, revision: state.revision, storage: 'generic', state,
        valuation: collectionValue(state.cards, state.entries, state.graded, state.sealed, currentRates(ctx.db).EUR) };
    },
    history: () => ctx.db.all<HistoryPoint>('SELECT date,value_usd AS valueUsd,cards FROM tcg_value_history WHERE collection_id = ? AND game = ? ORDER BY date', collectionId, game),
    photos: () => ctx.db.all<PhotoMetadata>(`SELECT p.id, p.kind, p.record_id AS recordId, p.mime, p.added_at AS addedAt
      FROM tcg_photos p JOIN tcg_records r ON r.collection_id = p.collection_id AND r.game = p.game AND r.kind = p.kind AND r.id = p.record_id
      WHERE p.collection_id = ? AND p.game = ? AND p.kind IN ('graded','sealed') AND r.deleted_at IS NULL ORDER BY p.added_at, p.id`, collectionId, game),
  };
}
export function collectionRepository(ctx: Ctx, collectionId: string, game: string): CollectionRepository {
  if (!games.get(game)) throw notFound('Game not found');
  return game === 'pokemon' ? pokemonRepository(ctx, collectionId) : genericRepository(ctx, collectionId, game);
}

/** Synchronous deferred transaction pins all state/valuation/photo reads to one snapshot.
 * It acquires no write reservation and joins an existing transaction when necessary.
 */
function snapshot<T>(ctx: Ctx, read: () => T): T {
  if (ctx.db.raw.isTransaction) return read();
  ctx.db.exec('BEGIN');
  try {
    const result = read();
    ctx.db.exec('COMMIT');
    return result;
  } catch (error) {
    ctx.db.exec('ROLLBACK');
    throw error;
  }
}

/** Member-only service seam. userId must come from an authenticated server session.
 * No route adopts this service until the authorization/compatibility cutover in U11.
 */
export function readCollection(ctx: Ctx, userId: string, collectionId: string, game: string): CollectionRead & { photos: PhotoMetadata[] } {
  return snapshot(ctx, () => {
    const role = access(ctx, userId, collectionId);
    if (!role) throw notFound('Collection not found');
    const repository = collectionRepository(ctx, collectionId, game);
    return { ...repository.read(role), photos: repository.photos() };
  });
}
