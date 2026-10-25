import { setProgress } from '../completion';
import type { PokemonCard } from '../types';
import { catalogCompletion } from './collection';
import type { CompletionMeasure, CompletionReport, Holding, Slab, TcgCard } from './types';

function measure(key: string, label: string, counts: { owned: number; total: number }): CompletionMeasure {
  return { key, label, ...counts, complete: counts.total > 0 && counts.owned === counts.total };
}

/** Same inputs and policy as the legacy Pokémon checklist. The caller scopes the
 * catalogue by language and includes eligible graded copies in the ownership index.
 * No policy inference or variant reclassification happens in this projection.
 */
export function pokemonCompletionReport(
  cards: PokemonCard[],
  byCard: Map<string, Record<string, number>>,
  catalogueComplete: boolean,
): CompletionReport {
  const progress = setProgress(cards, byCard);
  return {
    measures: [
      measure('base', 'Base', progress.base),
      measure('full', 'Full', progress.full),
      measure('master', 'Master', progress.master),
      measure('all', 'All printings', progress.all),
    ],
    coverage: {
      complete: catalogueComplete && progress.coverageComplete,
      provisional: progress.provisional,
      unresolved: progress.unresolved,
      additional: progress.additional,
    },
  };
}

/** Preserve the existing generic catalogue policy, including graded participation.
 * Unknown eligibility counts are omitted rather than invented as zero.
 */
export function catalogCompletionReport(
  cards: TcgCard[],
  holdings: Holding[],
  slabs: Slab[],
  catalogueComplete: boolean,
): CompletionReport {
  const progress = catalogCompletion(cards, holdings, slabs, catalogueComplete);
  return {
    measures: [
      measure('cards', 'Distinct cards', progress.cards),
      measure('printings', 'Printings', progress.printings),
      measure('finishes', 'Finishes', progress.finishes),
    ],
    coverage: { complete: progress.complete },
  };
}
