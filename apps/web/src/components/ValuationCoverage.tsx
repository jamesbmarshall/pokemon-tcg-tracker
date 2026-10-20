import { valuationCoverage } from '@poketracker/shared/valuation';
import { useCollectionStore } from '../store/collectionStore';
export default function ValuationCoverage() {
  const { entries, cards, graded, sealed } = useCollectionStore();
  const coverage = valuationCoverage(entries.values(), cards, graded.values(), sealed.values());
  return <div className="mt-3 space-y-1 text-xs text-muted" aria-label="Valuation coverage">
    <p>{coverage.pricedUnits} of {coverage.totalUnits} held copies priced · {coverage.unpricedUnits} unpriced · {coverage.estimatedUnits} estimates · {coverage.manualUnits} owner valuations</p>
    <p>{coverage.staleUnits} quotes older than 48 hours · {coverage.unknownFreshnessUnits} without a verified source date</p>
    <p>Unpriced items are excluded from totals. Raw-card fallback prices for slabs are estimates. Market quotes do not account for your card’s condition, selling fees or liquidity. Currency conversions use current rates; changes in the chart are not investment returns.</p>
  </div>;
}
