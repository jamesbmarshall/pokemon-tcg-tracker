import { expect, it, vi, afterEach } from 'vitest';
import { boundedBody, parseImportJson, validateImportEnvelope, assertStorage, STORAGE_RESERVE } from '../src/resourceLimits.ts';
import * as fs from 'node:fs';
import type { Ctx } from '../src/context.ts';
afterEach(() => vi.restoreAllMocks());
it('cancels an over-budget stream before reading the rest', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } });
  await expect(boundedBody(new Response(body), 150)).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
});
it('prepares imports in a bounded worker and rejects prototype payloads', async () => {
  await expect(parseImportJson('{"version":6,"collection":[]}')).resolves.toEqual({ version: 6, collection: [] });
  await expect(parseImportJson('{"__proto__":{}}')).rejects.toThrow('Invalid');
  await expect(parseImportJson('{bad')).rejects.toThrow('Invalid');
});
it('rejects excessive or incorrectly shaped records before writes', () => {
  expect(() => validateImportEnvelope({ collection: {} })).toThrow('array');
  expect(() => validateImportEnvelope({ collection: Array(100_001).fill(null) })).toThrow('Too many');
  expect(() => validateImportEnvelope({ lists: Array(201).fill(null) })).toThrow('Too many');
});
it('refuses admission when accepting the write would consume the safety reserve', () => {
  const inspect = (() => ({ bavail: STORAGE_RESERVE + 100, bsize: 1 } as fs.StatsFs));
  const ctx = { config: { dataDir: '/tmp' } } as Ctx;
  expect(() => assertStorage(ctx, 101, inspect)).toThrow('Storage is too full');
  expect(() => assertStorage(ctx, 99, inspect)).not.toThrow();
});
