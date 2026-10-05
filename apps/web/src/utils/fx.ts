/**
 * Currency conversion. All market prices are stored and computed in USD; this module converts to
 * the user's chosen display currency. Rates are expressed as units of currency per 1 USD and come
 * from the server, cached in localStorage so conversions work synchronously outside React.
 */
import type { Currency } from '../store/settingsStore';
import type { Paid } from '../api/types';

export type Rates = Record<Currency, number>;
export const FX_KEY = 'poketracker-fx';
// Rough rates used only until the first server fetch, so prices never render as blank.
export const FALLBACK_RATES: Rates = { USD: 1, GBP: 0.76, EUR: 0.89 };
export const CURRENCIES: readonly Currency[] = ['GBP', 'USD', 'EUR'];

export function cachedFx(): { rates: Rates; at: number } | null {
  try {
    return JSON.parse(localStorage.getItem(FX_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** Latest known rates (from USD), for code running outside React. */
export const currentRates = (): Rates => cachedFx()?.rates ?? FALLBACK_RATES;

/** Converts an amount the user paid (in whatever currency they entered it) into USD. */
export function paidUsd(paid: Paid | undefined, rates: Rates): number | undefined {
  if (!paid) return undefined;
  const r = rates[paid.currency];
  // Rates are per USD, so dividing goes back to USD. A missing rate yields undefined rather than a wrong figure.
  return r ? paid.amount / r : undefined;
}

/** Validates a price-paid value from user input or an import. Zero is valid (gifts, pulls). */
export function isPaid(v: unknown): v is Paid {
  const p = v as Paid;
  return !!p && typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0 && CURRENCIES.includes(p.currency);
}
