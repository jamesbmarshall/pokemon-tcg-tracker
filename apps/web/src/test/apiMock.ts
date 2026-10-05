import { vi } from 'vitest';

type Reply = unknown | { status: number; body?: unknown } | Error;
type Handler = (body: unknown, url: URL) => Reply | Promise<Reply>;

export class HttpReply {
  readonly status: number;
  readonly body?: unknown;
  constructor(status: number, body?: unknown) {
    this.status = status;
    this.body = body;
  }
}

/** An error response, e.g. `reply(401, { error: 'Wrong username or password' })`. */
export const reply = (status: number, body?: unknown) => new HttpReply(status, body);

/**
 * Stubs fetch with a route table keyed by "METHOD /path" (query string ignored).
 * Handlers return a JSON body, a `reply(status, body)`, or throw/return an Error for a network failure.
 * Unknown routes fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler | Reply>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path: url.pathname, body });
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) throw new Error(`Unmocked API call: ${key}`);
    const route = routes[key];
    const out = typeof route === 'function' ? await (route as Handler)(body, url) : route;
    if (out instanceof Error) throw out;
    const { status, body: payload } = out instanceof HttpReply ? out : { status: 200, body: out };
    return new Response(payload === undefined ? '' : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetch: fetchMock,
    /** Requests made to "METHOD /path". */
    called: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
    set: (key: string, handler: Handler | Reply) => void (routes[key] = handler),
  };
}
