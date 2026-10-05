/**
 * Translates data from the pokemontcg.io era (card ids and variant names) to TCGdex. Used when
 * importing old backups, which may predate the switch of catalogue provider.
 */
import { getSetCards, setIdFromCardId } from './catalog';
import { LEGACY_SET_MAP } from './legacySets';

/** pokemontcg.io split base-era unlimited printings into their own keys; TCGdex treats them as the default. */
const LEGACY_VARIANTS: Record<string, string> = { unlimited: 'normal', unlimitedHolofoil: 'holofoil' };
export const migrateVariant = (v: string) => LEGACY_VARIANTS[v] ?? v;

/** "006" ≡ "6", "SV001" ≡ "SV1", "TG01" ≡ "TG1" */
function normNumber(n: string) {
  const m = /^([A-Z]*?)0*(\d+)([A-Z]*)$/i.exec(n);
  return m ? `${m[1].toUpperCase()}${Number(m[2])}${m[3].toUpperCase()}` : n.toUpperCase();
}

/** True when the id's set prefix is a pokemontcg.io set code that TCGdex names differently. */
export const isLegacyId = (id: string) => {
  const set = setIdFromCardId(id);
  return set in LEGACY_SET_MAP && LEGACY_SET_MAP[set] !== set;
};

/**
 * Maps card ids from the old pokemontcg.io catalogue (e.g. "sv3pt5-6") to TCGdex ids
 * ("sv03.5-006"). Ids that already exist on TCGdex map to themselves. Sets that fail to
 * load are reported so the migration can be retried later.
 */
export async function resolveLegacyIds(ids: string[], names: Map<string, string>) {
  const bySet = new Map<string, string[]>();
  for (const id of ids) {
    const set = setIdFromCardId(id);
    bySet.set(set, [...(bySet.get(set) ?? []), id]);
  }

  const map = new Map<string, string>();
  let failedSets = 0;
  for (const [legacySet, cardIds] of bySet) {
    const target = LEGACY_SET_MAP[legacySet] ?? legacySet;
    let cards: { id: string; number: string; name: string }[];
    try {
      cards = await getSetCards(target);
    } catch {
      failedSets++;
      continue;
    }
    const exact = new Set(cards.map((c) => c.id));
    for (const oldId of cardIds) {
      if (exact.has(oldId)) {
        map.set(oldId, oldId);
        continue;
      }
      // No exact id: match on card number, using the name to choose between duplicates (some
      // sets reuse a number for different cards), else take the first hit.
      const wanted = normNumber(oldId.slice(legacySet.length + 1));
      const hits = cards.filter((c) => normNumber(c.number) === wanted);
      const name = names.get(oldId)?.toLowerCase();
      const hit = hits.find((c) => c.name.toLowerCase() === name) ?? hits[0];
      if (hit) map.set(oldId, hit.id);
    }
  }
  return { map, failedSets };
}
