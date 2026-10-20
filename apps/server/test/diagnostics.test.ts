import { beforeEach, afterEach, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnostics } from '../src/diagnostics.ts';
import { startServer, setupOwner, invite, type TestServer } from './helpers.ts';
let s: TestServer;
beforeEach(async () => { s = await startServer(); });
afterEach(async () => { await s.close(); });
it('separates liveness, readiness and owner diagnostics without probing writes', async () => {
  expect((await s.app.inject('/health')).statusCode).toBe(200);
  expect((await s.app.inject('/ready')).statusCode).toBe(200);
  const c = await setupOwner(s.app); const member = await invite(c, s.app, 'misty');
  expect((await member.get('/api/admin/diagnostics')).statusCode).toBe(403);
  expect((await c.get('/api/admin/diagnostics')).json().recovery.state).toBe('not_configured');
  s.ctx.services.isStopping = () => true;
  expect((await s.app.inject('/ready')).statusCode).toBe(503);
  expect((await s.app.inject('/health')).statusCode).toBe(200);
});
it('uses captured remote data age and preserves independent verification status', () => {
  const path = join(s.dir, 'recovery-status.json');
  writeFileSync(path, JSON.stringify({ version: 1, lastSuccessfulCaptureAt: new Date(Date.now() - 61 * 60_000).toISOString(), lastUploadedAt: new Date().toISOString(), repositoryPassword: 'must not escape' }));
  expect(diagnostics(s.ctx).recovery).toMatchObject({ state: 'overdue', verificationOverdue: true });
  writeFileSync(path, JSON.stringify({ version: 1, lastSuccessfulCaptureAt: new Date().toISOString(), lastUploadedAt: new Date().toISOString(), verificationError: 'verification_failed' }));
  expect(diagnostics(s.ctx).recovery).toMatchObject({ state: 'current', verificationError: 'verification_failed', verifiedAt: null });
  expect(JSON.stringify(diagnostics(s.ctx))).not.toContain('must not escape');
});
