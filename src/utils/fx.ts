import type { Currency } from '../store/settingsStore';
import type { Paid } from '../api/types';

export type Rates = Record<Currency, number>;
export const FX_KEY = 'poketracker-fx';
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
  return r ? paid.amount / r : undefined;
}

export function isPaid(v: unknown): v is Paid {
  const p = v as Paid;
  return !!p && typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0 && CURRENCIES.includes(p.currency);
}
