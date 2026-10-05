import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth, isAdmin, type User } from './authStore';
import { useCollectionStore } from './collectionStore';
import { useSettings } from './settingsStore';
import { api } from '../api/http';
import { mockApi, reply } from '../test/apiMock';

const ash: User = { id: 'u1', username: 'ash', displayName: 'Ash', role: 'owner', totpEnabled: false };
const misty: User = { id: 'u2', username: 'misty', displayName: 'Misty', role: 'member', totpEnabled: true };

beforeEach(() => {
  useAuth.setState({ status: 'loading', user: null, error: null });
});
afterEach(() => {
  useAuth.getState().signedOut();
  vi.useRealTimers();
});

describe('init', () => {
  it('asks for setup on a brand-new server', async () => {
    mockApi({ 'GET /api/setup': { needed: true } });
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('setup');
  });

  it('signs in from an existing session', async () => {
    mockApi({ 'GET /api/setup': { needed: false }, 'GET /api/auth/me': { user: ash } });
    await useAuth.getState().init();
    expect(useAuth.getState()).toMatchObject({ status: 'ready', user: ash });
  });

  it('shows sign-in when there is no session', async () => {
    mockApi({ 'GET /api/setup': { needed: false }, 'GET /api/auth/me': reply(401, { error: 'Not signed in' }) });
    await useAuth.getState().init();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-out', user: null });
  });

  it('reports an unreachable server', async () => {
    mockApi({ 'GET /api/setup': new TypeError('Failed to fetch') });
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('offline');
    expect(useAuth.getState().error).toMatch(/couldn't reach/i);
  });

  it('applies the preferences saved on the server', async () => {
    mockApi({ 'GET /api/setup': { needed: false }, 'GET /api/auth/me': { user: ash, prefs: { settings: { currency: 'EUR', bogus: 1 } } } });
    await useAuth.getState().init();
    expect(useSettings.getState().currency).toBe('EUR');
    expect(useSettings.getState()).not.toHaveProperty('bogus');
  });
});

describe('login', () => {
  it('goes straight in without 2FA', async () => {
    const m = mockApi({ 'POST /api/auth/login': { user: ash }, 'GET /api/auth/me': { user: ash } });
    await useAuth.getState().login('ash', 'correct horse');
    expect(m.called('POST /api/auth/login')[0].body).toEqual({ username: 'ash', password: 'correct horse' });
    expect(useAuth.getState().status).toBe('ready');
  });

  it('waits for a code when 2FA is on', async () => {
    mockApi({ 'POST /api/auth/login': { mfa: true }, 'POST /api/auth/mfa': {}, 'GET /api/auth/me': { user: misty } });
    await useAuth.getState().login('misty', 'pw');
    expect(useAuth.getState().status).toBe('mfa');
    await useAuth.getState().verifyMfa(' 123456 ');
    expect(useAuth.getState()).toMatchObject({ status: 'ready', user: misty });
  });

  it('returns to the password step when the 2FA window expires', async () => {
    useAuth.setState({ status: 'mfa' });
    mockApi({ 'POST /api/auth/mfa': reply(401, { error: 'Sign in again', code: 'mfa_expired' }) });
    await expect(useAuth.getState().verifyMfa('123456')).rejects.toThrow('Sign in again');
    expect(useAuth.getState().status).toBe('signed-out');
  });

  it('stays on the code step after a wrong code', async () => {
    useAuth.setState({ status: 'mfa' });
    mockApi({ 'POST /api/auth/mfa': reply(401, { error: "That code didn't work" }) });
    await expect(useAuth.getState().verifyMfa('000000')).rejects.toThrow("didn't work");
    expect(useAuth.getState().status).toBe('mfa');
  });

  it('does not sign out the app on a failed password', async () => {
    mockApi({ 'POST /api/auth/login': reply(401, { error: 'Wrong username or password' }) });
    useAuth.setState({ status: 'signed-out' });
    await expect(useAuth.getState().login('ash', 'nope')).rejects.toThrow('Wrong username or password');
    expect(useAuth.getState().status).toBe('signed-out');
  });
});

describe('signing out', () => {
  it('logout clears the user and the loaded collection', async () => {
    useAuth.setState({ status: 'ready', user: ash });
    const reset = vi.spyOn(useCollectionStore.getState(), 'reset');
    const m = mockApi({ 'POST /api/auth/logout': {} });
    await useAuth.getState().logout();
    expect(m.called('POST /api/auth/logout')).toHaveLength(1);
    expect(reset).toHaveBeenCalled();
    expect(useAuth.getState()).toMatchObject({ status: 'signed-out', user: null });
  });

  it('logout still signs out locally if the server is unreachable', async () => {
    useAuth.setState({ status: 'ready', user: ash });
    mockApi({ 'POST /api/auth/logout': new TypeError('offline') });
    await useAuth.getState().logout();
    expect(useAuth.getState().status).toBe('signed-out');
  });

  it('any 401 from the API signs the user out', async () => {
    useAuth.setState({ status: 'ready', user: ash });
    mockApi({ 'GET /api/collections': reply(401, { error: 'Session expired' }) });
    await expect(api('/api/collections')).rejects.toThrow('Session expired');
    expect(useAuth.getState().status).toBe('signed-out');
  });

  it('switching to a different user drops the previous collection', async () => {
    useAuth.setState({ status: 'ready', user: ash });
    const reset = vi.spyOn(useCollectionStore.getState(), 'reset');
    mockApi({ 'GET /api/auth/me': { user: misty } });
    await useAuth.getState().refreshUser();
    expect(reset).toHaveBeenCalled();
    expect(useAuth.getState().user).toEqual(misty);
  });
});

it('saves preference changes back to the server, debounced', async () => {
  mockApi({ 'GET /api/setup': { needed: false }, 'GET /api/auth/me': { user: ash } });
  await useAuth.getState().init();
  vi.useFakeTimers();
  const m = mockApi({ 'PATCH /api/account': {} });
  useSettings.setState({ currency: 'GBP' });
  useSettings.setState({ currency: 'EUR' });
  expect(m.calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1100);
  const sent = m.called('PATCH /api/account');
  expect(sent).toHaveLength(1);
  expect((sent[0].body as { prefs: { settings: { currency: string } } }).prefs.settings.currency).toBe('EUR');
});

it('isAdmin covers owners and admins only', () => {
  expect(isAdmin(ash)).toBe(true);
  expect(isAdmin({ ...ash, role: 'admin' })).toBe(true);
  expect(isAdmin(misty)).toBe(false);
  expect(isAdmin(null)).toBe(false);
});
