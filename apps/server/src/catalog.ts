/**
 * TCGdex catalogue proxy and cache, card image proxy and cache, and FX rates.
 *
 * The browser never talks to third parties directly: the CSP only allows 'self', share-link
 * visitors don't leak their IP to external hosts, and a SQLite-backed cache keeps the app
 * usable when TCGdex is slow or down. Card images are cached on disk under an LRU size cap.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, Limiter, bad, now, type Ctx } from './context.ts';
import { sha256 } from './security.ts';
import { currentRates } from './cards.ts';
import { RetryableError, recordStaleServe, retryAfterMs, withResilience } from './providers/resilience.ts';

const MAX_BODY = 8 * 1024 * 1024;
const MAX_IMAGE = 6 * 1024 * 1024;
/**
 * The only hosts the image proxy will fetch from. Without this, /api/img would be an open
 * proxy (SSRF): any signed-in user or share-link visitor could make the server request internal
 * addresses such as cloud metadata endpoints or other containers on the host network.
 */
const IMAGE_HOSTS = new Set(['assets.tcgdex.net', 'images.pokemontcg.io']);

/** How long a cached catalogue response is fresh, by path. Stale copies are still served if TCGdex is down. */
export function ttlFor(path: string): number {
  const p = path.split('?')[0];
  if (/^\/[\w-]+\/(rarities|series|types)/.test(p)) return 24 * 3600_000;
  if (/^\/[\w-]+\/sets(\/|$)/.test(p)) return 6 * 3600_000;
  if (/^\/[\w-]+\/cards\/[^/]+$/.test(p)) return 6 * 3600_000;
  return 3600_000;
}

interface Cached {
  status: number;
  type: string;
  body: Buffer;
  fresh: boolean;
}

/**
 * In-flight upstream requests by cache key. Opening a set page fires many identical requests
 * from many tabs or users; this collapses them into one call to TCGdex.
 */
const inflight = new Map<string, Promise<Cached>>();

/**
 * Fetches from TCGdex through the SQLite cache. Concurrent identical requests share one
 * upstream call. Network errors, 5xx and 429 are retried with backoff (respecting Retry-After);
 * other 4xx are not retried. `provider` keys a circuit breaker and health record shared with
 * every other call for that upstream: once it is open, or once retries are exhausted, a stale
 * cached copy is served instead of erroring, when one exists.
 */
export async function cachedUpstream(ctx: Ctx, provider: string, key: string, url: string, init: RequestInit, ttl: number, force = false): Promise<Cached> {
  const row = ctx.db.get<{ status: number; content_type: string; body: Uint8Array; fetched_at: number }>('SELECT * FROM http_cache WHERE key = ?', key);
  if (row && !force && Date.now() - row.fetched_at < ttl) return { status: row.status, type: row.content_type, body: Buffer.from(row.body), fresh: true };
  const stale = () => {
    recordStaleServe(provider);
    return { status: row!.status, type: row!.content_type, body: Buffer.from(row!.body), fresh: false };
  };
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await withResilience(provider, async () => {
          let r: Response;
          try {
            r = await fetch(url, { ...init, headers: { 'user-agent': `PokeTracker/${ctx.config.version}`, ...init.headers }, signal: AbortSignal.timeout(25_000) });
          } catch (err) {
            throw new RetryableError((err as Error).message);
          }
          if (r.status === 429 || r.status >= 500) throw new RetryableError(`Upstream returned ${r.status}`, retryAfterMs(r));
          return r;
        });
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > MAX_BODY) throw new Error('Upstream response too large');
        const type = res.headers.get('content-type') ?? 'application/json';
        // Cache successes and definitive 404s; retry everything else next time.
        if (res.ok || res.status === 404) {
          ctx.db.run('INSERT OR REPLACE INTO http_cache (key, status, content_type, body, fetched_at) VALUES (?, ?, ?, ?, ?)', key, res.status, type, body, Date.now());
        } else if (row) {
          // A non-retryable 4xx shouldn't replace good data; serve what we had.
          return stale();
        }
        return { status: res.status, type, body, fresh: true };
      } catch (err) {
        if (row) return stale();
        ctx.log.warn({ err: (err as Error).message, url }, 'catalogue upstream failed');
        throw new HttpError(502, 'The card catalogue is unavailable right now', 'upstream');
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return p;
}

