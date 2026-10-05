import { vi } from 'vitest';

export type Route = {
  /** Substring of the URL, or of the GraphQL query for POSTs to /graphql. */
  match: string | RegExp;
  method?: 'GET' | 'POST';
  status?: number;
  body?: unknown;
  /** Build the body from the request (e.g. to echo GraphQL aliases). */
  reply?: (req: { url: string; query?: string }) => unknown;
  /** Throw a network error instead of responding. */
  networkError?: boolean;
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Installs a fetch stub that answers from the route table; unmatched calls 404. */
export function mockFetch(routes: Route[]) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const query = init?.body ? (JSON.parse(String(init.body)).query as string) : undefined;
    const haystack = query ?? url;
    const route = routes.find(
      (r) => (!r.method || r.method === method) && (typeof r.match === 'string' ? haystack.includes(r.match) : r.match.test(haystack)),
    );
    if (!route) return json({ error: 'not found' }, 404);
    if (route.networkError) throw new TypeError('Failed to fetch');
    const body = route.reply ? route.reply({ url, query }) : route.body;
    if (body instanceof Response) return body;
    return json(body ?? {}, route.status ?? 200);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Parses `cN: card(id: "x")` aliases out of a batched GraphQL query. */
export function aliasesIn(query: string): [string, string][] {
  return [...query.matchAll(/(c\d+): card\(id: "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
}
