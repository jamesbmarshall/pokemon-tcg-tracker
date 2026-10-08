/**
 * Selective sharing of a collection, or a slice of it, with people who aren't members.
 *
 * A share has a scope (whole collection, one set, wishlist, graded slabs or a custom list), an
 * audience (anyone with the link, chosen users, or everyone on this instance) and privacy flags
 * (hidePaid / hideValue / hideNotes). Shares are read-only by construction: visitors only ever
 * reach the GET routes under /api/public, never the collection routes.
 *
 * Redaction and scoping happen here on the server, not in the web client, because anything sent
 * to the browser can be read from devtools. If a field is hidden, it is never serialised.
 *
 * Tokens: the link token's SHA-256 is used for lookup, and a sealed copy is kept so the owner
 * can copy the link again later. Revocation, expiry and audience are re-checked on every request.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError, Limiter, audit, bad, forbidden, notFound, now, requireUser, str, type Ctx } from './context.ts';
import { access, collectionState, photosFor, streamPhoto } from './collections.ts';
import { sealedPhotosFor, streamSealedPhoto } from './sealed.ts';
import { isSecure, linkBase } from './auth.ts';
import { newId, randomToken, sha256 } from './security.ts';

export const SHARE_COOKIE = 'pt_share';
const SCOPES = ['collection', 'set', 'wishlist', 'graded', 'sealed', 'list'] as const;
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
  // Real tokens are ~22 chars; refuse oversized input before hashing it.
  if (!token || token.length > 64) return undefined;
  // A disabled owner's shares stop working at once, without having to revoke each one.
  const s = ctx.db.get<ShareRow>(
    'SELECT s.* FROM shares s JOIN users u ON u.id = s.owner_id WHERE s.token_hash = ? AND u.disabled = 0',
    sha256(token),
  );
  return s && live(s) ? s : undefined;
}

/**
 * Whether this request may see the share. 'login' means the visitor must sign in first.
 * For 'users' and 'instance' audiences the link alone isn't enough: a forwarded URL still needs
 * the right account, which is the point of choosing those audiences over 'public'.
 */
function canView(ctx: Ctx, s: ShareRow, req: FastifyRequest): true | 'login' | false {
  if (s.audience === 'public') return true;
  if (!req.user) return 'login';
  if (s.owner_id === req.user.id || s.audience === 'instance') return true;
  return !!ctx.db.get('SELECT 1 FROM share_users WHERE share_id = ? AND user_id = ?', s.id, req.user.id);
}

/**
 * A share cookie lets anonymous visitors use the catalogue and image proxies, nothing else.
 * Called from the onRequest hook on every API request, so a revoked or expired share stops
 * granting proxy access straight away even though the cookie itself lingers in the browser.
 */
export function attachShare(ctx: Ctx, req: FastifyRequest) {
  const s = findByToken(ctx, req.cookies[SHARE_COOKIE]);
  if (s && canView(ctx, s, req) === true) req.shareToken = s.id;
}

/**
 * Applies the share's scope and privacy flags to the collection state. Server-side so nothing leaks.
 *
 * Privacy flags are applied first by collectionState; this function then narrows to the scope.
 * Every scope starts from `empty` and copies in only what it needs, so a field added to the
 * collection state later stays hidden from narrower shares until it is opted in here.
 */
