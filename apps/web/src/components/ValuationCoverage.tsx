import { valuationCoverage } from '@poketracker/shared/valuation';
import { useCollectionStore } from '../store/collectionStore';

/**
 * How much of the total rests on real prices. One line by default, so the cards stay near the top
 * of the page on a phone; the breakdown and caveats sit behind a disclosure.
 */
export default function ValuationCoverage() {
  const { entries, cards, graded, sealed } = useCollectionStore();
  const coverage = valuationCoverage(entries.values(), cards, graded.values(), sealed.values());
  return (
    <details className="mt-3 text-xs text-muted" aria-label="Valuation coverage">
      <summary className="w-fit cursor-pointer hover:text-fg">
        {coverage.pricedUnits.toLocaleString('en-GB')} of {coverage.totalUnits.toLocaleString('en-GB')} copies priced
        {coverage.unpricedUnits > 0 && ' · unpriced copies aren’t counted'}
      </summary>
      <div className="mt-2 max-w-2xl space-y-1">
        <p>{coverage.pricedUnits} of {coverage.totalUnits} held copies priced · {coverage.unpricedUnits} unpriced · {coverage.estimatedUnits} estimates · {coverage.manualUnits} owner valuations</p>
        <p>{coverage.staleUnits} quotes older than 48 hours · {coverage.unknownFreshnessUnits} without a verified source date</p>
        <p>Unpriced items are excluded from totals. Raw-card fallback prices for slabs are estimates. Market quotes do not account for your card’s condition, selling fees or liquidity. Currency conversions use current rates; changes in the chart are not investment returns.</p>
      </div>
    </details>
  );
}
