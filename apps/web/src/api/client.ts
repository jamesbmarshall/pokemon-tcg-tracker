import { configureCatalog } from '@poketracker/shared/catalog';
import { currentRates } from '../utils/fx';
import { API_HEADERS } from './http';

configureCatalog({ eurPerUsd: () => currentRates().EUR });

export * from '@poketracker/shared/catalog';

const PROXIED_HOSTS = new Set(['assets.tcgdex.net', 'images.pokemontcg.io']);
let proxyImages = false;

/** Card art and set logos are served (and cached) by the app server, which the CSP requires. */
export function imageSrc(url: string): string;
export function imageSrc(url: string | undefined): string | undefined;
export function imageSrc(url: string | undefined) {
  if (!url || !proxyImages) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PROXIED_HOSTS.has(u.hostname) ? `/api/img?u=${encodeURIComponent(url)}` : url;
  } catch {
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
