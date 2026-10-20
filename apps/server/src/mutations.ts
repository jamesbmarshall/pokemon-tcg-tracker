import type { FastifyReply, FastifyRequest } from 'fastify';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, requireUser, type Ctx } from './context.ts';
import { sha256 } from './security.ts';

export const WRITE_PROTOCOL = 1;
export const revisionOf = (ctx: Ctx, id: string) => ctx.db.get<{ revision: number }>('SELECT revision FROM collections WHERE id = ?', id)?.revision;

const protectedInstances = new WeakSet<Ctx>();
function protectRollback(ctx: Ctx) {
  if (protectedInstances.has(ctx)) return;
  const dir = join(ctx.config.dataDir, 'app');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'write-protocol-floor.json');
  const staged = `${file}.tmp`;
  writeFileSync(staged, JSON.stringify({ protocol: WRITE_PROTOCOL }), { mode: 0o600 });
  const fd = openSync(staged, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(staged, file);
  const parent = openSync(dir, 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
  protectedInstances.add(ctx);
}

/** All user-data writes and their retry receipt commit together. fn MUST be synchronous:
 * external lookups and upload decoding belong before this call, not inside its transaction.
 */
export function mutate<T>(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, fn: () => T, options: { delta?: boolean; fingerprint?: string } = {}): T {
  const user = requireUser(req);
  const id = (req.params as { id: string }).id;
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new HttpError(428, 'Reload the app before saving. A mutation key is required.', 'mutation_key_required');
  const digest = sha256(JSON.stringify([req.method, req.routeOptions.url, req.params, req.body ?? null, options.fingerprint ?? null]));
  return ctx.db.tx(() => {
    const collection = ctx.db.get<{ owner_id: string; revision: number }>('SELECT owner_id, revision FROM collections WHERE id = ?', id);
    const receipt = ctx.db.get<{ digest: string; response: string; revision: number }>('SELECT digest, response, revision FROM mutation_receipts WHERE actor_id = ? AND collection_id = ? AND operation_key = ?', user.id, id, key);
    // Deleted collections may only replay this actor's own successful delete acknowledgement.
    const deletedReplay = !collection && req.method === 'DELETE' && req.routeOptions.url === '/api/collections/:id' && receipt;
    if (!collection && !deletedReplay) throw new HttpError(404, 'Collection not found', 'not_found');
    if (collection && collection.owner_id !== user.id) {
      const member = ctx.db.get<{ role: string }>('SELECT role FROM collection_members WHERE collection_id = ? AND user_id = ?', id, user.id);
      const selfLeave = req.method === 'DELETE' && req.routeOptions.url === '/api/collections/:id/members/:userId' && (req.params as { userId?: string }).userId === user.id;
      if (!member && !(selfLeave && receipt)) throw new HttpError(404, 'Collection not found', 'not_found');
      if (member?.role !== 'editor' && !selfLeave) throw new HttpError(403, 'You cannot edit this collection', 'forbidden');
    }
    if (receipt) {
      if (receipt.digest !== digest) throw new HttpError(409, 'This mutation key was already used for a different change.', 'mutation_key_reused');
      reply.header('etag', `"${collection?.revision ?? receipt.revision}"`);
      reply.header('x-mutation-replayed', '1');
      return JSON.parse(receipt.response) as T;
    }
    const expected = req.headers['if-match'];
    if (!options.delta && (typeof expected !== 'string' || !/^"\d+"$/.test(expected))) throw new HttpError(428, 'Reload the collection before saving. A revision is required.', 'revision_required');
    if (!options.delta && expected !== `"${collection!.revision}"`) throw new HttpError(409, 'This collection changed on another device. Reload and review your edit before saving again.', 'revision_conflict');
    // Persist the compatibility floor before accepting any new-protocol write.
    protectRollback(ctx);
    const result = fn();
    if (result && typeof result === 'object' && 'then' in result) throw new Error('Mutation callbacks must be synchronous');
    const revision = collection!.revision + 1;
    ctx.db.run('UPDATE collections SET revision = ? WHERE id = ?', revision, id);
    ctx.db.run('INSERT INTO mutation_receipts (actor_id, collection_id, operation_key, digest, response, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', user.id, id, key, digest, JSON.stringify(result ?? null), revision, new Date().toISOString());
    reply.header('etag', `"${revision}"`);
    return result;
  });
}
