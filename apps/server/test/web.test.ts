import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './helpers.ts';

describe('web app serving', () => {
  let s: TestServer;
  let web: string;

  beforeAll(async () => {
    web = mkdtempSync(join(tmpdir(), 'pt-web-'));
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
    s = await startServer({ WEB_DIR: web });
  });
  afterAll(async () => {
    await s.close();
    rmSync(web, { recursive: true, force: true });
  });

  it('serves the SPA shell for client-side routes, uncached', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/sets/sv1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('answers HEAD for uptime monitors', async () => {
    const res = await s.app.inject({ method: 'HEAD', url: '/' });
    expect(res.statusCode).toBe(200);
  });

  it('caches hashed assets for a year', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('marks public share pages noindex', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/s/sometoken' });
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('404s unknown API routes and missing files instead of returning the shell', async () => {
    expect((await s.app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'GET', url: '/missing.png' })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'POST', url: '/sets' })).statusCode).toBe(404);
  });

  it('allows the web app manifest and service worker under the CSP', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/' });
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
  });
});
