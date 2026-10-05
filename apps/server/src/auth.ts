/**
 * Accounts, sign-in and instance administration.
 *
 * Covers first-run owner setup, password + optional TOTP sign-in, cookie sessions, account
 * self-service, invite links, admin-issued password reset links, user management and the audit
 * log viewer. There is no email: invites and resets are links an admin copies and passes on.
 *
 * Sessions are opaque random cookies; only their SHA-256 is stored, so a database leak can't be
 * turned into live sessions. CSRF protection for these cookies lives in the onRequest hook in
 * app.ts (custom header + Origin check), not here. Every handler that reads `req.user` relies on
 * `attachSession` having already run in that hook.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { audit, bad, forbidden, HttpError, inDays, Limiter, now, requireRole, requireUser, str, type Ctx, type Role, type SessionUser } from './context.ts';
import { dummyVerify, hashPassword, newId, passwordProblem, randomToken, safeEqual, sha256, verifyPassword } from './security.ts';

import { USERNAME, USERNAME_HINT } from '@poketracker/shared/accounts';

export const SESSION_COOKIE = 'pt_session';
const SESSION_DAYS = 30;
// A half-signed-in session (password ok, code outstanding) should die quickly if abandoned.
const MFA_PENDING_MINUTES = 5;
// Per-account lockout complements the per-IP limiter: it stops slow, distributed guessing
// against one account. The trade-off is that anyone can lock a known username for a while.
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;
const INVITE_DAYS_MAX = 30;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  recovery_codes: string | null;
  disabled: number;
  failed_logins: number;
  locked_until: string | null;
  prefs: string;
  created_at: string;
  last_login_at: string | null;
}

/** Projects a full user row down to what is safe to expose; secrets and hashes are dropped here. */
export const toSessionUser = (u: UserRow): SessionUser => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  totpEnabled: !!u.totp_enabled,
});


function validUsername(v: unknown): string {
  const u = str(v, 64);
  if (!USERNAME.test(u)) throw bad(USERNAME_HINT, 'invalid_username');
  return u;
}

function checkPassword(v: unknown, username?: string): string {
  const problem = passwordProblem(v, username);
  if (problem) throw bad(problem, 'weak_password');
  return v as string;
}

/**
 * Whether cookies should carry the Secure flag. Trusting PUBLIC_URL as well as the request
 * protocol covers TLS-terminating proxies where Node itself only sees plain HTTP.
 */
export const isSecure = (ctx: Ctx, req: FastifyRequest) => req.protocol === 'https' || ctx.config.publicUrl.startsWith('https://');

/**
 * httpOnly keeps the token away from any injected script. SameSite=Lax (not Strict) so following
 * a link to the app from elsewhere still arrives signed in; cross-site writes are blocked by the
 * CSRF hook in app.ts rather than by the cookie attribute alone.
 */
export function setSessionCookie(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, token: string, maxAgeSec: number) {
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(ctx, req), maxAge: maxAgeSec });
}

/**
 * Issues a brand-new session and cookie. Always minting a new token at each privilege change
 * (sign-in, completing MFA, setup, invite acceptance, password reset) prevents session fixation:
 * a token planted or observed before authentication never becomes an authenticated one.
 *
 * Only the SHA-256 of the token is stored. Because the token is 256 random bits, a fast hash is
 * enough; there is nothing for an attacker with the database to brute-force.
 *
 * With `mfaPending`, the session proves only that the password was right. It is short-lived and
 * attachSession refuses to treat it as signed in until /api/auth/mfa replaces it.
 */
export function createSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, userId: string, mfaPending = false) {
  const token = randomToken();
  const ttlMs = mfaPending ? MFA_PENDING_MINUTES * 60_000 : SESSION_DAYS * 86_400_000;
  const t = now();
  ctx.db.run(
    'INSERT INTO sessions (id, user_id, mfa_pending, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    mfaPending ? 1 : 0,
    t,
    t,
    new Date(Date.now() + ttlMs).toISOString(),
    req.ip,
    str(req.headers['user-agent'], 300),
  );
  setSessionCookie(ctx, req, reply, token, ttlMs / 1000);
  return token;
}

/**
 * Resolves the session cookie onto req.user. Slides the expiry at most once an hour.
 *
 * The user row is joined fresh on every request, so role changes, disabling and deletion apply
 * immediately rather than when the session next expires. Expired or disabled sessions are
 * deleted and the cookie cleared so the client stops sending it.
 */
