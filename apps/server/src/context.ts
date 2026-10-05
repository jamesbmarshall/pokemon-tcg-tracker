/**
 * Shared request plumbing for every route module.
 *
 * Holds the `Ctx` bag that is passed explicitly into each `*Routes(app, ctx)` function (rather
 * than decorating Fastify), the typed HTTP errors that the error handler in app.ts turns into
 * `{ error, code }` JSON, the role guards, the audit logger and a small rate limiter. Nothing in
 * here talks to the network, so it is safe to import from anywhere without creating cycles.
 */
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { Sealer } from './security.ts';

/**
 * Instance-wide role. There is exactly one owner (created at first-run setup and only moved via
 * ownership transfer); admins manage members and invites; members just track cards. This is
 * separate from per-collection access (owner/editor/viewer) in collections.ts.
 */
export type Role = 'owner' | 'admin' | 'member';

/** The subset of a user row that is safe to put on the request and send to the client. */
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

// Populated by the onRequest hook in app.ts (attachSession, then attachShare) before any route runs.
declare module 'fastify' {
  interface FastifyRequest {
    /** Only set for a fully signed-in session; stays undefined while a second factor is pending. */
    user?: SessionUser;
    /** SHA-256 of the session cookie, i.e. the sessions table primary key, never the raw token. */
    sessionId?: string;
    mfaPending?: boolean;
    /**
     * Set when the share cookie points at a live share this visitor may see. Despite the name it
     * holds the share's id, not the secret token. It only unlocks the catalogue and image proxies.
     */
    shareToken?: string;
  }
}

/**
 * An error whose message is written for end users and is safe to return verbatim. `code` is a
 * stable machine-readable string the web client switches on. Anything that is not an HttpError
 * is logged and replaced with a generic 500 so internals never reach the browser.
 */
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

// Timestamps are stored as ISO-8601 UTC strings, so plain string comparison in SQL and JS
// (e.g. `expires_at > ?`) orders them correctly.
export const now = () => new Date().toISOString();
export const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/**
 * Appends to the admin-visible audit log. The actor and IP come from the request, so call this
 * after `req.user` has been set when recording a sign-in. Pass `req` as undefined for background
 * jobs. Keep `detail` free of secrets: it is stored as plain JSON and shown to admins.
 */
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

/**
 * Guard for any route that needs a signed-in user. A session still waiting for its second factor
 * has no `req.user`, so it is rejected here too. 401 (not 403) tells the client to show sign-in.
 */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
  return req.user;
}

/**
 * Instance-role guard. Roles are an explicit allow-list rather than a hierarchy, so each admin
 * route states exactly who may call it. The role is re-read from the database on every request
 * (see attachSession), so demotions take effect immediately.
 */
export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}

/**
 * Fixed-window limiter for auth and public endpoints. In memory: fine for a single instance, and
 * a restart resetting the counters is acceptable because per-account lockout (auth.ts) is
 * persisted separately. Callers usually key by IP, so behind a reverse proxy Fastify's
 * `trustProxy` must be configured or every visitor shares one budget.
 */
export class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Returns false when the key has exceeded its budget. */
  take(key: string): boolean {
    // Azure App Service forwards the client as "ip:port". Drop the port, or every new connection
    // would get a fresh budget.
    key = key.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
    const t = Date.now();
    let h = this.hits.get(key);
    if (!h || h.reset < t) {
      h = { n: 0, reset: t + this.windowMs };
      this.hits.set(key, h);
      // Opportunistic sweep so a flood of distinct keys (e.g. spoofed IPs) can't grow the map forever.
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset < t) this.hits.delete(k);
    }
    h.n++;
    return h.n <= this.max;
  }

  /** Throws a 429 once the budget is spent. Retry-After is a fixed hint, not the exact window. */
  check(key: string, reply?: FastifyReply) {
    if (!this.take(key)) {
      reply?.header('retry-after', '60');
      throw new HttpError(429, 'Too many attempts. Wait a minute and try again.', 'rate_limited');
    }
  }
}

/**
 * Coerces untrusted body/param input to a trimmed, length-capped string. Non-strings become ''
 * so callers can treat "missing" and "wrong type" the same way with a simple falsy check.
 */
export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
