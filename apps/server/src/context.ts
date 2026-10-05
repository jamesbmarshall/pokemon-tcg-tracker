import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { Sealer } from './security.ts';

export type Role = 'owner' | 'admin' | 'member';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  totpEnabled: boolean;
}

export interface Ctx {
  config: Config;
  db: Db;
  sealer: Sealer;
  log: FastifyBaseLogger;
  /** Late-bound services (scheduler, updater) so routes can reach them. */
  services: Partial<Services>;
}

export interface Services {
  runJob: (name: string) => Promise<unknown>;
  jobStatus: () => unknown[];
  requestRestart: (code?: number) => void;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    sessionId?: string;
    mfaPending?: boolean;
    /** Share token from the share cookie (visitor of a public share link). */
    shareToken?: string;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const bad = (msg: string, code?: string) => new HttpError(400, msg, code);
export const forbidden = (msg = "You don't have access to that") => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');

export const now = () => new Date().toISOString();
export const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

export function audit(ctx: Ctx, req: FastifyRequest | undefined, action: string, target?: string, detail?: unknown) {
  ctx.db.run(
    'INSERT INTO audit_log (at, user_id, action, target, ip, detail) VALUES (?, ?, ?, ?, ?, ?)',
    now(),
    req?.user?.id ?? null,
    action,
    target ?? null,
    req?.ip ?? null,
    detail === undefined ? null : JSON.stringify(detail),
  );
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}

/** Fixed-window limiter for auth endpoints. In memory: fine for a single instance. */
export class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Returns false when the key has exceeded its budget. */
  take(key: string): boolean {
    const t = Date.now();
    let h = this.hits.get(key);
    if (!h || h.reset < t) {
      h = { n: 0, reset: t + this.windowMs };
      this.hits.set(key, h);
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset < t) this.hits.delete(k);
    }
    h.n++;
    return h.n <= this.max;
  }

  check(key: string, reply?: FastifyReply) {
    if (!this.take(key)) {
      reply?.header('retry-after', '60');
      throw new HttpError(429, 'Too many attempts. Wait a minute and try again.', 'rate_limited');
    }
  }
}

export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
