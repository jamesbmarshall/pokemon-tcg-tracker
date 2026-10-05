import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError, Limiter, audit, bad, forbidden, notFound, now, requireUser, str, type Ctx } from './context.ts';
import { access, collectionState, photosFor, streamPhoto } from './collections.ts';
import { isSecure, linkBase } from './auth.ts';
import { newId, randomToken, sha256 } from './security.ts';

export const SHARE_COOKIE = 'pt_share';
const SCOPES = ['collection', 'set', 'wishlist', 'graded', 'list'] as const;
const AUDIENCES = ['public', 'users', 'instance'] as const;
type Scope = (typeof SCOPES)[number];
type Audience = (typeof AUDIENCES)[number];

interface ShareRow {
  id: string;
  token_hash: string;
  token_enc: string;
  owner_id: string;
  collection_id: string;
  scope: Scope;
  target: string | null;
  audience: Audience;
  title: string | null;
  hide_paid: number;
  hide_value: number;
  hide_notes: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  views: number;
  last_viewed_at: string | null;
}

const live = (s: ShareRow) => !s.revoked_at && (!s.expires_at || s.expires_at > now());

function findByToken(ctx: Ctx, token: string | undefined): ShareRow | undefined {
  if (!token || token.length > 64) return undefined;
  const s = ctx.db.get<ShareRow>('SELECT * FROM shares WHERE token_hash = ?', sha256(token));
  return s && live(s) ? s : undefined;
}

/** Whether this request may see the share. 'login' means the visitor must sign in first. */
function canView(ctx: Ctx, s: ShareRow, req: FastifyRequest): true | 'login' | false {
  if (s.audience === 'public') return true;
  if (!req.user) return 'login';
  if (s.owner_id === req.user.id || s.audience === 'instance') return true;
  return !!ctx.db.get('SELECT 1 FROM share_users WHERE share_id = ? AND user_id = ?', s.id, req.user.id);
}

/** A share cookie lets anonymous visitors use the catalogue and image proxies, nothing else. */
export function attachShare(ctx: Ctx, req: FastifyRequest) {
  const s = findByToken(ctx, req.cookies[SHARE_COOKIE]);
  if (s && canView(ctx, s, req) === true) req.shareToken = s.id;
}

/** Applies the share's scope and privacy flags to the collection state. Server-side so nothing leaks. */
export function shareView(ctx: Ctx, s: ShareRow) {
  const full = collectionState(ctx, s.collection_id, { hidePaid: !!s.hide_paid, hideValue: !!s.hide_value, hideNotes: !!s.hide_notes });
  const pick = (ids: Set<string>) => full.cards.filter((c) => ids.has(c.id));
  const empty = { entries: [], graded: [], wishlist: [], notes: [], history: [], lists: [], cards: [], setStats: [] } as unknown as typeof full;
  switch (s.scope) {
    case 'collection':
      return full;
    case 'set': {
      const inSet = <T extends { cardId: string }>(x: T) => full.cards.find((c) => c.id === x.cardId)?.setId === s.target || x.cardId.startsWith(`${s.target}-`);
      const entries = full.entries.filter((e) => e.setId === s.target);
      const graded = full.graded.filter((g) => g.setId === s.target);
      const wishlist = full.wishlist.filter(inSet);
      const notes = full.notes.filter(inSet);
      const ids = new Set([...entries, ...graded, ...wishlist].map((x) => x.cardId));
      return { ...empty, entries, graded, wishlist, notes, cards: pick(ids), setStats: full.setStats.filter((x) => x.setId === s.target) };
    }
    case 'wishlist': {
      const ids = new Set(full.wishlist.map((w) => w.cardId));
      return { ...empty, wishlist: full.wishlist, notes: full.notes.filter((n) => ids.has(n.cardId)), cards: pick(ids) };
    }
    case 'graded': {
      const ids = new Set(full.graded.map((g) => g.cardId));
      return { ...empty, graded: full.graded, notes: full.notes.filter((n) => ids.has(n.cardId)), cards: pick(ids) };
    }
    case 'list': {
      const list = full.lists.find((l) => l.id === s.target);
      const ids = new Set(list?.cards ?? []);
      return {
        ...empty,
        lists: list ? [list] : [],
        entries: full.entries.filter((e) => ids.has(e.cardId)),
        graded: full.graded.filter((g) => ids.has(g.cardId)),
        notes: full.notes.filter((n) => ids.has(n.cardId)),
        cards: pick(ids),
      };
    }
  }
}