/** Drops cache rows nobody has refreshed in a while. Stale rows are kept until then as an outage fallback. */
export function pruneHttpCache(ctx: Ctx, maxAgeDays = 14) {
  return ctx.db.run('DELETE FROM http_cache WHERE fetched_at < ?', Date.now() - maxAgeDays * 86_400_000).changes;
}

/** Catalogue and image proxies serve signed-in users and visitors holding a valid share link. */
function requireReader(req: FastifyRequest) {
  if (!req.user && !req.shareToken) throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
}

// ---------------------------------------------------------------- images

const imageDir = (ctx: Ctx) => join(ctx.config.dataDir, 'images');

/**
 * Parses and checks a requested image URL against IMAGE_HOSTS. HTTPS only, and no userinfo or
 * explicit port, so the URL can't be bent into reaching a different service on an allowed host.
 */
function imageUrl(raw: unknown): URL {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw bad('Invalid image URL');
  }
  if (u.protocol !== 'https:' || !IMAGE_HOSTS.has(u.hostname) || u.username || u.port) throw bad('Image host not allowed');
  return u;
}

const imgInflight = new Map<string, Promise<{ key: string; mime: string } | null>>();

/**
 * Downloads an image into the disk cache if it isn't there yet. Resolves to null rather than
 * rejecting on any failure, so a missing image never breaks a page or the images job.
 * Callers must have checked the URL against IMAGE_HOSTS.
 */
export function ensureImage(ctx: Ctx, url: string): Promise<{ key: string; mime: string } | null> {
  // Hashing the URL gives a fixed-length, path-safe file name.
  const key = sha256(url);
  const row = ctx.db.get<{ mime: string }>('SELECT mime FROM images WHERE key = ?', key);
  // Check the file too: the row can outlive its file if the images folder was cleared by hand.
  if (row && existsSync(join(imageDir(ctx), key))) return Promise.resolve({ key, mime: row.mime });
  let p = imgInflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        // redirect: 'error' so an allowed host can't bounce us to a host that isn't allowed.
        const res = await fetch(url, { headers: { 'user-agent': `PokeTracker/${ctx.config.version}` }, signal: AbortSignal.timeout(25_000), redirect: 'error' });
        const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
        // SVG can carry script, and we serve these from our own origin; raster images only.
        if (!res.ok || !mime.startsWith('image/') || mime.includes('svg')) return null;
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > MAX_IMAGE) return null;
        mkdirSync(imageDir(ctx), { recursive: true });
        writeFileSync(join(imageDir(ctx), key), body);
        ctx.db.run('INSERT OR REPLACE INTO images (key, url, mime, size, fetched_at, used_at) VALUES (?, ?, ?, ?, ?, ?)', key, url, mime, body.length, now(), Date.now());
        return { key, mime };
      } catch {
        return null;
      } finally {
        imgInflight.delete(key);
      }
    })();
    imgInflight.set(key, p);
  }
  return p;
}

/**
 * Deletes least-recently used images until the cache fits its size cap. Trims to 90% of the
 * cap so the next few downloads don't trigger another prune straight away.
 */
export function pruneImages(ctx: Ctx): number {
  const cap = ctx.config.imageCacheMb * 1024 * 1024;
  let total = ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(size), 0) AS s FROM images')!.s;
  if (total <= cap) return 0;
  let removed = 0;
  for (const r of ctx.db.all<{ key: string; size: number }>('SELECT key, size FROM images ORDER BY used_at')) {
    if (total <= cap * 0.9) break;
    rmSync(join(imageDir(ctx), r.key), { force: true });
    ctx.db.run('DELETE FROM images WHERE key = ?', r.key);
    total -= r.size;
    removed++;
  }
  return removed;
}

