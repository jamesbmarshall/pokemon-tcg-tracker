import { create } from 'zustand';
import { api, ApiError, onUnauthenticated } from '../api/http';
import { useSettings } from './settingsStore';
import { useCollectionStore } from './collectionStore';

export type Role = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  totpEnabled: boolean;
}

/**
 * - loading: asking the server who we are
 * - setup: brand-new server with no owner yet
 * - signed-out / mfa: show the sign-in page (mfa = password accepted, waiting for the code)
 * - ready: signed in
 * - offline: the server couldn't be reached
 */
export type AuthStatus = 'loading' | 'setup' | 'signed-out' | 'mfa' | 'ready' | 'offline';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  setup: (input: { token: string; username: string; displayName: string; password: string }) => Promise<void>;
  acceptInvite: (token: string, input: { username: string; displayName: string; password: string }) => Promise<void>;
  /** After the server has created a session some other way (e.g. a reset link). */
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
  signedOut: () => void;
}

type SyncedPrefs = Pick<ReturnType<typeof useSettings.getState>, 'currency' | 'pocketSize' | 'setView' | 'setMode' | 'quickAdd' | 'viewPrefs'>;
const PREF_KEYS = ['currency', 'pocketSize', 'setView', 'setMode', 'quickAdd', 'viewPrefs'] as const;

let stopPrefSync: (() => void) | undefined;

/** Display preferences follow the user between devices: apply the server copy, then save changes back. */
function startPrefSync(prefs: { settings?: Partial<SyncedPrefs> } | undefined) {
  stopPrefSync?.();
  const saved = prefs?.settings;
  if (saved && typeof saved === 'object') {
    const next: Partial<SyncedPrefs> = {};
    for (const k of PREF_KEYS) if (saved[k] !== undefined) (next as Record<string, unknown>)[k] = saved[k];
    useSettings.setState(next);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = useSettings.subscribe((s, prev) => {
    if (PREF_KEYS.every((k) => s[k] === prev[k])) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const settings = Object.fromEntries(PREF_KEYS.map((k) => [k, useSettings.getState()[k]]));
      void api('/api/account', { method: 'PATCH', body: { prefs: { settings } } }).catch(() => undefined);
    }, 1000);
  });
  stopPrefSync = () => {
    clearTimeout(timer);
    unsub();
    stopPrefSync = undefined;
  };
}

interface Me {
  user: User;
  prefs?: { settings?: Partial<SyncedPrefs> };
}

export const useAuth = create<AuthState>((set, get) => {
  const signedIn = (me: Me) => {
    const prev = get().user;
    if (prev && prev.id !== me.user.id) useCollectionStore.getState().reset();
    set({ status: 'ready', user: me.user, error: null });
    startPrefSync(me.prefs);
  };
  const fetchMe = async () => signedIn(await api<Me>('/api/auth/me', { quiet401: true }));

  return {
    status: 'loading',
    user: null,
    error: null,

    init: async () => {
      set({ status: 'loading', error: null });
      try {
        const { needed } = await api<{ needed: boolean }>('/api/setup');
        if (needed) return set({ status: 'setup', user: null });
        await fetchMe();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return set({ status: 'signed-out', user: null });
        set({ status: 'offline', error: err instanceof Error ? err.message : 'The server is unavailable' });
      }
    },

    login: async (username, password) => {
      const r = await api<{ mfa?: boolean; user?: User }>('/api/auth/login', { method: 'POST', body: { username, password }, quiet401: true });
      if (r.mfa) return set({ status: 'mfa' });
      await fetchMe();
    },

    verifyMfa: async (code) => {
      try {
        await api('/api/auth/mfa', { method: 'POST', body: { code: code.trim() }, quiet401: true });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'mfa_expired') set({ status: 'signed-out' });
        throw err;
      }
      await fetchMe();
    },

    setup: async (input) => {
      await api('/api/setup', { method: 'POST', body: input });
      await fetchMe();
    },

    acceptInvite: async (token, input) => {
      await api(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: input });
      await fetchMe();
    },

    refreshUser: fetchMe,

    setUser: (user) => set({ user }),

    logout: async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      get().signedOut();
    },

    signedOut: () => {
      stopPrefSync?.();
      useCollectionStore.getState().reset();
      set({ status: 'signed-out', user: null });
    },
  };
});

// Any request that finds the session gone (expired, revoked elsewhere, account disabled) lands on sign-in.
onUnauthenticated(() => {
  if (useAuth.getState().status === 'ready') useAuth.getState().signedOut();
});

export const useUser = () => useAuth((s) => s.user);
export const isAdmin = (u: User | null | undefined) => u?.role === 'owner' || u?.role === 'admin';
