/** Thin fetch wrapper for the PokéTracker server API. */

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

/** Every request carries this header; the server rejects state-changing requests without it (CSRF). */
export const API_HEADERS = { 'x-poketracker': '1' } as const;

export interface ApiInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Don't broadcast a 401 (e.g. the sign-in form handles it itself). */
  quiet401?: boolean;
}

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
