/**
 * Web entry point to the shared TCGdex catalogue client.
 *
 * Re-exports @poketracker/shared/catalog and wires it to the browser: FX rates come from the
 * local rate cache, and after configureForServer() all catalogue and image traffic goes via the
 * PokéTracker server rather than straight to TCGdex. That keeps the CSP tight and lets the
 * server cache upstream responses for every user.
 */
import { configureCatalog } from '@poketracker/shared/catalog';
import { currentRates } from '../utils/fx';
import { api, API_HEADERS } from './http';
import type { CardSnapshot } from './types';

// Runs at import time so any price conversion done by the catalogue uses live rates.
configureCatalog({ eurPerUsd: () => currentRates().EUR });

export * from '@poketracker/shared/catalog';

/**
 * Resolves a scanned set code + collector number (or number + printed total) to candidate
 * cards, via the server's GET /api/cards/lookup. The server, not the browser, talks to TCGdex.
 */
export async function lookupScan(query: { setCode?: string; number: string; total?: string }): Promise<CardSnapshot[]> {
  const params = new URLSearchParams({ number: query.number });
  if (query.setCode) params.set('set', query.setCode);
  if (query.total) params.set('total', query.total);
  const { candidates } = await api<{ candidates: CardSnapshot[] }>(`/api/cards/lookup?${params}`);
  return candidates;
}

// Mirrors the server's image allow-list: /api/img rejects any other host, so other URLs are
// passed through unchanged (and the CSP decides whether they load).
const PROXIED_HOSTS = new Set(['assets.tcgdex.net', 'images.pokemontcg.io']);
let proxyImages = false;

/** Card art and set logos are served (and cached) by the app server, which the CSP requires. */
export function imageSrc(url: string): string;
export function imageSrc(url: string | undefined): string | undefined;
export function imageSrc(url: string | undefined) {
  if (!url || !proxyImages) return url;
  try {
    const u = new URL(url);
    // Only https is proxied, matching the server's check.
    return u.protocol === 'https:' && PROXIED_HOSTS.has(u.hostname) ? `/api/img?u=${encodeURIComponent(url)}` : url;
  } catch {
    // Relative or malformed URLs are left alone rather than breaking the image.
    return url;
  }
}

/** Routes the catalogue and images through the PokéTracker server. Called once at start-up. */
export function configureForServer() {
  configureCatalog({ base: '/api/tcgdex/v2', headers: () => ({ ...API_HEADERS }) });
  proxyImages = true;
}

/** Test helper: undo configureForServer(). */
export function resetServerConfig() {
  configureCatalog({ base: 'https://api.tcgdex.net/v2', headers: () => ({}) });
  proxyImages = false;
}
