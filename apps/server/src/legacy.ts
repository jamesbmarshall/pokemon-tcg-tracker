import { isLegacyId, migrateVariant, resolveLegacyIds } from '@poketracker/shared/migrate';
import type { Ctx } from './context.ts';

type Remap = (raw: unknown) => unknown;

/**
 * Old backups (pokemontcg.io era) use different card ids and variant keys. Builds a
 * function that rewrites a raw imported record onto TCGdex ids. Only legacy-looking
 * set prefixes trigger network lookups, so modern exports import without any.
 */
export async function migrateImport(ctx: Ctx, entries: unknown[], wishlist: unknown[]): Promise<{ remap: Remap; readonly remapped: number }> {
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const r of [...entries, ...wishlist]) {
    const o = r as { cardId?: unknown; name?: unknown };
    if (typeof o?.cardId === 'string' && isLegacyId(o.cardId)) {
      ids.add(o.cardId);
      if (typeof o.name === 'string') names.set(o.cardId, o.name);
    }
  }
  let map = new Map<string, string>();
  if (ids.size) {
    try {
      ({ map } = await resolveLegacyIds([...ids], names));
    } catch (err) {
      ctx.log.warn({ err }, 'legacy id resolution failed');
    }
  }
  let remapped = 0;
  const remap: Remap = (raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const o = raw as { cardId?: unknown; variant?: unknown };
    const cardId = typeof o.cardId === 'string' ? (map.get(o.cardId) ?? o.cardId) : o.cardId;
    const variant = typeof o.variant === 'string' ? migrateVariant(o.variant) : o.variant;
    if (cardId === o.cardId && variant === o.variant) return raw;
    remapped++;
    return { ...o, cardId, variant };
  };
  return {
    remap,
    /** Live count: grows as records pass through remap(). */
    get remapped() {
      return remapped;
    },
  };
}