export function shareView(ctx: Ctx, s: ShareRow) {
  const full = collectionState(ctx, s.collection_id, { hidePaid: !!s.hide_paid, hideValue: !!s.hide_value, hideNotes: !!s.hide_notes });
  const pick = (ids: Set<string>) => full.cards.filter((c) => ids.has(c.id));
  const empty = { entries: [], graded: [], sealed: [], wishlist: [], notes: [], history: [], lists: [], cards: [], setStats: [] } as unknown as typeof full;
  switch (s.scope) {
    case 'collection':
      return full;
    case 'set': {
      // Wishlist and note rows don't carry a setId. Use the hydrated card when we have it,
      // otherwise fall back to the "<setId>-<number>" card id convention.
      const inSet = <T extends { cardId: string }>(x: T) => full.cards.find((c) => c.id === x.cardId)?.setId === s.target || x.cardId.startsWith(`${s.target}-`);
      const entries = full.entries.filter((e) => e.setId === s.target);
      const graded = full.graded.filter((g) => g.setId === s.target);
      const sealed = full.sealed.filter((se) => se.setId === s.target);
      const wishlist = full.wishlist.filter(inSet);
      const notes = full.notes.filter(inSet);
      const ids = new Set([...entries, ...graded, ...wishlist].map((x) => x.cardId));
      return { ...empty, entries, graded, sealed, wishlist, notes, cards: pick(ids), setStats: full.setStats.filter((x) => x.setId === s.target) };
    }
    case 'wishlist': {
      const ids = new Set(full.wishlist.map((w) => w.cardId));
      return { ...empty, wishlist: full.wishlist, notes: full.notes.filter((n) => ids.has(n.cardId)), cards: pick(ids) };
    }
    case 'graded': {
      const ids = new Set(full.graded.map((g) => g.cardId));
      return { ...empty, graded: full.graded, notes: full.notes.filter((n) => ids.has(n.cardId)), cards: pick(ids) };
    }
    case 'sealed':
      return { ...empty, sealed: full.sealed };
    case 'list': {
      // A list deleted after sharing yields an empty view rather than an error.
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

/** Owner-facing summary of a share, including the re-openable link when the key still matches. */
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

/**
 * Parses expiry from either a relative `expiresInDays` or an absolute `expiresAt`.
 * Returns null for "never expires", and undefined for "not specified" so PATCH can tell
 * "leave as is" apart from "clear it".
 */
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

/**
 * Replaces the recipient list. A non-array means "unchanged". Unknown or disabled user ids are
 * skipped silently rather than rejected, so a stale picker in the client doesn't block saving.
 * The owner is never stored as a recipient because canView already lets them in.
 */
function setUsers(ctx: Ctx, shareId: string, ownerId: string, ids: unknown) {
  if (!Array.isArray(ids)) return;
  if (ids.length > 200) throw bad('Too many people');
  ctx.db.run('DELETE FROM share_users WHERE share_id = ?', shareId);
  for (const id of ids) {
    if (typeof id !== 'string' || id === ownerId) continue;
    if (ctx.db.get('SELECT 1 FROM users WHERE id = ? AND disabled = 0', id)) ctx.db.run('INSERT OR IGNORE INTO share_users (share_id, user_id) VALUES (?, ?)', shareId, id);
  }
}

/** Strict boolean: anything other than true/false keeps the default, so junk can't flip privacy. */
const flag = (v: unknown, dflt: number) => (typeof v === 'boolean' ? (v ? 1 : 0) : dflt);

export function shareRoutes(app: FastifyInstance, ctx: Ctx) {
  // Generous enough for a page load's worth of photo requests, low enough to slow token guessing.
  const visits = new Limiter(240, 60_000);

  // Looks up a share the caller owns. Returns 404 rather than 403 for other people's shares so
  // ids can't be probed for existence.
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
    // 128 bits is plenty for an unguessable link and keeps the URL short enough to paste in chat.
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
        // Privacy-leaning defaults: purchase prices and personal notes are hidden unless the
        // owner opts in; market value is shown because it is usually the point of sharing.
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

  /**
   * Edits audience, title, privacy flags and expiry. Scope and target are fixed at creation:
   * changing what a live link points at would surprise people who already have it.
   */
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
      // Drop stale recipients so switching back to 'users' later doesn't quietly re-grant them.
      else ctx.db.run('DELETE FROM share_users WHERE share_id = ?', s.id);
    });
    audit(ctx, req, 'share.updated', s.id);
    return describe(ctx, ctx.db.get<ShareRow>('SELECT * FROM shares WHERE id = ?', s.id)!, req);
  });

  // Revoke keeps the row (and its view stats) so the owner can see it was turned off; delete removes it.
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

  /**
   * Shares addressed to the caller by name or to the whole instance. Public links are left out
   * on purpose: they aren't "shared with" anyone in particular. The recipient list is stripped
   * so people can't see who else a share went to.
   */
  app.get('/api/shared-with-me', async (req) => {
    const u = requireUser(req);
    const rows = ctx.db.all<ShareRow & { owner_name: string }>(
      `SELECT s.*, u.display_name AS owner_name FROM shares s JOIN users u ON u.id = s.owner_id
        WHERE s.owner_id != ? AND u.disabled = 0 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)
          AND (s.audience = 'instance' OR EXISTS (SELECT 1 FROM share_users su WHERE su.share_id = s.id AND su.user_id = ?))
        ORDER BY s.created_at DESC`,
      u.id,
      now(),
      u.id,
    );
    return rows.map((s) => ({ ...describe(ctx, s, req), ownerName: s.owner_name, users: undefined }));
  });

  // ------------------------------------------------------------ visitors

  // Common gate for every visitor route. Missing, expired, revoked and forbidden shares all
  // return the same 404 so a visitor can't tell a dead link from one they just can't see. The
  // one exception is a signed-out visitor to a members-only share, who gets 401 so the client
  // can offer sign-in.
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

  /**
   * Main visitor endpoint. Returns the redacted, scoped state with role 'viewer' so the web
   * client renders it read-only. Also drops a short-lived share cookie, because card images and
   * catalogue lookups are separate requests that don't carry the token in their URL.
   */
  app.get('/api/public/:token', async (req, reply) => {
    const { s, token } = open(req, reply);
    reply.setCookie(SHARE_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(ctx, req), maxAge: 12 * 3600 });
    // Belt and braces for anyone opening this URL directly: keep it out of search indexes and
    // don't leak the token in a Referer. The SPA page itself gets no-referrer from helmet.
    reply.header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer');
    // The owner previewing their own link shouldn't inflate the view count.
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

  // Photo access is derived from the same scoped view as the JSON, so a slab outside the share's
  // scope (or soft-deleted) can't be reached by guessing its id, even within the same collection.
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
    // Shorter and not immutable (unlike the member route) so revoking a share takes effect sooner.
    reply.header('cache-control', 'private, max-age=3600').type(mime);
    return reply.send(stream);
  });

  const visibleSealed = (s: ShareRow) => new Set(shareView(ctx, s).sealed.map((se) => se.id));

  app.get('/api/public/:token/sealed/:sid/photos', async (req, reply) => {
    const { s } = open(req, reply);
    const sid = (req.params as { sid: string }).sid;
    if (!visibleSealed(s).has(sid)) throw notFound();
    return sealedPhotosFor(ctx, s.collection_id, sid);
  });

  app.get('/api/public/:token/sealed-photos/:pid', async (req, reply) => {
    const { s } = open(req, reply);
    const pid = (req.params as { pid: string }).pid;
    const p = ctx.db.get<{ sealed_id: string }>('SELECT sealed_id FROM sealed_photos WHERE id = ? AND collection_id = ?', pid, s.collection_id);
    if (!p || !visibleSealed(s).has(p.sealed_id)) throw notFound();
    const { mime, stream } = streamSealedPhoto(ctx, s.collection_id, pid);
    reply.header('cache-control', 'private, max-age=3600').type(mime);
    return reply.send(stream);
  });
}
