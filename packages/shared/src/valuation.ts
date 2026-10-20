/** Price coverage is independent of value: a quoted zero is known; a missing quote is not. */
import type { CardSnapshot, CollectionEntry, GradedCopy, SealedItem } from './types';
import { priceOf } from './value';
export interface Quote { amount?: number; source: 'manual' | 'catalogue' | 'PriceCharting' | 'unknown'; estimated: boolean; updatedAt?: string }
export function rawQuote(card: CardSnapshot | undefined, variant: string): Quote {
  const amount = priceOf(card, variant);
  const dates = [card?.tcgplayerUpdatedAt, card?.cardmarketUpdatedAt, card?.pricechartingUpdatedAt].filter((v): v is string => !!v && Number.isFinite(Date.parse(v))).sort();
  return { amount, source: amount == null ? 'unknown' : 'catalogue', estimated: amount != null && card?.prices[variant] == null, updatedAt: dates[0] };
}
export function gradedQuote(g: GradedCopy, cards: Map<string, CardSnapshot>): Quote {
  if (g.valueUsd != null) return { amount: g.valueUsd, source: 'manual', estimated: false };
  if (g.pcPrice != null) return { amount: g.pcPrice, source: 'PriceCharting', estimated: false, updatedAt: g.pcUpdatedAt };
  return { ...rawQuote(cards.get(g.cardId), g.variant), estimated: true };
}
export function valuationCoverage(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy> = [], sealed: Iterable<SealedItem> = [], now = Date.now()) {
  const out = { totalUnits: 0, pricedUnits: 0, unpricedUnits: 0, estimatedUnits: 0, staleUnits: 0, unknownFreshnessUnits: 0, manualUnits: 0 };
  function add(q: Quote, quantity: number) {
    out.totalUnits += quantity;
    if (q.amount == null) { out.unpricedUnits += quantity; return; }
    out.pricedUnits += quantity;
    if (q.estimated) out.estimatedUnits += quantity;
    if (q.source === 'manual') { out.manualUnits += quantity; return; }
    const timestamp = Date.parse(q.updatedAt ?? '');
    if (!Number.isFinite(timestamp) || timestamp > now + 300_000) out.unknownFreshnessUnits += quantity;
    else if (now - timestamp > 48 * 3_600_000) out.staleUnits += quantity;
  }
  for (const e of entries) add(e.valueUsd != null ? { amount: e.valueUsd, source: 'manual', estimated: false } : rawQuote(cards.get(e.cardId), e.variant), e.quantity);
  for (const g of graded) add(gradedQuote(g, cards), 1);
  for (const s of sealed) if (s.status !== 'opened') add({ amount: s.valueUsd ?? s.pcPrice, source: s.valueUsd != null ? 'manual' : s.pcPrice != null ? 'PriceCharting' : 'unknown', estimated: false, updatedAt: s.pcUpdatedAt }, s.quantity);
  return out;
}