export function attachSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const id = sha256(token);
  const row = ctx.db.get<UserRow & { sid: string; mfa_pending: number; expires_at: string; last_seen_at: string }>(
    `SELECT u.*, s.id AS sid, s.mfa_pending, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!row || row.expires_at < now() || row.disabled) {
    if (row) ctx.db.run('DELETE FROM sessions WHERE id = ?', id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return;
  }
  req.sessionId = id;
  if (row.mfa_pending) {
    // Deliberately leave req.user empty so every requireUser() guard rejects this session.
    // The pending user id is stashed only for the /api/auth/mfa handler to pick up.
    req.mfaPending = true;
    req.user = undefined;
    (req as unknown as { pendingUserId: string }).pendingUserId = row.id;
    return;
  }
  req.user = toSessionUser(row);
  // Sliding expiry, throttled so normal browsing doesn't turn every read into a database write.
  if (Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
    ctx.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now(), inDays(SESSION_DAYS), id);
    setSessionCookie(ctx, req, reply, token, SESSION_DAYS * 86_400);
  }
}

/**
 * Inserts a user and their personal collection in one transaction, so every account always has
 * somewhere to put cards. Callers validate input and hash the password before calling.
 */
export function createUser(ctx: Ctx, input: { username: string; displayName: string; passwordHash: string; role: Role }) {
  const id = newId();
  const t = now();
  ctx.db.tx(() => {
    ctx.db.run(
      'INSERT INTO users (id, username, display_name, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.username,
      input.displayName,
      input.role,
      input.passwordHash,
      t,
      t,
    );
    ctx.db.run("INSERT INTO collections (id, name, kind, owner_id, created_at) VALUES (?, ?, 'personal', ?, ?)", newId(), 'My collection', id, t);
  });
  return id;
}

const usernameTaken = (ctx: Ctx, username: string) => !!ctx.db.get('SELECT 1 FROM users WHERE username = ?', username);

// ---------------------------------------------------------------- first run

export const userCount = (ctx: Ctx) => ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;

/**
 * Until the owner exists, anyone who can reach the server could claim it. A one-time token
 * (printed to the logs, or pre-set via SETUP_TOKEN) proves the person is the deployer.
 * A fresh token is generated on every start until setup completes, and only its hash is stored.
 * Returns the token only when it was generated here, so a pre-set SETUP_TOKEN is never logged.
 */
export function ensureSetupToken(ctx: Ctx): string | undefined {
  if (userCount(ctx) > 0) return undefined;
  const token = ctx.config.setupToken || randomToken(18);
  ctx.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_token_hash', ?)", JSON.stringify(sha256(token)));
  return ctx.config.setupToken ? undefined : token;
}

// SHA1 / 6 digits / 30 s is the RFC 6238 default and the only combination every authenticator app supports.
function totpFor(secret: string, username: string) {
  return new OTPAuth.TOTP({ issuer: 'PokéTracker', label: username, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}

/**
 * Accepts a 6-digit TOTP (±1 step) or a single-use recovery code.
 * The ±1 step window tolerates about 30 s of clock drift on the user's phone. Six digits are
 * always tried as TOTP; anything else falls through to the recovery code check.
 */
function checkSecondFactor(ctx: Ctx, user: UserRow, code: string): boolean {
  const clean = code.replace(/[\s-]/g, '');
  if (/^\d{6}$/.test(clean) && user.totp_secret) {
    const secret = ctx.sealer.open(user.totp_secret);
    const delta = totpFor(secret, user.username).validate({ token: clean, window: 1 });
    if (delta === null) return false;
    // Reject replays of the same step.
    // Remembering the last accepted step means a code shoulder-surfed or phished in real time
    // can't be reused, even within its validity window. It is kept in settings to avoid a schema change.
    const step = Math.floor(Date.now() / 30_000) + delta;
    const key = `totp_last:${user.id}`;
    const last = Number(JSON.parse(ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? '0'));
    if (step <= last) return false;
    ctx.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(step));
    return true;
  }
  // Recovery codes are stored hashed like passwords would be, and removed once used.
  const codes: string[] = JSON.parse(user.recovery_codes ?? '[]');
  const hash = sha256(clean.toLowerCase());
  const i = codes.findIndex((c) => safeEqual(c, hash));
  if (i < 0) return false;
  codes.splice(i, 1);
  ctx.db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(codes), user.id);
  return true;
}

/**
 * Ten `xxxxx-xxxxx` lower-case alphanumeric codes, easy to read aloud or copy by hand. The
 * plaintext is returned to the user exactly once; only hashes of the dash-free form are kept.
 */
function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => {
    const raw = randomToken(8).replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(10, '0').slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(c.replace('-', ''))) };
}

const getUser = (ctx: Ctx, id: string) => ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);

/**
 * Origin used when building invite, reset and share links. PUBLIC_URL wins because the Host
 * header is client-controlled; the fallback is for simple LAN installs that never set it.
 */
export function linkBase(ctx: Ctx, req: FastifyRequest) {
  return ctx.config.publicUrl || `${req.protocol}://${req.host}`;
}

