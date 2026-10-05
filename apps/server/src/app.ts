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
import { catalogRoutes } from './catalog.ts';
import { shareRoutes, attachShare } from './shares.ts';
import { systemRoutes } from './system.ts';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: ctx.config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 20 * 1024 * 1024,
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
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: ctx.config.publicUrl.startsWith('https://') ? { maxAge: 15552000 } : false,
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    if (!SAFE.has(req.method)) {
      // A custom header can't be sent cross-site without a CORS preflight we never grant.
      if (req.headers['x-poketracker'] !== '1') throw new HttpError(403, 'Missing request header', 'csrf');
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

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on the server', code: 'internal' });
  });

  app.get('/health', async () => ({ ok: true, version: ctx.config.version }));

  authRoutes(app, ctx);
  collectionRoutes(app, ctx);
  catalogRoutes(app, ctx);
  shareRoutes(app, ctx);
  systemRoutes(app, ctx);

  app.all('/api/*', async () => {
    throw new HttpError(404, 'Unknown API route', 'not_found');
  });

  const web = ctx.config.webDir;
  if (web && existsSync(join(web, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: web,
      wildcard: false,
      index: false,
      // We set cache-control ourselves; the plugin's default would overwrite it with max-age=0.
      cacheControl: false,
      setHeaders: (res, path) => {
        res.setHeader('cache-control', path.includes(`${join(web, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Client-side routes all get the SPA shell.
    app.setNotFoundHandler((req, reply) => {
      // HEAD too: uptime monitors commonly probe "/" with it.
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      if (/\.[a-z0-9]{2,5}$/i.test(req.url.split('?')[0])) return reply.status(404).send('Not found');
      reply.header('cache-control', 'no-cache');
      if (req.url.startsWith('/s/')) reply.header('x-robots-tag', 'noindex, nofollow');
      return reply.sendFile('index.html');
    });
  }

  return app;
}
