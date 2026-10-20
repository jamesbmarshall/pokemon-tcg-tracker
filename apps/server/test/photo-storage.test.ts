import { beforeEach, afterEach, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishPhoto, pinPhotos, reconcilePhotos } from '../src/photoStorage.ts';
import { startServer, type TestServer } from './helpers.ts';
let s: TestServer;
beforeEach(async () => { s = await startServer(); });
afterEach(async () => { await s.close(); });
it('publishes immutable bytes and protects snapshot pins from garbage collection', () => {
  publishPhoto(s.ctx, 'photos', 'audit-photo', Buffer.from('original'));
  expect(() => publishPhoto(s.ctx, 'photos', 'audit-photo', Buffer.from('replacement'))).toThrow();
  expect(readFileSync(join(s.dir, 'photos/audit-photo'), 'utf8')).toBe('original');
  const release = pinPhotos(s.ctx, [{ kind: 'photos', id: 'audit-photo' }]);
  expect(reconcilePhotos(s.ctx, 0).removed).toBe(0);
  release();
  expect(reconcilePhotos(s.ctx, 0).removed).toBe(1);
  expect(existsSync(join(s.dir, 'photos/audit-photo'))).toBe(false);
  expect(reconcilePhotos(s.ctx, 0).removed).toBe(0);
});
