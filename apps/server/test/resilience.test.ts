import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakerOpenError, RetryableError, getProviderHealth, isHealthy, recordStaleServe, resetProviderHealth, retryAfterMs, withBreaker, withResilience } from '../src/providers/resilience.ts';

const NAME = 'test-provider';

beforeEach(() => {
  resetProviderHealth();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Runs `withResilience`, letting every queued setTimeout (its retry backoff) fire as soon as it's scheduled. */
async function runWithFakeDelays<T>(fn: Parameters<typeof withResilience<T>>[1]) {
  const p = withResilience(NAME, fn);
  // Avoid an "unhandled rejection" warning while we advance fake timers before this function's
  // caller gets a chance to attach its own handler (e.g. `expect(...).rejects`).
  p.catch(() => {});
  // One withResilience call makes at most 3 backoff sleeps (MAX_ATTEMPTS - 1), each well under a
  // second even at the cap, so a single few-second advance is enough to settle it without
  // overshooting the breaker's 30s cooldown (which would mask an "open" assertion right after).
  await vi.advanceTimersByTimeAsync(5_000);
  return p;
}

describe('withResilience: retry with backoff', () => {
  it('retries a RetryableError and succeeds once the upstream recovers', async () => {
    let calls = 0;
    const result = await runWithFakeDelays(async () => {
      calls++;
      if (calls < 3) throw new RetryableError('network blip');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(getProviderHealth(NAME).state).toBe('closed');
  });

  it('gives up after the capped number of attempts and reports the failure', async () => {
    let calls = 0;
    await expect(
      runWithFakeDelays(async () => {
        calls++;
        throw new RetryableError('still down');
      }),
    ).rejects.toThrow('still down');
    // One initial attempt plus three retries, no more.
    expect(calls).toBe(4);
  });

  it('never retries a non-retryable error (e.g. the caller choosing not to retry a 404)', async () => {
    let calls = 0;
    await expect(
      withResilience(NAME, async () => {
        calls++;
        throw new Error('not found');
      }),
    ).rejects.toThrow('not found');
    expect(calls).toBe(1);
  });

  it('honours Retry-After almost exactly, then falls back to capped backoff', async () => {
    let calls = 0;
    const p = withResilience(NAME, async () => {
      calls++;
      if (calls === 1) throw new RetryableError('rate limited', 500); // Retry-After: 500ms
      if (calls === 2) throw new RetryableError('still busy'); // generic backoff, well under the 8s cap
      return 'ok';
    });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toBe(1); // Retry-After hasn't elapsed yet
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(2); // first retry fired right on schedule
    await vi.advanceTimersByTimeAsync(10_000); // more than enough for the generic backoff to fire
    expect(calls).toBe(3);
    expect(await p).toBe('ok');
  });
});

describe('circuit breaker', () => {
  it('opens after consecutive failures, rejects immediately while open, half-opens after cooldown, and closes on success', async () => {
    // Exhaust 5 separate calls so FAILURE_THRESHOLD consecutive failures accumulate.
    for (let i = 0; i < 5; i++) {
      await expect(
        runWithFakeDelays(async () => {
          throw new RetryableError('down');
        }),
      ).rejects.toThrow();
    }
    expect(getProviderHealth(NAME).state).toBe('open');
    expect(isHealthy(NAME)).toBe(false);

    // While open, the breaker rejects before even calling the attempt.
    const attempt = vi.fn();
    await expect(withResilience(NAME, attempt)).rejects.toBeInstanceOf(BreakerOpenError);
    expect(attempt).not.toHaveBeenCalled();

    // After the cooldown, exactly one half-open probe is allowed through; success closes the breaker.
    await vi.advanceTimersByTimeAsync(30_000);
    const probe = vi.fn(async () => 'recovered');
    const result = await withResilience(NAME, probe);
    expect(result).toBe('recovered');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getProviderHealth(NAME).state).toBe('closed');
    expect(isHealthy(NAME)).toBe(true);
  });

  it('re-opens if the half-open probe itself fails', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(runWithFakeDelays(async () => { throw new RetryableError('down'); })).rejects.toThrow();
    }
    await vi.advanceTimersByTimeAsync(30_000);
    // The probe itself retries internally (withResilience doesn't know it's "half-open"), so it
    // needs the same fake-timer draining as the setup failures above.
    await expect(runWithFakeDelays(async () => { throw new RetryableError('still down'); })).rejects.toThrow();
    expect(getProviderHealth(NAME).state).toBe('open');
  });

  it('allows exactly one upstream call when many concurrent requests arrive right after cooldown', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(runWithFakeDelays(async () => { throw new RetryableError('down'); })).rejects.toThrow();
    }
    expect(getProviderHealth(NAME).state).toBe('open');
    await vi.advanceTimersByTimeAsync(30_000);

    const upstreamCalls = vi.fn(async () => 'recovered');
    // Ten concurrent callers race to be the half-open probe; only the first should reach upstream.
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => withResilience(NAME, upstreamCalls)));
    expect(upstreamCalls).toHaveBeenCalledTimes(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(BreakerOpenError);
    expect(getProviderHealth(NAME).state).toBe('closed');
  });

  it('clears probing and reopens with a fresh cooldown when the half-open probe throws', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(runWithFakeDelays(async () => { throw new RetryableError('down'); })).rejects.toThrow();
    }
    await vi.advanceTimersByTimeAsync(30_000);
    // The probe fails immediately with a non-retryable error, so it doesn't go through the
    // backoff loop; it should still clear `probing` and move back to 'open'.
    await expect(withResilience(NAME, async () => { throw new Error('probe exploded'); })).rejects.toThrow('probe exploded');
    expect(getProviderHealth(NAME).state).toBe('open');

    // A second concurrent attempt right away must be rejected (breaker open, no new probe due).
    await expect(withResilience(NAME, vi.fn())).rejects.toBeInstanceOf(BreakerOpenError);

    // But after a fresh cooldown, a new probe is allowed again — proof `probing` isn't stuck true.
    await vi.advanceTimersByTimeAsync(30_000);
    const probe = vi.fn(async () => 'recovered');
    await expect(withResilience(NAME, probe)).resolves.toBe('recovered');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getProviderHealth(NAME).state).toBe('closed');
  });

  it('withBreaker participates in the same breaker without adding its own retries', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('boom');
    });
    for (let i = 0; i < 5; i++) {
      await expect(withBreaker(NAME, attempt)).rejects.toThrow('boom');
    }
    // No retries inside withBreaker: exactly one call per withBreaker invocation.
    expect(attempt).toHaveBeenCalledTimes(5);
    expect(getProviderHealth(NAME).state).toBe('open');
    await expect(withBreaker(NAME, attempt)).rejects.toBeInstanceOf(BreakerOpenError);
    expect(attempt).toHaveBeenCalledTimes(5);
  });
});

describe('stale-serve accounting', () => {
  it('counts every recorded stale serve', () => {
    expect(getProviderHealth(NAME).staleServedCount).toBe(0);
    recordStaleServe(NAME);
    recordStaleServe(NAME);
    expect(getProviderHealth(NAME).staleServedCount).toBe(2);
  });
});

describe('retryAfterMs', () => {
  it('parses a numeric seconds value', () => {
    const r = new Response(null, { headers: { 'retry-after': '2' } });
    expect(retryAfterMs(r)).toBe(2000);
  });

  it('parses an HTTP-date value', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const r = new Response(null, { headers: { 'retry-after': future } });
    expect(retryAfterMs(r)).toBeGreaterThan(4000);
  });

  it('returns undefined when the header is absent or invalid', () => {
    expect(retryAfterMs(new Response(null))).toBeUndefined();
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': 'nonsense' } }))).toBeUndefined();
  });
});
