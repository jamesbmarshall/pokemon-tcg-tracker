import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSettings } from '../store/settingsStore';

import { cachedFx as cached, FALLBACK_RATES as FALLBACK, FX_KEY, type Rates } from '../utils/fx';

async function fetchRates(): Promise<Rates> {
  const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR');
  if (!res.ok) throw new Error('FX unavailable');
  const json = (await res.json()) as { rates: { GBP: number; EUR: number } };
  const rates = { USD: 1, GBP: json.rates.GBP, EUR: json.rates.EUR };
  localStorage.setItem(FX_KEY, JSON.stringify({ rates, at: Date.now() }));
  return rates;
}

export function useRates() {
  const c = cached();
  return useQuery({
    queryKey: ['fx'],
    queryFn: fetchRates,
    staleTime: 12 * 60 * 60 * 1000,
    initialData: c?.rates,
    initialDataUpdatedAt: c?.at,
    placeholderData: FALLBACK,
  });
}

/** Returns a formatter converting USD market prices into the user's chosen currency. */
export function useMoney() {
  const currency = useSettings((s) => s.currency);
  const { data: rates = FALLBACK } = useRates();
  return useCallback(
    (usd: number | undefined | null, opts: { compact?: boolean; dash?: string } = {}) => {
      if (usd == null || Number.isNaN(usd)) return opts.dash ?? '—';
      const v = usd * rates[currency];
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        notation: opts.compact && v >= 10000 ? 'compact' : 'standard',
        maximumFractionDigits: opts.compact && v >= 100 ? 0 : 2,
        minimumFractionDigits: opts.compact && v >= 100 ? 0 : 2,
      }).format(v);
    },
    [currency, rates],
  );
}

/** Display currency and its rate from USD, for converting user-entered amounts back to USD. */
export function useFx() {
  const currency = useSettings((s) => s.currency);
  const { data: rates = FALLBACK } = useRates();
  return { currency, rate: rates[currency], rates };
}
