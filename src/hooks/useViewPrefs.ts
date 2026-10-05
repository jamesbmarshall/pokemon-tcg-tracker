import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../store/settingsStore';

/** A view choice held in local state and remembered between visits. */
export function useViewPref<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const saved = useSettings((s) => s.viewPrefs[key]) as T | undefined;
  const setPref = useSettings((s) => s.setViewPref);
  const value = saved && (!allowed || allowed.includes(saved)) ? saved : fallback;
  const set = useCallback((v: T) => setPref(key, v), [key, setPref]);
  return [value, set];
}

/**
 * URL search params where the listed keys are also remembered. An explicit
 * param in the URL (e.g. a deep link) wins; otherwise the last choice is used.
 */
export function useRememberedParams(scope: string, remembered: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const prefs = useSettings((s) => s.viewPrefs);
  const setPref = useSettings((s) => s.setViewPref);

  const get = (k: string): string => {
    if (params.has(k)) return params.get(k) ?? '';
    return remembered.includes(k) ? (prefs[`${scope}.${k}`] ?? '') : '';
  };

  /** Set one param, or several at once via an object (separate calls would clobber each other). */
  const update = (k: string | Record<string, string>, v = '') => {
    const changes = typeof k === 'string' ? { [k]: v } : k;
    for (const [key, val] of Object.entries(changes)) if (remembered.includes(key)) setPref(`${scope}.${key}`, val);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, val] of Object.entries(changes)) {
          if (val) next.set(key, val);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };

  return { get, update };
}
