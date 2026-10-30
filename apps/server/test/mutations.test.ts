import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { executeCollectionCommand, mutate, revisionOf } from '../src/mutations.ts';
import { startServer, setupOwner, personalId, type TestServer } from './helpers.ts';
let s: TestServer;
beforeEach(async () => { s = await startServer(); });
afterEach(async () => { await s.close(); });

it('commits a mutation and its receipt together, and rejects stale or mismatched replays', async () => {
  const owner = await setupOwner(s.app); const id = await personalId(owner);
  const user = (await owner.get('/api/auth/me')).json().user;
  const req = { user, params: { id }, headers: { 'idempotency-key': 'audit-operation-1', 'if-match': '"0"' }, method: 'PATCH', routeOptions: { url: '/api/collections/:id' }, body: { name: 'Saved' } } as unknown as FastifyRequest;
  const reply = { header: () => reply } as unknown as FastifyReply;
  const write = () => { s.ctx.db.run('UPDATE collections SET name = ? WHERE id = ?', 'Saved', id); return { ok: true }; };
  expect(mutate(s.ctx, req, reply, write)).toEqual({ ok: true });
  expect(revisionOf(s.ctx, id)).toBe(1);
  expect(mutate(s.ctx, req, reply, () => { throw new Error('Replay executed twice'); })).toEqual({ ok: true });
  req.body = { name: 'Different' };
  expect(() => mutate(s.ctx, req, reply, write)).toThrow('different change');
  req.headers['idempotency-key'] = 'audit-operation-2';
  expect(() => mutate(s.ctx, req, reply, write)).toThrow('another device');
  req.headers['if-match'] = '"1"';
  expect(() => mutate(s.ctx, req, reply, () => { write(); throw new Error('abort'); })).toThrow('abort');
  expect(revisionOf(s.ctx, id)).toBe(1);
  expect(s.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mutation_receipts')!.n).toBe(1);
});


it('runs commands without HTTP objects while preserving authorization, rollback and replay', async () => {
  const owner = await setupOwner(s.app);
  const id = await personalId(owner);
  const actorId = (await owner.get('/api/auth/me')).json().user.id as string;
  const command = { actorId, collectionId: id, key: 'service-command-1', digest: 'operation-and-body', expectedRevision: '"0"' };
  const write = () => { s.ctx.db.run('UPDATE collections SET name = ? WHERE id = ?', 'Command name', id); return { ok: true }; };
  expect(() => executeCollectionCommand(s.ctx, { ...command, actorId: 'foreign-user' }, write)).toThrow('Collection not found');
  expect(() => executeCollectionCommand(s.ctx, command, () => { write(); throw new Error('abort'); })).toThrow('abort');
  expect(revisionOf(s.ctx, id)).toBe(0);
  expect(s.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mutation_receipts')!.n).toBe(0);
  expect(executeCollectionCommand(s.ctx, command, write)).toEqual({ value: { ok: true }, revision: 1, replayed: false });
  expect(executeCollectionCommand(s.ctx, command, () => { throw new Error('Duplicate write'); })).toEqual({ value: { ok: true }, revision: 1, replayed: true });
  expect(() => executeCollectionCommand(s.ctx, { ...command, digest: 'changed' }, write)).toThrow('different change');
  expect(() => executeCollectionCommand(s.ctx, { ...command, key: 'service-command-2' }, write)).toThrow('another device');
});
