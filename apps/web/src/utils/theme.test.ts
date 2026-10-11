import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { applyTheme, resolveTheme, useThemeSync } from './theme';
import { useSettings } from '../store/settingsStore';

/** A controllable prefers-color-scheme media query. */
function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mq as unknown as MediaQueryList);
  return {
    mq,
    listeners,
    flip(next: boolean) {
      dark = next;
      listeners.forEach((fn) => fn());
    },
  };
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  document.head.innerHTML = '<meta name="theme-color" content="">';
  useSettings.setState({ theme: 'system' });
});
afterEach(() => vi.restoreAllMocks());

describe('resolveTheme', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] as const)('%s with a %s system preference is %s', (pref, systemDark, expected) => {
    expect(resolveTheme(pref, systemDark)).toBe(expected);
  });
});

describe('applyTheme', () => {
  it('follows the system preference on "system"', () => {
    mockSystem(true);
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('lets an explicit choice override the system', () => {
    mockSystem(true);
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('updates the browser chrome colour', () => {
    mockSystem(false);
    applyTheme('dark');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#12110f');
    applyTheme('light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f1ea');
  });
});

describe('useThemeSync', () => {
  it('tracks OS changes while the setting is "system"', () => {
    const sys = mockSystem(false);
    renderHook(() => useThemeSync());
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => sys.flip(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies a chosen theme and stops listening to the OS', () => {
    const sys = mockSystem(false);
    renderHook(() => useThemeSync());
    act(() => useSettings.getState().setTheme('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(sys.listeners.size).toBe(0);
    act(() => sys.flip(false));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
