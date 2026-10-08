/**
 * Collection valuation rules, shared so the server (nightly value history) and the web app
 * (live totals) always agree on the numbers.
 *
 * Every amount is computed in USD, the currency the market prices come in. Rates map a currency
 * to units per 1 USD; conversion to the user's display currency happens only at render time.
 */
import type { CardSnapshot, CollectionEntry, GradedCopy, Paid, SealedItem, ValuePoint } from './types';

export type Currency = 'GBP' | 'EUR' | 'USD';
export type Rates = Record<Currency, number>;
export const FALLBACK_RATES: Rates = { USD: 1, GBP: 0.76, EUR: 0.89 };
export const CURRENCIES: readonly Currency[] = ['GBP', 'USD', 'EUR'];
export const GRADING_COMPANIES = new Set(['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'Other']);
/** Maximum note length. The server truncates to it; the web form limits input to match. */
export const NOTE_MAX = 500;

/** Deterministic collection entry id: one entry per card printing. Changing it would orphan stored entries. */
export const entryKey = (cardId: string, variant: string) => `${cardId}::${variant}`;
export const gradeRank = (grade: string) => (Number.isFinite(Number(grade)) ? Number(grade) : -1);

/** Local-date key (YYYY-MM-DD) for value history, so one point is recorded per calendar day. */
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Converts an amount the user paid (in whatever currency they entered it) into USD. */
export function paidUsd(paid: Paid | undefined, rates: Rates): number | undefined {
  if (!paid) return undefined;
  const r = rates[paid.currency];
  return r ? paid.amount / r : undefined;
}

export function isPaid(v: unknown): v is Paid {
  const p = v as Paid;
  return !!p && typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0 && CURRENCIES.includes(p.currency);
}

/**
 * Market price for a printing. Falls back to any price the card has, since a missing variant price
 * (common for reverse holos) is closer to the card's other price than to zero.
 */
export function priceOf(card: CardSnapshot | undefined, variant: string) {
  if (!card) return undefined;
  return card.prices[variant] ?? Object.values(card.prices)[0];
}

/** A slab is worth the owner's valuation, else its linked PriceCharting graded price, else the raw market price. */
export function gradedValue(g: GradedCopy, cards: Map<string, CardSnapshot>) {
  return g.valueUsd ?? g.pcPrice ?? priceOf(cards.get(g.cardId), g.variant) ?? 0;
}

/** A raw entry is worth the owner's per-copy valuation, else the market price of its printing. */
export function entryValue(e: CollectionEntry, cards: Map<string, CardSnapshot>): number | undefined {
  return e.valueUsd ?? priceOf(cards.get(e.cardId), e.variant);
}

/**
 * A sealed item is worth the owner's valuation, else its linked PriceCharting price times how
 * many copies are held. Opened items are worth nothing: they no longer count towards value, only
 * towards history.
 */
export function sealedValue(s: SealedItem): number {
  if (s.status === 'opened') return 0;
  return s.valueUsd ?? (s.pcPrice != null ? s.pcPrice * s.quantity : 0);
}

/**
 * Total market value and copy counts. Raw copies with no known price add to the count but not
 * the value. Sealed items add to value only (unopened ones), not to the card/unique counts,
 * since they aren't individual cards.
 */
export function computeValue(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy> = [], sealed: Iterable<SealedItem> = []) {
  let valueUsd = 0;
  let count = 0;
  const unique = new Set<string>();
  for (const e of entries) {
    count += e.quantity;
    unique.add(e.cardId);
    const price = entryValue(e, cards);
    if (price) valueUsd += price * e.quantity;
  }
  for (const g of graded) {
    count++;
    unique.add(g.cardId);
    valueUsd += gradedValue(g, cards);
  }
  for (const s of sealed) valueUsd += sealedValue(s);
  return { valueUsd, count, unique: unique.size };
}

export interface CostBasis {
  /** What was paid (USD at the given rates) for copies with a recorded price */
  costUsd: number;
  /** Today's market value of those same copies */
  valueUsd: number;
  /** Copies with a recorded price */
  costed: number;
}

/** Cost basis vs. market value, counting only copies whose purchase price is known. */
export function costBasis(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy>, rates: Rates, sealed: Iterable<SealedItem> = []): CostBasis {
  const out = { costUsd: 0, valueUsd: 0, costed: 0 };
  for (const e of entries) {
    const each = paidUsd(e.paid, rates);
    if (each == null) continue;
    out.costUsd += each * e.quantity;
    out.valueUsd += (entryValue(e, cards) ?? 0) * e.quantity;
    out.costed += e.quantity;
  }
  for (const g of graded) {
    const cost = paidUsd(g.paid, rates);
    if (cost == null) continue;
    out.costUsd += cost;
    out.valueUsd += gradedValue(g, cards);
    out.costed++;
  }
  for (const s of sealed) {
    if (s.status === 'opened') continue;
    const cost = paidUsd(s.paid, rates);
    if (cost == null) continue;
    out.costUsd += cost;
    out.valueUsd += sealedValue(s);
    out.costed++;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Today's value point for a collection; undefined when there's nothing to record. */
export function valuePoint(
  entries: Iterable<CollectionEntry>,
  cards: Map<string, CardSnapshot>,
  graded: Iterable<GradedCopy>,
  rates: Rates,
  hasHistory: boolean,
  sealed: Iterable<SealedItem> = [],
  date = todayKey(),
): ValuePoint | undefined {
  const e = Array.from(entries);
  const g = Array.from(graded);
  const s = Array.from(sealed);
  const { valueUsd, count, unique } = computeValue(e, cards, g, s);
  // An empty collection with no history has nothing to chart. With history, a zero point is real
  // information (the user sold or removed everything) and is recorded.
  if (count === 0 && !s.length && !hasHistory) return undefined;
  const point: ValuePoint = { date, valueUsd: round2(valueUsd), cards: count, unique };
  const cost = costBasis(e, cards, g, rates, s);
  if (cost.costed) Object.assign(point, { costUsd: round2(cost.costUsd), costedValueUsd: round2(cost.valueUsd) });
  return point;
}
