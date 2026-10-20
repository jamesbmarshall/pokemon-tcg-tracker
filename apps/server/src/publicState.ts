import type { StateOptions, readLists } from './collections.ts';
import type { CollectionEntry, GradedCopy, SealedItem, WishlistEntry, CardNote, ValuePoint, CardSnapshot, SetStat } from '@poketracker/shared/types';
type PublicInput = { entries: CollectionEntry[]; graded: GradedCopy[]; sealed: SealedItem[]; wishlist: WishlistEntry[]; notes: CardNote[]; history: ValuePoint[]; cards: CardSnapshot[]; lists: ReturnType<typeof readLists>; setStats: SetStat[] };

// Runtime allow-lists: extending an internal type must never silently extend a public share.
function allow<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as T;
}

export function publicState(state: PublicInput, opts: StateOptions) {
  const paid = <T extends { paid?: { amount: number; currency: string } }>(item: T): T => {
    if (opts.hidePaid) delete item.paid;
    else if (item.paid) item.paid = allow(item.paid, ['amount', 'currency']);
    return item;
  };
  return {
    entries: state.entries.map((item) => paid(allow(item, ['id', 'cardId', 'setId', 'variant', 'quantity', 'condition', 'addedAt', 'updatedAt', ...(!opts.hideNotes ? ['notes'] as const : []), ...(!opts.hidePaid ? ['paid'] as const : []), ...(!opts.hideValue ? ['valueUsd'] as const : [])]))),
    graded: state.graded.map((item) => {
      const result = paid(allow(item, ['id', 'cardId', 'setId', 'variant', 'company', 'companyName', 'grade', 'label', 'certNumber', 'subgrades', 'countsTowardSet', 'addedAt', 'updatedAt', ...(!opts.hideNotes ? ['notes'] as const : []), ...(!opts.hidePaid ? ['paid'] as const : []), ...(!opts.hideValue ? ['valueUsd', 'pcPrice', 'pcProductId', 'pcUpdatedAt'] as const : [])]));
      if (result.subgrades) result.subgrades = allow(result.subgrades, ['centering', 'corners', 'edges', 'surface']);
      return result;
    }),
    sealed: state.sealed.map((item) => paid(allow(item, ['id', 'name', 'productType', 'setId', 'language', 'quantity', 'status', 'openedAt', 'addedAt', 'updatedAt', ...(!opts.hideNotes ? ['notes'] as const : []), ...(!opts.hidePaid ? ['paid'] as const : []), ...(!opts.hideValue ? ['valueUsd', 'pcPrice', 'pcProductId', 'pcUpdatedAt'] as const : [])]))),
    wishlist: state.wishlist.map((item) => allow(item, ['cardId', 'addedAt'])),
    notes: opts.hideNotes ? [] : state.notes.map((item) => allow(item, ['cardId', 'text', 'updatedAt'])),
    lists: state.lists.map((item) => allow(item, ['id', 'name', 'kind', 'format', 'createdAt', 'updatedAt', 'cards', 'cardQtys', ...(!opts.hideNotes ? ['description'] as const : [])])),
    history: opts.hideValue ? [] : state.history.map((item) => allow(item, ['date', 'valueUsd', 'cards', 'unique', ...(!opts.hidePaid ? ['costUsd', 'costedValueUsd'] as const : [])])),
    cards: state.cards.map((item) => {
      const result = allow(item, ['id', 'name', 'number', 'setId', 'setName', 'series', 'releaseDate', 'printedTotal', 'setCode', 'rarity', 'supertype', 'subtypes', 'types', 'artist', 'image', 'imageLarge', 'variants', 'printings', 'printingVersion', 'printingContext', 'printingProfile', 'printingCoverage', 'pricingComplete', 'regulationMark', 'legal', 'syncedAt', ...(!opts.hideValue ? ['prices', 'tcgplayerUrl', 'cardmarketUrl', 'tcgplayerUpdatedAt', 'cardmarketUpdatedAt', 'pricechartingUpdatedAt'] as const : [])]);
      if (opts.hideValue) result.prices = {};
      // Only display/checklist properties are needed publicly; raw provider objects stay private.
      result.printings = result.printings?.map((p) => allow(p, ['id', 'label', 'finish', 'size', 'stamp', 'edition', 'distribution', 'status', 'role', 'dataQuality', 'legacyAliases']));
      if (result.printingContext) result.printingContext = allow(result.printingContext, ['setId', 'language', 'rarity', 'category', 'mechanic']);
      if (result.legal) result.legal = allow(result.legal, ['standard', 'expanded']);
      return result;
    }),
    setStats: state.setStats.map((item) => allow(item, ['setId', 'masterTotal', 'allTotal', 'provisional', 'unresolvedTotal', 'additionalTotal', 'profile', 'printingVersion', 'syncedAt'])),
  };
}
