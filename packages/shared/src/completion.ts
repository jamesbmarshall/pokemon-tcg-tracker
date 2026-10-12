import type { PokemonCard } from './types';
import { cardVariants } from './catalog';
import { standardVariants } from './printings';

export interface SetProgress {
  base: { owned: number; total: number };
  full: { owned: number; total: number };
  master: { owned: number; total: number };
  all: { owned: number; total: number };
  provisional: boolean;
}

/** Prefixes identify a numbering series; they do not make a card secret. */
export function isWithinPrintedTotal(number: string, printedTotal: number): boolean {
  const match = /^(?:[a-z]+)?(\d+)$/i.exec(number);
  return !!match && Number(match[1]) >= 1 && Number(match[1]) <= printedTotal;
}

/** Part of the numbered set (1 to printed total), i.e. not a secret rare. */
export const isBaseCard = (c: Pick<PokemonCard, 'number' | 'set'>) => isWithinPrintedTotal(c.number, c.set.printedTotal);

/** Base = numbered cards up to printed total; Full = every card; Master = standard expansion printings; All = every collectible printing. */
export function setProgress(cards: PokemonCard[], byCard: Map<string, Record<string, number>>): SetProgress {
  const p: SetProgress = { base: { owned: 0, total: 0 }, full: { owned: 0, total: 0 }, master: { owned: 0, total: 0 }, all: { owned: 0, total: 0 }, provisional: false };
  for (const c of cards) {
    const owned = byCard.get(c.id);
    // Entries are deleted at zero rather than stored, so any key means at least one copy.
    const eligible = new Set(standardVariants(c));
    const has = !!owned && Object.keys(owned).some((v) => (!c.printings?.length || eligible.has(v)) && owned[v] > 0);
    if (!c.printings?.length || c.printings.some((p) => p.status !== 'verified')) p.provisional = true;
    const inBase = isBaseCard(c);
    p.full.total++;
    if (has) p.full.owned++;
    if (inBase) {
      p.base.total++;
      if (has) p.base.owned++;
    }
    for (const v of cardVariants(c)) {
      p.all.total++;
      if (owned?.[v]) p.all.owned++;
      if (eligible.has(v)) {
        p.master.total++;
        if (owned?.[v]) p.master.owned++;
      }
    }
  }
  return p;
}

