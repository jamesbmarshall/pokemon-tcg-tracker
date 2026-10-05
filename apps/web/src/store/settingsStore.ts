/**
 * Display preferences, persisted to localStorage so the first paint uses them before the server
 * responds. Most fields are also synced per user by authStore (see startPrefSync), so the
 * server copy wins once signed in.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Currency = 'GBP' | 'EUR' | 'USD';
/** Base = numbered cards, Full = every card incl. secret rares, Master = every printing. */
export type SetMode = 'base' | 'full' | 'master';

interface SettingsState {
  currency: Currency;
  pocketSize: 9 | 12;
  setView: 'grid' | 'binder';
  setMode: SetMode;
  quickAdd: boolean;
  /** Free-form per-page view choices (sort order, filters) keyed by page, so new pages need no schema change. */
  viewPrefs: Record<string, string>;
  setCurrency: (c: Currency) => void;
  setPocketSize: (n: 9 | 12) => void;
  setSetView: (v: 'grid' | 'binder') => void;
  setSetMode: (m: SetMode) => void;
  setQuickAdd: (b: boolean) => void;
  setViewPref: (key: string, value: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currency: 'GBP',
      pocketSize: 9,
      setView: 'grid',
      setMode: 'master',
      quickAdd: false,
      viewPrefs: {},
      setCurrency: (currency) => set({ currency }),
      setPocketSize: (pocketSize) => set({ pocketSize }),
      setSetView: (setView) => set({ setView }),
      setSetMode: (setMode) => set({ setMode }),
      setQuickAdd: (quickAdd) => set({ quickAdd }),
      setViewPref: (key, value) => set((st) => ({ viewPrefs: { ...st.viewPrefs, [key]: value } })),
    }),
    { name: 'poketracker-settings' },
  ),
);