// ---------------------------------------------------------------- routes

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  // Budgets are per IP except mfaLimiter, which is per pending user so rotating IPs doesn't
  // buy extra guesses at a six-digit code.
  const loginIp = new Limiter(20, 5 * 60_000);
  const mfaLimiter = new Limiter(10, 5 * 60_000);
  const setupLimiter = new Limiter(10, 10 * 60_000);
  const inviteLimiter = new Limiter(30, 10 * 60_000);

  app.get('/api/setup', async () => ({ needed: userCount(ctx) === 0 }));

  /**
   * First-run: creates the owner account. Only works while there are no users and requires the
   * setup token, so an exposed fresh install can't be claimed by a stranger. The token is
   * deleted once used and the owner is signed straight in.
   */
  app.post('/api/setup', async (req, reply) => {
    setupLimiter.check(req.ip, reply);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (userCount(ctx) > 0) throw forbidden('This server is already set up');
    const stored = JSON.parse(ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'setup_token_hash'")?.value ?? '""');
    // Compare hashes in constant time so response timing can't reveal the token a character at a time.
    if (!stored || !safeEqual(stored, sha256(str(body.token, 200)))) throw new HttpError(403, "That setup code isn't right. Check the server logs for the current code.", 'bad_setup_token');
    const username = validUsername(body.username);
    const password = checkPassword(body.password, username);
    const id = createUser(ctx, { username, displayName: str(body.displayName, 60) || username, passwordHash: await hashPassword(password), role: 'owner' });
    ctx.db.run("DELETE FROM settings WHERE key = 'setup_token_hash'");
    createSession(ctx, req, reply, id);
    req.user = toSessionUser(getUser(ctx, id)!);
    audit(ctx, req, 'setup.owner_created', id);
    return { user: req.user };
  });

  /**
   * Password sign-in. Unknown usernames and wrong passwords get the same message, status and
   * (via dummyVerify) roughly the same timing, so the endpoint can't be used to discover which
   * accounts exist. If TOTP is on, this only issues a short-lived pending session and returns
   * `{ mfa: true }`; the real session comes from /api/auth/mfa.
   */
  app.post('/api/auth/login', async (req, reply) => {
    loginIp.check(req.ip, reply);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = str(body.username, 64);
    // Cap length before hashing so a huge "password" can't be used to burn CPU in Argon2.
    const password = typeof body.password === 'string' ? body.password.slice(0, 512) : '';
    const user = username ? ctx.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username) : undefined;
    const fail = () => new HttpError(401, 'Wrong username or password', 'bad_credentials');
    if (!user) {
      await dummyVerify(password);
      throw fail();
    }
    if (user.locked_until && user.locked_until > now()) throw new HttpError(429, 'Too many failed sign-ins. Try again in a few minutes.', 'locked');
    if (!(await verifyPassword(password, user.password_hash))) {
      const n = user.failed_logins + 1;
      const lock = n >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      // The counter restarts after a lock, so each subsequent lock needs another full run of failures.
      ctx.db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : n, lock, user.id);
      audit(ctx, req, 'auth.login_failed', user.id);
      throw fail();
    }
    // Checked only after the password is proven, so "disabled" is never revealed to a guesser.
    if (user.disabled) throw new HttpError(403, 'This account is disabled', 'disabled');
    ctx.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', user.id);
    if (user.totp_enabled) {
      createSession(ctx, req, reply, user.id, true);
      return { mfa: true };
    }
    createSession(ctx, req, reply, user.id);
    ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
    req.user = toSessionUser(user);
    audit(ctx, req, 'auth.login', user.id);
    return { user: req.user };
  });

  /**
   * Second step of sign-in. Needs the pending session cookie from /api/auth/login, so a TOTP or
   * recovery code alone is useless without the password. On success the pending session is
   * thrown away and a fresh full session is issued (session rotation).
   */
  app.post('/api/auth/mfa', async (req, reply) => {
    const pendingId = (req as unknown as { pendingUserId?: string }).pendingUserId;
    if (!req.mfaPending || !pendingId || !req.sessionId) throw new HttpError(401, 'Your sign-in expired. Start again.', 'mfa_expired');
    mfaLimiter.check(pendingId, reply);
    const user = getUser(ctx, pendingId)!;
    if (!checkSecondFactor(ctx, user, str((req.body as Record<string, unknown>)?.code, 40))) {
      audit(ctx, req, 'auth.mfa_failed', user.id);
      throw new HttpError(401, "That code didn't work", 'bad_code');
    }
    ctx.db.run('DELETE FROM sessions WHERE id = ?', req.sessionId);
    createSession(ctx, req, reply, user.id);
    ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
    req.user = toSessionUser(user);
    audit(ctx, req, 'auth.login', user.id, { mfa: true });
    return { user: req.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) ctx.db.run('DELETE FROM sessions WHERE id = ?', req.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = requireUser(req);
    const row = getUser(ctx, u.id)!;
    return { user: u, prefs: JSON.parse(row.prefs || '{}') };
  });

  // ------------------------------------------------------------ account

  app.patch('/api/account', async (req) => {
    const u = requireUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.displayName !== undefined) {
      const name = str(body.displayName, 60);
      if (!name) throw bad('Display name is required');
      ctx.db.run('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?', name, now(), u.id);
    }
    if (body.prefs !== undefined) {
      // Prefs are an opaque client-owned blob; the server only bounds its size.
      const prefs = JSON.stringify(body.prefs ?? {});
      if (prefs.length > 8_000) throw bad('Preferences are too large');
      ctx.db.run('UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?', prefs, now(), u.id);
    }
    return { user: toSessionUser(getUser(ctx, u.id)!) };
  });

  /**
   * Requires the current password even though the caller is signed in, so a borrowed unlocked
   * browser or stolen cookie can't silently take over the account. Afterwards every other session
   * is revoked; the current one is kept so the user isn't bounced to sign-in.
   */
  app.post('/api/account/password', async (req, reply) => {
    const u = requireUser(req);
    // Shares the login budget under a separate key, so this can't be used as a guessing oracle.
    loginIp.check(`pw:${u.id}`, reply);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const row = getUser(ctx, u.id)!;
    if (!(await verifyPassword(String(body.current ?? ''), row.password_hash))) throw bad('Your current password is wrong', 'bad_credentials');
    const next = checkPassword(body.next, row.username);
    ctx.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(next), now(), u.id);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, req.sessionId ?? '');
    audit(ctx, req, 'account.password_changed', u.id);
    return { ok: true };
  });

  /**
   * Step one of enabling TOTP: stores a sealed candidate secret and returns it (plus a QR code)
   * for the authenticator app. Two-factor stays off until /enable proves the app is set up, so
   * a half-finished setup can never lock the user out. Calling again replaces the candidate.
   */
  app.post('/api/account/totp/setup', async (req) => {
    const u = requireUser(req);
    const row = getUser(ctx, u.id)!;
    if (row.totp_enabled) throw bad('Two-factor is already on');
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    ctx.db.run('UPDATE users SET totp_secret = ? WHERE id = ?', ctx.sealer.seal(secret), u.id);
    const url = totpFor(secret, row.username).toString();
    return { secret, url, qr: await QRCode.toString(url, { type: 'svg', margin: 1 }) };
  });

  /** Confirms a code from the new secret, switches TOTP on and hands out recovery codes once. */
  app.post('/api/account/totp/enable', async (req) => {
    const u = requireUser(req);
    const row = getUser(ctx, u.id)!;
    if (row.totp_enabled || !row.totp_secret) throw bad('Start two-factor setup first');
    const code = str((req.body as Record<string, unknown>)?.code, 10);
    // Insist on a real TOTP here; a recovery code wouldn't prove the authenticator works.
    if (!/^\d{6}$/.test(code) || !checkSecondFactor(ctx, row, code)) throw bad("That code didn't work. Check your authenticator's clock.", 'bad_code');
    const { codes, hashes } = newRecoveryCodes();
    ctx.db.run('UPDATE users SET totp_enabled = 1, recovery_codes = ?, updated_at = ? WHERE id = ?', JSON.stringify(hashes), now(), u.id);
    audit(ctx, req, 'account.totp_enabled', u.id);
    return { recoveryCodes: codes };
  });

  /** Password re-check, as for password changes: a hijacked session must not be able to strip 2FA. */
  app.post('/api/account/totp/disable', async (req) => {
    const u = requireUser(req);
    const row = getUser(ctx, u.id)!;
    if (!(await verifyPassword(String((req.body as Record<string, unknown>)?.password ?? ''), row.password_hash))) throw bad('Your password is wrong', 'bad_credentials');
    ctx.db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = NULL, updated_at = ? WHERE id = ?', now(), u.id);
    audit(ctx, req, 'account.totp_disabled', u.id);
    return { ok: true };
  });

  /** Replaces (not adds to) the recovery codes, so any old printed set stops working. */
  app.post('/api/account/totp/recovery-codes', async (req) => {
    const u = requireUser(req);
    const row = getUser(ctx, u.id)!;
    if (!row.totp_enabled) throw bad('Two-factor is off');
    if (!(await verifyPassword(String((req.body as Record<string, unknown>)?.password ?? ''), row.password_hash))) throw bad('Your password is wrong', 'bad_credentials');
    const { codes, hashes } = newRecoveryCodes();
    ctx.db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(hashes), u.id);
    audit(ctx, req, 'account.recovery_codes_regenerated', u.id);
    return { recoveryCodes: codes };
  });

  /**
   * Lists the caller's signed-in devices. The id sent to the client is a prefix of the stored
   * hash: enough to target a revoke, but it is neither the cookie nor the full key.
   */
  app.get('/api/account/sessions', async (req) => {
    const u = requireUser(req);
    return ctx.db
      .all<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }>(
        'SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND mfa_pending = 0 ORDER BY last_seen_at DESC',
        u.id,
      )
      .map((s) => ({ id: s.id.slice(0, 16), current: s.id === req.sessionId, createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip, userAgent: s.user_agent }));
  });

  // Scoped to the caller's own sessions; the current one is excluded (use logout for that).
  app.delete('/api/account/sessions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    ctx.db.run("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ? AND id != ?", u.id, str(id, 16), req.sessionId ?? '');
    return { ok: true };
  });

  // ------------------------------------------------------------ invites

  /**
   * Creates a single-use signup link. Admins may only invite members; inviting another admin is
   * owner-only so admins can't grow their own ranks. Like sessions, only the token hash is kept,
   * which means a lost link can't be shown again: revoke it and make a new one.
   */
  app.post('/api/admin/invites', async (req) => {
    const u = requireRole(req, 'owner', 'admin');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const role = body.role === 'admin' ? 'admin' : 'member';
    if (role === 'admin' && u.role !== 'owner') throw forbidden('Only the owner can invite admins');
    // Clamp rather than reject so odd client input still yields a usable, bounded link.
    const days = Math.min(INVITE_DAYS_MAX, Math.max(1, Math.floor(Number(body.days) || 7)));
    const token = randomToken();
    const id = newId();
    ctx.db.run(
      'INSERT INTO invites (id, token_hash, role, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      sha256(token),
      role,
      str(body.note, 100) || null,
      u.id,
      now(),
      inDays(days),
    );
    audit(ctx, req, 'invite.created', id, { role, days });
    return { id, link: `${linkBase(ctx, req)}/invite/${token}` };
  });

  app.get('/api/admin/invites', async (req) => {
    requireRole(req, 'owner', 'admin');
    return ctx.db.all(
      `SELECT i.id, i.role, i.note, i.created_at AS createdAt, i.expires_at AS expiresAt, i.used_at AS usedAt, i.revoked_at AS revokedAt,
              c.display_name AS createdBy, u.username AS usedBy
         FROM invites i LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by
        ORDER BY i.created_at DESC LIMIT 100`,
    );
  });

  // Used invites are left alone so the record of who joined through them survives.
  app.delete('/api/admin/invites/:id', async (req) => {
    requireRole(req, 'owner', 'admin');
    const { id } = req.params as { id: string };
    ctx.db.run('UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL', now(), id);
    audit(ctx, req, 'invite.revoked', id);
    return { ok: true };
  });

  const liveInvite = (token: string) =>
    ctx.db.get<{ id: string; role: Role }>('SELECT id, role FROM invites WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?', sha256(token), now());

  // Public (no session), so these token-lookup routes are rate limited per IP to stop link guessing.
  app.get('/api/invites/:token', async (req, reply) => {
    inviteLimiter.check(req.ip, reply);
    const inv = liveInvite((req.params as { token: string }).token);
    return inv ? { valid: true, role: inv.role } : { valid: false };
  });

  app.post('/api/invites/:token/accept', async (req, reply) => {
    inviteLimiter.check(req.ip, reply);
    const inv = liveInvite((req.params as { token: string }).token);
    if (!inv) throw bad('This invite has expired or was already used. Ask for a new one.', 'invite_invalid');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = validUsername(body.username);
    if (usernameTaken(ctx, username)) throw bad('That username is taken', 'username_taken');
    const password = checkPassword(body.password, username);
    // Hash outside the transaction: Argon2 is async and node:sqlite transactions must stay synchronous.
    const hash = await hashPassword(password);
    const id = ctx.db.tx(() => {
      // Re-check inside the transaction so a token can't be redeemed twice concurrently.
      const claimed = ctx.db.run('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL', now(), inv.id);
      if (!claimed.changes) throw bad('This invite was already used', 'invite_invalid');
      const uid = createUser(ctx, { username, displayName: str(body.displayName, 60) || username, passwordHash: hash, role: inv.role });
      ctx.db.run('UPDATE invites SET used_by = ? WHERE id = ?', uid, inv.id);
      return uid;
    });
    createSession(ctx, req, reply, id);
    req.user = toSessionUser(getUser(ctx, id)!);
    audit(ctx, req, 'invite.accepted', inv.id, { userId: id });
    return { user: req.user };
  });

  // ------------------------------------------------------------ password reset links (admin-issued)
  // There is no self-service "forgot password" (no email). An admin generates a one-day link and
  // passes it on out of band; optionally it also clears 2FA for someone who lost their phone.

  const liveReset = (token: string) =>
    ctx.db.get<{ user_id: string; clear_totp: number; token_hash: string }>(
      'SELECT user_id, clear_totp, token_hash FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
      sha256(token),
      now(),
    );

  app.get('/api/reset/:token', async (req, reply) => {
    inviteLimiter.check(req.ip, reply);
    const r = liveReset((req.params as { token: string }).token);
    if (!r) return { valid: false };
    return { valid: true, username: getUser(ctx, r.user_id)?.username };
  });

  app.post('/api/reset/:token', async (req, reply) => {
    inviteLimiter.check(req.ip, reply);
    const r = liveReset((req.params as { token: string }).token);
    if (!r) throw bad('This reset link has expired or was already used', 'reset_invalid');
    const user = getUser(ctx, r.user_id)!;
    const password = checkPassword((req.body as Record<string, unknown>)?.password, user.username);
    const hash = await hashPassword(password);
    ctx.db.tx(() => {
      ctx.db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', now(), r.token_hash);
      // A reset also lifts any lockout, and signs out every existing session in case the
      // account was compromised; a fresh session is then issued to the person resetting.
      ctx.db.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?', hash, now(), user.id);
      if (r.clear_totp) ctx.db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = NULL WHERE id = ?', user.id);
      ctx.db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    });
    audit(ctx, req, 'account.password_reset', user.id);
    createSession(ctx, req, reply, user.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ user management

  app.get('/api/admin/users', async (req) => {
    requireRole(req, 'owner', 'admin');
    return ctx.db
      .all<UserRow>('SELECT * FROM users ORDER BY created_at')
      .map((u) => ({ ...toSessionUser(u), disabled: !!u.disabled, createdAt: u.created_at, lastLoginAt: u.last_login_at, locked: !!(u.locked_until && u.locked_until > now()) }));
  });

  /**
   * Owners can manage anyone but themselves; admins can only manage members.
   * Nobody can act on the owner through these routes, and nobody can act on themselves, which
   * stops an admin or owner from accidentally disabling or deleting their own account.
   */
  const canManage = (actor: SessionUser, target: UserRow) => actor.id !== target.id && target.role !== 'owner' && (actor.role === 'owner' || target.role === 'member');

  app.patch('/api/admin/users/:id', async (req) => {
    const actor = requireRole(req, 'owner', 'admin');
    const target = getUser(ctx, (req.params as { id: string }).id);
    if (!target || !canManage(actor, target)) throw forbidden();
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.role !== undefined) {
      // 'owner' is deliberately not assignable here; it only moves via transfer-ownership.
      if (actor.role !== 'owner' || !['admin', 'member'].includes(String(body.role))) throw forbidden('Only the owner can change roles');
      ctx.db.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', String(body.role), now(), target.id);
    }
    if (body.disabled !== undefined) {
      ctx.db.run('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?', body.disabled ? 1 : 0, now(), target.id);
      // attachSession would reject them anyway, but deleting makes the sign-out explicit and immediate.
      if (body.disabled) ctx.db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
    }
    if (body.unlock) ctx.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', target.id);
    audit(ctx, req, 'admin.user_updated', target.id, body);
    return { ok: true };
  });

  /**
   * Issues a reset link for another user. The raw token is only ever in the returned link; it
   * lives for a day to limit the damage if it is pasted somewhere it shouldn't be.
   */
  app.post('/api/admin/users/:id/reset', async (req) => {
    const actor = requireRole(req, 'owner', 'admin');
    const target = getUser(ctx, (req.params as { id: string }).id);
    if (!target || !canManage(actor, target)) throw forbidden();
    const token = randomToken();
    const clearTotp = !!(req.body as Record<string, unknown>)?.clearTotp;
    ctx.db.run(
      'INSERT INTO password_resets (token_hash, user_id, created_by, clear_totp, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      sha256(token),
      target.id,
      actor.id,
      clearTotp ? 1 : 0,
      now(),
      inDays(1),
    );
    audit(ctx, req, 'admin.reset_link_created', target.id, { clearTotp });
    return { link: `${linkBase(ctx, req)}/reset/${token}` };
  });

  // Owned collections, sessions and shares are removed by foreign key cascades in the schema.
  app.delete('/api/admin/users/:id', async (req) => {
    const actor = requireRole(req, 'owner', 'admin');
    const target = getUser(ctx, (req.params as { id: string }).id);
    if (!target || !canManage(actor, target)) throw forbidden();
    ctx.db.run('DELETE FROM users WHERE id = ?', target.id);
    audit(ctx, req, 'admin.user_deleted', target.id, { username: target.username });
    return { ok: true };
  });

  /**
   * Hands the owner role to another active user and demotes the current owner to admin, in one
   * transaction so the instance is never left with zero or two owners. Needs the owner's password
   * because it is the one change that can't be undone by anyone else.
   */
  app.post('/api/admin/users/:id/transfer-ownership', async (req) => {
    const actor = requireRole(req, 'owner');
    const target = getUser(ctx, (req.params as { id: string }).id);
    if (!target || target.id === actor.id || target.disabled) throw bad('Pick another active user');
    const row = getUser(ctx, actor.id)!;
    if (!(await verifyPassword(String((req.body as Record<string, unknown>)?.password ?? ''), row.password_hash))) throw bad('Your password is wrong', 'bad_credentials');
    ctx.db.tx(() => {
      ctx.db.run("UPDATE users SET role = 'owner' WHERE id = ?", target.id);
      ctx.db.run("UPDATE users SET role = 'admin' WHERE id = ?", actor.id);
    });
    audit(ctx, req, 'admin.ownership_transferred', target.id);
    return { ok: true };
  });

  /**
   * Directory for picking share recipients / collection members. Only usernames and names.
   * Open to every signed-in user by design: this is a small trusted instance, and the list
   * never includes roles, status or anything security-relevant.
   */
  app.get('/api/users', async (req) => {
    requireUser(req);
    return ctx.db.all("SELECT id, username, display_name AS displayName FROM users WHERE disabled = 0 ORDER BY display_name");
  });

  app.get('/api/admin/audit', async (req) => {
    requireRole(req, 'owner', 'admin');
    return ctx.db.all(
      `SELECT a.at, a.action, a.target, a.ip, a.detail, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`,
    );
  });
}
