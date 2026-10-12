import type { CollectionEntry } from '../api/types';
export { setProgress, isBaseCard, isWithinPrintedTotal } from '@poketracker/shared/completion';
export type { SetProgress } from '@poketracker/shared/completion';

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
