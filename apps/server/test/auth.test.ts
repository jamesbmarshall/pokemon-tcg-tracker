import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as OTPAuth from 'otpauth';
import { Client, invite, PASSWORD, SETUP, setupOwner, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));
  s = await startServer();
});
afterEach(async () => {
  await s.close();
  vi.unstubAllGlobals();
});

describe('first-run setup', () => {
  it('requires the setup token and only works once', async () => {
    const c = new Client(s.app);
    expect((await c.get('/api/setup')).json()).toEqual({ needed: true });
    expect((await c.post('/api/setup', { token: 'nope', username: 'ash', password: PASSWORD })).statusCode).toBe(403);
    const ok = await c.post('/api/setup', { token: SETUP, username: 'ash', password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ username: 'ash', role: 'owner' });
    expect((await c.get('/api/setup')).json()).toEqual({ needed: false });
    const again = await new Client(s.app).post('/api/setup', { token: SETUP, username: 'gary', password: PASSWORD });
    expect(again.statusCode).toBe(403);
  });

  it('rejects weak passwords', async () => {
    const res = await new Client(s.app).post('/api/setup', { token: SETUP, username: 'ash', password: 'short' });
    expect(res.statusCode).toBe(400);
  });

  it('creates a personal collection for the owner', async () => {
    const c = await setupOwner(s.app);
    const list = (await c.get('/api/collections')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'personal', role: 'owner', mine: true });
  });
});

describe('sessions and CSRF', () => {
  it('blocks mutating requests without the custom header or from another origin', async () => {
    const c = await setupOwner(s.app);
    expect((await c.req('POST', '/api/collections', { name: 'x' }, { 'x-poketracker': '' })).statusCode).toBe(403);
    expect((await c.req('POST', '/api/collections', { name: 'x' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await c.req('POST', '/api/collections', { name: 'x' }, { origin: 'http://localhost:81' })).statusCode).toBe(403);
    expect((await c.post('/api/collections', { name: 'x' })).statusCode).toBe(200);
  });

  it('sets a hardened session cookie and logs out', async () => {
    const c = new Client(s.app);
    const res = await c.post('/api/setup', { token: SETUP, username: 'ash', password: PASSWORD });
    const cookie = res.cookies.find((k) => k.name === 'pt_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect((await c.get('/api/auth/me')).statusCode).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('logs in, rejects bad passwords generically and locks after repeated failures', async () => {
    await setupOwner(s.app);
    const c = new Client(s.app);
    const bad = await c.post('/api/auth/login', { username: 'ash', password: 'wrong password!' });
    expect(bad.statusCode).toBe(401);
    const unknown = await c.post('/api/auth/login', { username: 'nobody', password: 'wrong password!' });
    expect(unknown.json().error).toBe(bad.json().error);
    for (let i = 0; i < 7; i++) await c.post('/api/auth/login', { username: 'ash', password: 'wrong password!' });
    const locked = await c.post('/api/auth/login', { username: 'ash', password: PASSWORD });
    expect(locked.statusCode).toBe(429);
  });
});

describe('two-factor', () => {
  it('enrols TOTP, then requires a code at login and accepts a recovery code once', async () => {
    const c = await setupOwner(s.app);
    const { secret } = (await c.post('/api/account/totp/setup')).json();
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const enable = await c.post('/api/account/totp/enable', { code: totp.generate() });
    expect(enable.statusCode).toBe(200);
    const { recoveryCodes } = enable.json();
    expect(recoveryCodes).toHaveLength(10);

    const d = new Client(s.app);
    expect((await d.post('/api/auth/login', { username: 'ash', password: PASSWORD })).json()).toEqual({ mfa: true });
    // Pending MFA sessions can't use the API.
    expect((await d.get('/api/collections')).statusCode).toBe(401);
    expect((await d.post('/api/auth/mfa', { code: '000000' })).statusCode).toBe(401);
    expect((await d.post('/api/auth/mfa', { code: recoveryCodes[0] })).statusCode).toBe(200);
    expect((await d.get('/api/collections')).statusCode).toBe(200);

    const e = new Client(s.app);
    await e.post('/api/auth/login', { username: 'ash', password: PASSWORD });
    expect((await e.post('/api/auth/mfa', { code: recoveryCodes[0] })).statusCode).toBe(401);
  });

  it('never returns the TOTP secret in plain text from the database', async () => {
    const c = await setupOwner(s.app);
    const { secret } = (await c.post('/api/account/totp/setup')).json();
    const row = s.ctx.db.get<{ totp_secret: string }>('SELECT totp_secret FROM users')!;
    expect(row.totp_secret).not.toContain(secret);
    expect(row.totp_secret.startsWith('v1.')).toBe(true);
  });
});

describe('invites and roles', () => {
  it('invites a member who cannot manage users', async () => {
    const owner = await setupOwner(s.app);
    const misty = await invite(owner, s.app, 'misty');
    expect((await misty.get('/api/auth/me')).json().user.role).toBe('member');
    expect((await misty.get('/api/admin/users')).statusCode).toBe(403);
    expect((await misty.post('/api/admin/invites', {})).statusCode).toBe(403);
  });

  it('makes invite links single-use', async () => {
    const owner = await setupOwner(s.app);
    const { link } = (await owner.post('/api/admin/invites', {})).json();
    const token = link.split('/invite/')[1];
    expect((await new Client(s.app).post(`/api/invites/${token}/accept`, { username: 'brock', password: PASSWORD })).statusCode).toBe(200);
    expect((await new Client(s.app).post(`/api/invites/${token}/accept`, { username: 'brock2', password: PASSWORD })).statusCode).toBe(400);
  });

  it('only lets the owner invite admins, and admins cannot manage other admins', async () => {
    const owner = await setupOwner(s.app);
    const admin = await invite(owner, s.app, 'brock', 'admin');
    expect((await admin.post('/api/admin/invites', { role: 'admin' })).statusCode).toBe(403);
    const other = await invite(owner, s.app, 'erika', 'admin');
    const otherId = (await other.get('/api/auth/me')).json().user.id;
    expect((await admin.patch(`/api/admin/users/${otherId}`, { disabled: true })).statusCode).toBe(403);
  });

  it('disabling a user ends their sessions', async () => {
    const owner = await setupOwner(s.app);
    const misty = await invite(owner, s.app, 'misty');
    const id = (await misty.get('/api/auth/me')).json().user.id;
    expect((await owner.patch(`/api/admin/users/${id}`, { disabled: true })).statusCode).toBe(200);
    expect((await misty.get('/api/collections')).statusCode).toBe(401);
  });
});
