import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { Sealer } from '../src/security.ts';
import { buildApp } from '../src/app.ts';
import { ensureSetupToken } from '../src/auth.ts';
import type { Ctx } from '../src/context.ts';

export const SETUP = 'test-setup-token-123';
export const PASSWORD = 'correct horse battery';

export interface TestServer {
  app: FastifyInstance;
  ctx: Ctx;
  dir: string;
  close: () => Promise<void>;
}

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'pt-test-'));
  const config = loadConfig({ DATA_DIR: dir, SETUP_TOKEN: SETUP, JOBS: '0', LOG_LEVEL: 'silent', TCGDEX_BASE: 'http://tcgdex.test/v2', ...env });
  const db = new Db(join(dir, 'poketracker.db'));
  db.migrate();
  const ctx: Ctx = { config, db, sealer: new Sealer(Buffer.alloc(32, 7)), log: console as unknown as Ctx['log'], services: {} };
  const app = await buildApp(ctx, { logger: false });
  ensureSetupToken(ctx);
  await app.ready();
  return {
    app,
    ctx,
    dir,
    close: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Tiny cookie-keeping client over app.inject. */
export class Client {
  cookies = new Map<string, string>();
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers: {
        'x-poketracker': '1',
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      if (!c.value || c.maxAge === 0 || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  put = (url: string, body: unknown = {}) => this.req('PUT', url, body);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);
}

export async function setupOwner(app: FastifyInstance, username = 'ash') {
  const c = new Client(app);
  const res = await c.post('/api/setup', { token: SETUP, username, password: PASSWORD, displayName: 'Ash' });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  return c;
}

export async function invite(owner: Client, app: FastifyInstance, username: string, role = 'member') {
  const { link } = (await owner.post('/api/admin/invites', { role })).json();
  const token = link.split('/invite/')[1];
  const c = new Client(app);
  const res = await c.post(`/api/invites/${token}/accept`, { username, password: PASSWORD });
  if (res.statusCode !== 200) throw new Error(`invite failed: ${res.body}`);
  return c;
}

export async function personalId(c: Client): Promise<string> {
  const list = (await c.get('/api/collections')).json() as { id: string; kind: string }[];
  return list.find((x) => x.kind === 'personal')!.id;
}
