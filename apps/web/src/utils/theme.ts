import { useEffect } from 'react';
import { useSettings, type ThemePref } from '../store/settingsStore';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

function systemPrefersDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Sets data-theme on <html> (read by the colour tokens in index.css) and the browser chrome colour. */
export function applyTheme(pref: ThemePref) {
  const theme = resolveTheme(pref, systemPrefersDark());
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--color-canvas').trim() || (theme === 'dark' ? '#12110f' : '#f4f1ea'));
}

/** Keeps the page theme in step with the setting and, on 'system', with the OS. */
export function useThemeSync() {
  const pref = useSettings((s) => s.theme);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);
}
