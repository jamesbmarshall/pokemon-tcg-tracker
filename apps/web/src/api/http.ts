/**
 * Thin fetch wrapper for the PokéTracker server API.
 *
 * Authentication is a same-origin session cookie, so there is no token handling here. What this
 * module does own: the CSRF header, JSON encoding, turning failures into ApiError, and
 * broadcasting 401s so the app can drop back to the sign-in page from anywhere.
 */

/**
 * Error thrown for every failed request. `status` is 0 for network failures, so callers can tell
 * "server unreachable" apart from an HTTP error. `code` is the server's machine-readable reason.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly data?: unknown;
  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();

/** Called whenever the server says the session is gone, so the app can show the sign-in page. */
export function onUnauthenticated(fn: Listener) {
  unauthListeners.add(fn);
  return () => void unauthListeners.delete(fn);
}

/**
 * Every request carries this header; the server rejects state-changing requests without it (CSRF).
 * A cross-site form or image request cannot set custom headers, and a cross-site fetch that does
 * would need a CORS preflight the server never approves. It is also sent to the catalogue proxy.
 */
export const API_HEADERS = { 'x-poketracker': '1' } as const;

export interface ApiInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Don't broadcast a 401 (e.g. the sign-in form handles it itself). */
  quiet401?: boolean;
}

/**
 * Calls a server endpoint and returns the parsed JSON body.
 *
 * A plain object `body` is JSON-encoded; FormData is passed through so the browser sets the
 * multipart boundary itself. A 401 notifies onUnauthenticated() listeners before throwing, so
 * an expired session sends the user to sign-in even if the caller swallows the error.
 */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { body, quiet401, headers, ...rest } = init;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        ...API_HEADERS,
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the PokéTracker server. Check your connection.", 'network');
  }
  // Read as text first: some endpoints return an empty body (204) or plain text errors from a
  // proxy in front of the server, and res.json() would throw on both.
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; code?: string };
    if (res.status === 401 && !quiet401) unauthListeners.forEach((fn) => fn());
    throw new ApiError(res.status, err.message ?? err.error ?? `Request failed (${res.status})`, err.code, data);
  }
  return data as T;
}
