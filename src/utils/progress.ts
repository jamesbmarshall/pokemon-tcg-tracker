import type { CollectionEntry, PokemonCard } from '../api/types';
import { cardVariants } from '../api/client';

export interface SetProgress {
  base: { owned: number; total: number };
  full: { owned: number; total: number };
  master: { owned: number; total: number };
}

const isNumeric = (n: string) => /^\d+$/.test(n);

/** Part of the numbered set (1 to printed total), i.e. not a secret rare. */
export const isBaseCard = (c: Pick<PokemonCard, 'number' | 'set'>) => isNumeric(c.number) && Number(c.number) <= c.set.printedTotal;

/** Base = numbered cards up to printed total; Full = every card; Master = every variant of every card. */
export function setProgress(cards: PokemonCard[], byCard: Map<string, Record<string, number>>): SetProgress {
  const p: SetProgress = { base: { owned: 0, total: 0 }, full: { owned: 0, total: 0 }, master: { owned: 0, total: 0 } };
  for (const c of cards) {
    const owned = byCard.get(c.id);
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

/** Quick per-set summary from the collection alone (no card list needed). */
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
