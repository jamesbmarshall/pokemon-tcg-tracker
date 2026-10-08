/**
 * Retry with backoff, a per-provider circuit breaker, and in-memory health tracking for
 * upstream HTTP calls. Shared by the TCGdex catalogue proxy (catalog.ts) and the PriceCharting
 * provider — both are third-party services this app has no control over, so a blip in either
 * should degrade gracefully (serve stale data) rather than break pages or burn requests against
 * a service that is already down.
 *
 * Health is kept in memory only (not persisted): it resets on restart, which is fine since a
 * restarting process is itself evidence the previous state no longer applies, and nothing here
 * decides what to serve on its own — callers still own their stale-cache fallback.
 */

/** Thrown by an `attempt` callback for failures that should be retried: network errors, 5xx, 429. */
export class RetryableError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Thrown by withResilience itself when the breaker is open and no probe is due yet. */
export class BreakerOpenError extends Error {
  constructor(name: string) {
    super(`${name} is temporarily unavailable (circuit breaker open)`);
  }
}

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface ProviderHealth {
  name: string;
  state: BreakerState;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  /** Number of times stale cached data was served in place of a failed upstream call. */
  staleServedCount: number;
  openedAt: string | null;
}

// Open the breaker after this many attempts in a row have failed outright (retries exhausted).
const FAILURE_THRESHOLD = 5;
// How long the breaker stays open before a single half-open probe is allowed through.
const COOLDOWN_MS = 30_000;
// One initial attempt plus three retries.
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 300;
const MAX_DELAY_MS = 8_000;

interface Rec {
  state: BreakerState;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  staleServedCount: number;
  openedAt: number | null;
  /** True while a half-open probe is in flight, so concurrent calls don't all probe at once. */
  probing: boolean;
}

const registry = new Map<string, Rec>();

function rec(name: string): Rec {
  let r = registry.get(name);
  if (!r) {
    r = { state: 'closed', consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastError: null, staleServedCount: 0, openedAt: null, probing: false };
    registry.set(name, r);
  }
  return r;
}

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

export function getProviderHealth(name: string): ProviderHealth {
  const r = rec(name);
  return {
    name,
    state: r.state,
    consecutiveFailures: r.consecutiveFailures,
    lastSuccessAt: iso(r.lastSuccessAt),
    lastFailureAt: iso(r.lastFailureAt),
    lastError: r.lastError,
    staleServedCount: r.staleServedCount,
    openedAt: iso(r.openedAt),
  };
}

/** Every provider that has recorded at least one call so far, for the admin health panel. */
export function allProviderHealth(): ProviderHealth[] {
  return Array.from(registry.keys(), getProviderHealth);
}

/** Non-sensitive "is this provider degraded" flag, safe to expose to every signed-in user. */
export function isHealthy(name: string): boolean {
  return registry.get(name)?.state !== 'open';
}

/** Callers record every time they serve stale data in place of a failed live call. */
export function recordStaleServe(name: string) {
  rec(name).staleServedCount++;
}

/** Resets a provider's breaker and counters. Test-only escape hatch. */
export function resetProviderHealth(name?: string) {
  if (name) registry.delete(name);
  else registry.clear();
}

/**
 * Decides whether this call may proceed, and performs the open → half-open transition as a side
 * effect when a probe becomes due.
 *
 * - closed: always allowed.
 * - half-open: a probe is already in flight (`probing` is only ever set here, and cleared by
 *   onSuccess/onFailure), so every other concurrent caller is rejected until it resolves. This
 *   is the guard the old `r.state !== 'open'` check accidentally skipped for 'half-open', which
 *   let unlimited concurrent callers all probe the upstream at once.
 * - open: rejected unless the cooldown has elapsed, in which case exactly one caller flips the
 *   breaker to half-open, marks a probe in flight, and is let through.
 */
function mayAttempt(r: Rec): boolean {
  if (r.state === 'closed') return true;
  if (r.state === 'half-open') return false;
  if (r.probing) return false;
  if (r.openedAt != null && Date.now() - r.openedAt >= COOLDOWN_MS) {
    r.state = 'half-open';
    r.probing = true;
    return true;
  }
  return false;
}

function onSuccess(r: Rec) {
  r.state = 'closed';
  r.consecutiveFailures = 0;
  r.openedAt = null;
  r.probing = false;
  r.lastSuccessAt = Date.now();
  r.lastError = null;
}

function onFailure(r: Rec, err: unknown) {
  r.consecutiveFailures++;
  r.lastFailureAt = Date.now();
  r.lastError = err instanceof Error ? err.message : String(err);
  const wasProbing = r.probing;
  r.probing = false;
  if (wasProbing || r.consecutiveFailures >= FAILURE_THRESHOLD) {
    r.state = 'open';
    r.openedAt = Date.now();
  }
}

function jitteredDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs != null) return Math.max(0, Math.min(retryAfterMs, MAX_DELAY_MS));
  const cap = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  // Full jitter within [cap/2, cap], so retries from many concurrent requests don't all land together.
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt` with retry (exponential backoff + jitter, capped at MAX_DELAY_MS, honouring a
 * RetryableError's `retryAfterMs`) and a circuit breaker keyed by `name`.
 *
 * `attempt` should throw `RetryableError` for network errors, 5xx and 429; any other error
 * (including a plain 4xx the caller chooses not to retry) is treated as immediately fatal and
 * is not retried, matching "never retry 4xx other than 429". Resolves with the attempt's
 * result; rejects with `BreakerOpenError` if the breaker is open and no probe is due, or with
 * the last error once retries are exhausted.
 */
export async function withResilience<T>(name: string, attempt: (attemptNo: number) => Promise<T>): Promise<T> {
  const r = rec(name);
  if (!mayAttempt(r)) throw new BreakerOpenError(name);
  try {
    let lastErr: unknown;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const result = await attempt(i);
        onSuccess(r);
        return result;
      } catch (err) {
        lastErr = err;
        if (!(err instanceof RetryableError) || i === MAX_ATTEMPTS - 1) {
          onFailure(r, err);
          throw err;
        }
        await sleep(jitteredDelay(i, err.retryAfterMs));
      }
    }
    // Unreachable (the loop above always returns or throws), kept for type-narrowing.
    throw lastErr;
  } finally {
    // Last-resort safety net: onSuccess/onFailure above are the normal way `probing` clears, but
    // this guarantees it even if `attempt` does something exotic (hangs past its own abort, or
    // throws from outside the try, e.g. a synchronous error before the first await). A half-open
    // breaker that never clears `probing` would reject every future call forever.
    r.probing = false;
  }
}

/**
 * Breaker-only variant of withResilience, for callers whose `fn` already retries internally
 * (the shared TCGdex client backs off on its own). Still participates in the same per-name
 * breaker and health record, just without compounding another layer of retries on top.
 */
export async function withBreaker<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const r = rec(name);
  if (!mayAttempt(r)) throw new BreakerOpenError(name);
  try {
    const result = await fn();
    onSuccess(r);
    return result;
  } catch (err) {
    onFailure(r, err);
    throw err;
  } finally {
    // See withResilience's matching comment: belt-and-braces so a half-open probe that exits
    // unexpectedly can never leave the breaker stuck.
    r.probing = false;
  }
}

/** Parses a Retry-After header (seconds, or an HTTP-date) into milliseconds from now. */
export function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}
