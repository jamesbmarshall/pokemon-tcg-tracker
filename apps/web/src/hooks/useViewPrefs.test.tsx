import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useRememberedParams, useViewPref } from './useViewPrefs';
import { useSettings } from '../store/settingsStore';

const wrap = (route: string) => ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;

beforeEach(() => useSettings.setState({ viewPrefs: {} }));

describe('useViewPref', () => {
  it('falls back, remembers, and rejects values outside the allowed list', () => {
    const { result, rerender } = renderHook(() => useViewPref('w.sort', 'newest', ['newest', 'price'] as const));
    expect(result.current[0]).toBe('newest');
    act(() => result.current[1]('price'));
    expect(result.current[0]).toBe('price');
    expect(useSettings.getState().viewPrefs['w.sort']).toBe('price');
    act(() => useSettings.setState({ viewPrefs: { 'w.sort': 'bogus' } }));
    rerender();
    expect(result.current[0]).toBe('newest');
  });
});

describe('useRememberedParams', () => {
  const setup = (route = '/x') =>
    renderHook(() => ({ p: useRememberedParams('s', ['a', 'b']), loc: useLocation() }), { wrapper: wrap(route) });

  it('prefers the URL, then the remembered value, and never remembers unlisted keys', () => {
    useSettings.setState({ viewPrefs: { 's.a': 'saved', 's.c': 'nope' } });
    expect(setup().result.current.p.get('a')).toBe('saved');
    expect(setup().result.current.p.get('c')).toBe('');
    expect(setup('/x?a=url').result.current.p.get('a')).toBe('url');
  });

  it('applies several changes at once without clobbering', () => {
    const { result } = setup('/x?a=1&c=keep');
    act(() => result.current.p.update({ a: '', b: '2' }));
    expect(result.current.loc.search).toBe('?c=keep&b=2');
    expect(useSettings.getState().viewPrefs).toMatchObject({ 's.a': '', 's.b': '2' });
    act(() => result.current.p.update('c', 'x'));
    expect(result.current.loc.search).toBe('?c=x&b=2');
    expect(useSettings.getState().viewPrefs['s.c']).toBeUndefined();
  });
});
