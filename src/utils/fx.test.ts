import { afterEach, describe, expect, it } from 'vitest';
import { currentRates, FALLBACK_RATES, FX_KEY, isPaid, paidUsd } from './fx';

afterEach(() => localStorage.removeItem(FX_KEY));

describe('fx', () => {
  it('reads cached rates, falling back when missing or corrupt', () => {
    localStorage.removeItem(FX_KEY);
    expect(currentRates()).toEqual(FALLBACK_RATES);
    localStorage.setItem(FX_KEY, '{nope');
    expect(currentRates()).toEqual(FALLBACK_RATES);
    localStorage.setItem(FX_KEY, JSON.stringify({ rates: { USD: 1, GBP: 0.8, EUR: 0.9 }, at: 1 }));
    expect(currentRates().GBP).toBe(0.8);
  });

  it('converts a paid amount to USD from its own currency', () => {
    const rates = { USD: 1, GBP: 0.5, EUR: 0.8 };
    expect(paidUsd({ amount: 5, currency: 'GBP' }, rates)).toBe(10);
    expect(paidUsd({ amount: 5, currency: 'USD' }, rates)).toBe(5);
    expect(paidUsd(undefined, rates)).toBeUndefined();
  });

  it.each([
    [{ amount: 0, currency: 'GBP' }, true],
    [{ amount: 3.5, currency: 'EUR' }, true],
    [{ amount: -1, currency: 'GBP' }, false],
    [{ amount: NaN, currency: 'GBP' }, false],
    [{ amount: 1, currency: 'JPY' }, false],
    [{ amount: '1', currency: 'GBP' }, false],
    [null, false],
  ])('isPaid(%o) is %s', (v, ok) => expect(isPaid(v)).toBe(ok));
});