function describe(ctx: Ctx, s: ShareRow, req: FastifyRequest) {
  let token = '';
  try {
    token = ctx.sealer.open(s.token_enc);
  } catch {
    /* key rotated; link can't be re-shown */
  }
  const users = ctx.db.all<{ id: string; displayName: string }>(
    'SELECT u.id, u.display_name AS displayName FROM share_users su JOIN users u ON u.id = su.user_id WHERE su.share_id = ?',
    s.id,
  );
  const coll = ctx.db.get<{ name: string }>('SELECT name FROM collections WHERE id = ?', s.collection_id);
  return {
    id: s.id,
    collectionId: s.collection_id,
    collectionName: coll?.name,
    scope: s.scope,
    target: s.target,
    audience: s.audience,
    title: s.title,
    hidePaid: !!s.hide_paid,
    hideValue: !!s.hide_value,
    hideNotes: !!s.hide_notes,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    revokedAt: s.revoked_at,
    active: live(s),
    views: s.views,
    lastViewedAt: s.last_viewed_at,
    users,
    url: token ? `${linkBase(ctx, req)}/s/${token}` : null,
  };
}

function expiry(body: Record<string, unknown>): string | null | undefined {
  if (body.expiresAt === null || body.expiresInDays === null) return null;
  if (typeof body.expiresInDays === 'number') {
    if (!(body.expiresInDays > 0 && body.expiresInDays <= 3650)) throw bad('Pick an expiry between 1 day and 10 years');
    return new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();
  }
  if (typeof body.expiresAt === 'string') {
    const t = Date.parse(body.expiresAt);
    if (Number.isNaN(t) || t < Date.now()) throw bad('Expiry must be in the future');
    return new Date(t).toISOString();
  }
  return undefined;
}

function setUsers(ctx: Ctx, shareId: string, ownerId: string, ids: unknown) {
  if (!Array.isArray(ids)) return;
  if (ids.length > 200) throw bad('Too many people');
  ctx.db.run('DELETE FROM share_users WHERE share_id = ?', shareId);
  for (const id of ids) {
    if (typeof id !== 'string' || id === ownerId) continue;
    if (ctx.db.get('SELECT 1 FROM users WHERE id = ? AND disabled = 0', id)) ctx.db.run('INSERT OR IGNORE INTO share_users (share_id, user_id) VALUES (?, ?)', shareId, id);
  }
}

const flag = (v: unknown, dflt: number) => (typeof v === 'boolean' ? (v ? 1 : 0) : dflt);

