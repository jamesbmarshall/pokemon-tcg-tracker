import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMoney, useRates } from './useMoney';
import { useSettings } from '../store/settingsStore';
import { mockFetch } from '../test/fetchMock';

const initial = useSettings.getState();
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => useSettings.setState(initial, true));

describe('useMoney', () => {
  it('formats in GBP using fallback rates while live rates load', () => {
    mockFetch([{ match: '/api/fx', networkError: true }]);
    const { result } = renderHook(() => useMoney(), { wrapper });
    expect(result.current(10)).toBe('£7.60');
    expect(result.current(null)).toBe('—');
    expect(result.current(undefined, { dash: 'n/a' })).toBe('n/a');
    expect(result.current(Number.NaN)).toBe('—');
  });

  it('uses compact notation for large values', () => {
    mockFetch([{ match: '/api/fx', networkError: true }]);
    useSettings.setState({ currency: 'USD' });
    const { result } = renderHook(() => useMoney(), { wrapper });
    expect(result.current(1234.56)).toBe('US$1,234.56');
    expect(result.current(1234.56, { compact: true })).toBe('US$1,235');
    expect(result.current(25000, { compact: true })).toBe('US$25K');
    expect(result.current(50, { compact: true })).toBe('US$50.00');
  });

  it('fetches live rates, caches them and re-formats', async () => {
    const fetch = mockFetch([{ match: '/api/fx', body: { rates: { USD: 1, GBP: 0.5, EUR: 0.9 }, at: 1_700_000_000_000 } }]);
    const { result } = renderHook(() => useMoney(), { wrapper });
    await waitFor(() => expect(result.current(10)).toBe('£5.00'));
    expect(String(fetch.mock.calls[0][0])).toBe('/api/fx');
    expect(JSON.parse(localStorage.getItem('poketracker-fx')!)).toEqual({ rates: { USD: 1, GBP: 0.5, EUR: 0.9 }, at: 1_700_000_000_000 });
  });

  it('uses cached rates without fetching while fresh', () => {
    localStorage.setItem('poketracker-fx', JSON.stringify({ rates: { USD: 1, GBP: 2, EUR: 3 }, at: Date.now() }));
    const fetch = mockFetch([]);
    useSettings.setState({ currency: 'EUR' });
    const { result } = renderHook(() => useMoney(), { wrapper });
    expect(result.current(1)).toBe('€3.00');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats corrupt cached rates as missing and surfaces FX errors', async () => {
    localStorage.setItem('poketracker-fx', '{oops');
    mockFetch([{ match: '/api/fx', status: 200, body: { rates: null, at: null } }]);
    const { result } = renderHook(() => useRates(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('FX unavailable');
  });
});