export function imageCacheStats(ctx: Ctx) {
  const r = ctx.db.get<{ n: number; s: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS s FROM images')!;
  return { count: r.n, bytes: r.s, capBytes: ctx.config.imageCacheMb * 1024 * 1024 };
}

// ---------------------------------------------------------------- FX

/**
 * Fetches USD to GBP/EUR rates. Prices from TCGdex come in USD (TCGplayer) and EUR
 * (Cardmarket), so these drive both currency display and cross-market value totals.
 * Throws on bad data so the job records a failure and the last good rates stay in place.
 */
export async function refreshFx(ctx: Ctx) {
  const res = await fetch(ctx.config.fxUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`FX provider returned ${res.status}`);
  const body = (await res.json()) as { rates?: { GBP?: number; EUR?: number } };
  const { GBP, EUR } = body.rates ?? {};
  if (!(GBP! > 0 && EUR! > 0)) throw new Error('FX provider returned no rates');
  const value = { rates: { USD: 1, GBP, EUR }, at: Date.now() };
  ctx.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fx', ?)", JSON.stringify(value));
  return value.rates;
}

// ---------------------------------------------------------------- routes

export function catalogRoutes(app: FastifyInstance, ctx: Ctx) {
  // Per user (or per IP for share visitors). Cache hits count too, which keeps the check cheap.
  const upstream = new Limiter(600, 60_000);
  const base = ctx.config.tcgdexBase.replace(/\/$/, '');

  app.get('/api/tcgdex/v2/*', async (req, reply) => {
    requireReader(req);
    const rest = '/' + (req.params as { '*': string })['*'];
    // Only the read-only catalogue endpoints the web app uses, so this can't be used to reach
    // arbitrary paths on the upstream host.
    if (!/^\/[a-z-]{2,8}\/(cards|sets|series|rarities|types)(\/[^?#]*)?$/i.test(rest) || rest.includes('..')) throw bad('Unsupported catalogue path');
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const path = rest + qs;
    upstream.check(req.user?.id ?? req.ip, reply);
    const r = await cachedUpstream(ctx, 'tcgdex', `GET ${path}`, `${base}${path}`, {}, ttlFor(path));
    reply.header('cache-control', 'private, max-age=300').header('x-cache', r.fresh ? 'fresh' : 'stale');
    return reply.status(r.status).type(r.type).send(r.body);
  });

  app.post('/api/tcgdex/v2/graphql', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    requireReader(req);
    const b = req.body as { query?: unknown; variables?: unknown };
    if (typeof b?.query !== 'string' || /\bmutation\b/i.test(b.query)) throw bad('Invalid query');
    // Cache key is a hash of the exact payload, so different variables never share an entry.
    const payload = JSON.stringify({ query: b.query, variables: b.variables ?? {} });
    upstream.check(req.user?.id ?? req.ip, reply);
    const r = await cachedUpstream(ctx, 'tcgdex', `GQL ${sha256(payload)}`, `${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload }, 3600_000);
    reply.header('cache-control', 'private, max-age=300');
    return reply.status(r.status).type(r.type).send(r.body);
  });

  app.get('/api/img', async (req, reply) => {
    requireReader(req);
    const url = imageUrl((req.query as { u?: string }).u).toString();
    const hit = await ensureImage(ctx, url);
    if (!hit) throw new HttpError(404, 'Image unavailable', 'not_found');
    const file = join(imageDir(ctx), hit.key);
    const t = Date.now();
    // Touch at most hourly to keep writes down.
    ctx.db.run('UPDATE images SET used_at = ? WHERE key = ? AND used_at < ?', t, hit.key, t - 3600_000);
    reply
      // Card art at a given URL doesn't change, so the browser can keep it for 30 days.
      .header('cache-control', 'private, max-age=2592000, immutable')
      .header('content-length', statSync(file).size)
      .header('x-content-type-options', 'nosniff')
      .type(hit.mime);
    return reply.send(createReadStream(file));
  });

  app.get('/api/fx', async (req) => {
    requireReader(req);
    const row = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'fx'");
    const at = row ? (JSON.parse(row.value) as { at: number }).at : null;
    return { rates: currentRates(ctx.db), at };
  });
}