export function shareRoutes(app: FastifyInstance, ctx: Ctx) {
  const visits = new Limiter(240, 60_000);

  const mine = (req: FastifyRequest) => {
    const u = requireUser(req);
    const s = ctx.db.get<ShareRow>('SELECT * FROM shares WHERE id = ?', (req.params as { id: string }).id);
    if (!s || s.owner_id !== u.id) throw notFound('Share not found');
    return s;
  };

  app.get('/api/shares', async (req) => {
    const u = requireUser(req);
    return ctx.db.all<ShareRow>('SELECT * FROM shares WHERE owner_id = ? ORDER BY created_at DESC', u.id).map((s) => describe(ctx, s, req));
  });

  app.post('/api/shares', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const collectionId = str(b.collectionId, 64);
    // Only the collection owner can publish it; editors share via membership instead.
    if (access(ctx, u.id, collectionId) !== 'owner') throw forbidden('Only the collection owner can share it');
    const scope = b.scope as Scope;
    const audience = b.audience as Audience;
    if (!SCOPES.includes(scope)) throw bad('Pick what to share');
    if (!AUDIENCES.includes(audience)) throw bad('Pick who can see it');
    let target: string | null = null;
    if (scope === 'set') {
      target = str(b.target, 100);
      if (!target) throw bad('Pick a set to share');
    }
    if (scope === 'list') {
      target = str(b.target, 64);
      if (!ctx.db.get('SELECT 1 FROM lists WHERE id = ? AND collection_id = ?', target, collectionId)) throw bad('Pick a list to share');
    }
    if (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM shares WHERE owner_id = ?', u.id)!.n >= 500) throw bad('You have too many share links');
    const token = randomToken(16);
    const id = newId();
    ctx.db.tx(() => {
      ctx.db.run(
        `INSERT INTO shares (id, token_hash, token_enc, owner_id, collection_id, scope, target, audience, title, hide_paid, hide_value, hide_notes, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        sha256(token),
        ctx.sealer.seal(token),
        u.id,
        collectionId,
        scope,
        target,
        audience,
        str(b.title, 100) || null,
        flag(b.hidePaid, 1),
        flag(b.hideValue, 0),
        flag(b.hideNotes, 1),
        now(),
        expiry(b) ?? null,
      );
      if (audience === 'users') setUsers(ctx, id, u.id, b.userIds);
    });
    audit(ctx, req, 'share.created', id, { scope, audience });
    return describe(ctx, ctx.db.get<ShareRow>('SELECT * FROM shares WHERE id = ?', id)!, req);
  });

  app.patch('/api/shares/:id', async (req) => {
    const s = mine(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const audience = b.audience === undefined ? s.audience : (b.audience as Audience);
    if (!AUDIENCES.includes(audience)) throw bad('Pick who can see it');
    const exp = expiry(b);
    ctx.db.tx(() => {
      ctx.db.run(
        'UPDATE shares SET audience = ?, title = ?, hide_paid = ?, hide_value = ?, hide_notes = ?, expires_at = ? WHERE id = ?',
        audience,
        b.title === undefined ? s.title : str(b.title, 100) || null,
        flag(b.hidePaid, s.hide_paid),
        flag(b.hideValue, s.hide_value),
        flag(b.hideNotes, s.hide_notes),
        exp === undefined ? s.expires_at : exp,
        s.id,
      );
      if (audience === 'users') setUsers(ctx, s.id, s.owner_id, b.userIds);
      else ctx.db.run('DELETE FROM share_users WHERE share_id = ?', s.id);
    });
    audit(ctx, req, 'share.updated', s.id);
    return describe(ctx, ctx.db.get<ShareRow>('SELECT * FROM shares WHERE id = ?', s.id)!, req);
  });

  app.post('/api/shares/:id/revoke', async (req) => {
    const s = mine(req);
    ctx.db.run('UPDATE shares SET revoked_at = ? WHERE id = ?', now(), s.id);
    audit(ctx, req, 'share.revoked', s.id);
    return { ok: true };
  });

  app.delete('/api/shares/:id', async (req) => {
    const s = mine(req);
    ctx.db.run('DELETE FROM shares WHERE id = ?', s.id);
    audit(ctx, req, 'share.deleted', s.id);
    return { ok: true };
  });

  app.get('/api/shared-with-me', async (req) => {
    const u = requireUser(req);
    const rows = ctx.db.all<ShareRow & { owner_name: string }>(
      `SELECT s.*, u.display_name AS owner_name FROM shares s JOIN users u ON u.id = s.owner_id
        WHERE s.owner_id != ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)
          AND (s.audience = 'instance' OR EXISTS (SELECT 1 FROM share_users su WHERE su.share_id = s.id AND su.user_id = ?))
        ORDER BY s.created_at DESC`,
      u.id,
      now(),
      u.id,
    );
    return rows.map((s) => ({ ...describe(ctx, s, req), ownerName: s.owner_name, users: undefined }));
  });

  // ------------------------------------------------------------ visitors

  const open = (req: FastifyRequest, reply: FastifyReply) => {
    visits.check(req.ip, reply);
    const token = (req.params as { token: string }).token;
    const s = findByToken(ctx, token);
    if (!s) throw notFound('This link has expired or been turned off');
    const ok = canView(ctx, s, req);
    if (ok === 'login') throw new HttpError(401, 'Sign in to see this', 'unauthenticated');
    if (!ok) throw notFound('This link has expired or been turned off');
    return { s, token };
  };

  app.get('/api/public/:token', async (req, reply) => {
    const { s, token } = open(req, reply);
    reply.setCookie(SHARE_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(ctx, req), maxAge: 12 * 3600 });
    reply.header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer');
    if (s.owner_id !== req.user?.id) ctx.db.run('UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE id = ?', now(), s.id);
    const owner = ctx.db.get<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', s.owner_id);
    const coll = ctx.db.get<{ name: string }>('SELECT name FROM collections WHERE id = ?', s.collection_id);
    return {
      share: {
        scope: s.scope,
        target: s.target,
        title: s.title || (s.scope === 'collection' ? coll?.name : null),
        ownerName: owner?.display_name,
        hidePaid: !!s.hide_paid,
        hideValue: !!s.hide_value,
        hideNotes: !!s.hide_notes,
        expiresAt: s.expires_at,
      },
      role: 'viewer',
      ...shareView(ctx, s),
    };
  });

  const visibleGraded = (s: ShareRow) => new Set(shareView(ctx, s).graded.map((g) => g.id));

  app.get('/api/public/:token/graded/:gid/photos', async (req, reply) => {
    const { s } = open(req, reply);
    const gid = (req.params as { gid: string }).gid;
    if (!visibleGraded(s).has(gid)) throw notFound();
    return photosFor(ctx, s.collection_id, gid);
  });

  app.get('/api/public/:token/photos/:pid', async (req, reply) => {
    const { s } = open(req, reply);
    const pid = (req.params as { pid: string }).pid;
    const p = ctx.db.get<{ graded_id: string }>('SELECT graded_id FROM graded_photos WHERE id = ? AND collection_id = ?', pid, s.collection_id);
    if (!p || !visibleGraded(s).has(p.graded_id)) throw notFound();
    const { mime, stream } = streamPhoto(ctx, s.collection_id, pid);
    reply.header('cache-control', 'private, max-age=3600').type(mime);
    return reply.send(stream);
  });
}
