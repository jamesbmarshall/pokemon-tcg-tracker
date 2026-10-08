/**
 * Builds the Fastify instance: security headers, CSRF and session hooks, the API routes and
 * the SPA. Kept separate from index.ts so tests can build a full app against an in-memory
 * database without listening on a port or starting the job scheduler.
 */
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, type Ctx } from './context.ts';
import { attachSession, authRoutes } from './auth.ts';
import { collectionRoutes } from './collections.ts';
import { sealedRoutes } from './sealed.ts';
import { catalogRoutes } from './catalog.ts';
import { shareRoutes, attachShare } from './shares.ts';
import { systemRoutes } from './system.ts';
import { pricechartingRoutes } from './providers/pricecharting.ts';

/** Methods that must not change state, so they skip the CSRF checks below. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const hopsTrust = (hops: number) => (_addr: string, i: number) => i < hops;

/**
 * Creates the app with every route registered. Registration order matters: plugins and the
 * onRequest hook first, then the API routes, then the /api/* catch-all, and the SPA last so its
 * not-found handler only sees requests nothing else claimed.
 */
export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: ctx.config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    // A hop count becomes the same function proxy-addr builds internally (trust the nearest n
    // hops); Fastify's typings omit the numeric form.
    trustProxy: typeof ctx.config.trustProxy === 'number' ? hopsTrust(ctx.config.trustProxy) : ctx.config.trustProxy,
    // Sized for collection imports; uploads go through multipart with their own limits.
    bodyLimit: 20 * 1024 * 1024,
    // Per-request logs are noise for a home server; errors and job outcomes are logged explicitly.
    logController: new LogController({ disableRequestLogging: true }),
  });
  ctx.log = app.log;

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 6 } });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // The web app manifest and the generated service worker (both same-origin only).
        manifestSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        // The camera-scan page runs tesseract.js's OCR core (self-hosted wasm, no CDN) in a
        // worker; wasm-unsafe-eval is Wasm's own instantiation, not JS eval.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        // Many installs are plain HTTP on a LAN; upgrading would break every subresource there.
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // Only promise HTTPS when the public URL says we are served over it, or browsers would
    // refuse to reach a LAN-only HTTP install for six months.
    hsts: ctx.config.publicUrl.startsWith('https://') ? { maxAge: 15552000 } : false,
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // API responses are per-user; never let a browser or shared proxy keep them.
    reply.header('cache-control', 'no-store');
    if (!SAFE.has(req.method)) {
      // A custom header can't be sent cross-site without a CORS preflight we never grant.
      if (req.headers['x-poketracker'] !== '1') throw new HttpError(403, 'Missing request header', 'csrf');
      // Defence in depth on top of the header check. Some clients omit Origin, so its absence
      // is allowed; when present it must be this host or the configured public URL.
      const origin = req.headers.origin;
      if (origin) {
        const allowed = new Set([`${req.protocol}://${req.host}`]);
        if (ctx.config.publicUrl) allowed.add(ctx.config.publicUrl);
        if (!allowed.has(origin)) throw new HttpError(403, 'Cross-origin request blocked', 'csrf');
      }
    }
    attachSession(ctx, req, reply);
    attachShare(ctx, req);
  });

  // Client errors keep their message (validation, limits); anything 5xx is logged and replaced
  // with a generic message so internals such as SQL or file paths never reach the browser.
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on the server', code: 'internal' });
  });

  // The launcher health-gates updates on this and compares the version, so it must stay
  // unauthenticated and keep returning { version }.
  app.get('/health', async () => ({ ok: true, version: ctx.config.version }));

  authRoutes(app, ctx);
  collectionRoutes(app, ctx);
  sealedRoutes(app, ctx);
  catalogRoutes(app, ctx);
  shareRoutes(app, ctx);
  systemRoutes(app, ctx);
  pricechartingRoutes(app, ctx);

  // Without this, unknown API paths would fall through to the SPA and return HTML with a 200.
  app.all('/api/*', async () => {
    throw new HttpError(404, 'Unknown API route', 'not_found');
  });

  const web = ctx.config.webDir;
  if (web && existsSync(join(web, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: web,
      // Register a route per file at startup so unknown paths reach the SPA fallback below.
      wildcard: false,
      index: false,
      // We set cache-control ourselves; the plugin's default would overwrite it with max-age=0.
      cacheControl: false,
      // Vite puts content-hashed files under assets/, so they can be cached forever. Everything
      // else (index.html, icons, manifest) must revalidate so a new version shows up at once.
      setHeaders: (res, path) => {
        res.setHeader('cache-control', path.includes(`${join(web, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Client-side routes all get the SPA shell.
    app.setNotFoundHandler((req, reply) => {
      // HEAD too: uptime monitors commonly probe "/" with it.
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      // A missing file (e.g. an old hashed chunk after an update) must 404, not get index.html,
      // or the browser would try to run HTML as JavaScript.
      if (/\.[a-z0-9]{2,5}$/i.test(req.url.split('?')[0])) return reply.status(404).send('Not found');
      reply.header('cache-control', 'no-cache');
      // Share pages carry a secret token in the URL; keep them out of search engines.
      if (req.url.startsWith('/s/')) reply.header('x-robots-tag', 'noindex, nofollow');
      return reply.sendFile('index.html');
    });
  }

  return app;
}
