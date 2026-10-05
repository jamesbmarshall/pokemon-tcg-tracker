/**
 * Set completion maths. Three levels, chosen in settings:
 * - base: numbered cards up to the printed total (what the set "officially" contains)
 * - full: every card, including secret rares numbered past the printed total
 * - master: every variant (normal, reverse holo, etc.) of every card
 *
 * At base and full level a card counts as owned if any variant is held. Callers usually pass
 * `holdings`, so graded copies marked "counts towards set" are included.
 */
import type { CollectionEntry, PokemonCard } from '../api/types';
import { cardVariants } from '../api/client';

export interface SetProgress {
  base: { owned: number; total: number };
  full: { owned: number; total: number };
  master: { owned: number; total: number };
}

// Non-numeric numbers (TG01, SV001, promo codes) are always outside the base set.
const isNumeric = (n: string) => /^\d+$/.test(n);

/** Part of the numbered set (1 to printed total), i.e. not a secret rare. */
export const isBaseCard = (c: Pick<PokemonCard, 'number' | 'set'>) => isNumeric(c.number) && Number(c.number) <= c.set.printedTotal;

/** Base = numbered cards up to printed total; Full = every card; Master = every variant of every card. */
export function setProgress(cards: PokemonCard[], byCard: Map<string, Record<string, number>>): SetProgress {
  const p: SetProgress = { base: { owned: 0, total: 0 }, full: { owned: 0, total: 0 }, master: { owned: 0, total: 0 } };
  for (const c of cards) {
    const owned = byCard.get(c.id);
    // Entries are deleted at zero rather than stored, so any key means at least one copy.
    const has = !!owned && Object.keys(owned).length > 0;
    const inBase = isBaseCard(c);
    p.full.total++;
    if (has) p.full.owned++;
    if (inBase) {
      p.base.total++;
      if (has) p.base.owned++;
    }
    for (const v of cardVariants(c)) {
      p.master.total++;
      if (owned?.[v]) p.master.owned++;
    }
  }
  return p;
}

/**
 * Quick per-set summary from the collection alone (no card list needed). `slots` counts distinct
 * card+variant entries; `copies` sums their quantities.
 */
export function ownedBySet(entries: Iterable<CollectionEntry>) {
  const out = new Map<string, { cards: Set<string>; slots: number; copies: number }>();
  for (const e of entries) {
    const s = out.get(e.setId) ?? { cards: new Set(), slots: 0, copies: 0 };
    s.cards.add(e.cardId);
    s.slots++;
    s.copies += e.quantity;
    out.set(e.setId, s);
  }
  return out;
}
