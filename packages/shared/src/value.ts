import type { CardSnapshot, CollectionEntry, GradedCopy, Paid, ValuePoint } from './types';

export type Currency = 'GBP' | 'EUR' | 'USD';
export type Rates = Record<Currency, number>;
export const FALLBACK_RATES: Rates = { USD: 1, GBP: 0.76, EUR: 0.89 };
export const CURRENCIES: readonly Currency[] = ['GBP', 'USD', 'EUR'];
export const GRADING_COMPANIES = new Set(['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'Other']);
export const NOTE_MAX = 500;

export const entryKey = (cardId: string, variant: string) => `${cardId}::${variant}`;
export const gradeRank = (grade: string) => (Number.isFinite(Number(grade)) ? Number(grade) : -1);

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

export function priceOf(card: CardSnapshot | undefined, variant: string) {
  if (!card) return undefined;
  return card.prices[variant] ?? Object.values(card.prices)[0];
}

/** A slab is worth the owner's valuation, else the raw market price of its printing. */
export function gradedValue(g: GradedCopy, cards: Map<string, CardSnapshot>) {
  return g.valueUsd ?? priceOf(cards.get(g.cardId), g.variant) ?? 0;
}

export function computeValue(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy> = []) {
  let valueUsd = 0;
  let count = 0;
  const unique = new Set<string>();
  for (const e of entries) {
    count += e.quantity;
    unique.add(e.cardId);
    const price = priceOf(cards.get(e.cardId), e.variant);
    if (price) valueUsd += price * e.quantity;
  }
  for (const g of graded) {
    count++;
    unique.add(g.cardId);
    valueUsd += gradedValue(g, cards);
  }
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
export function costBasis(entries: Iterable<CollectionEntry>, cards: Map<string, CardSnapshot>, graded: Iterable<GradedCopy>, rates: Rates): CostBasis {
  const out = { costUsd: 0, valueUsd: 0, costed: 0 };
  for (const e of entries) {
    const each = paidUsd(e.paid, rates);
    if (each == null) continue;
    out.costUsd += each * e.quantity;
    out.valueUsd += (priceOf(cards.get(e.cardId), e.variant) ?? 0) * e.quantity;
    out.costed += e.quantity;
  }
  for (const g of graded) {
    const cost = paidUsd(g.paid, rates);
    if (cost == null) continue;
    out.costUsd += cost;
    out.valueUsd += gradedValue(g, cards);
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
  date = todayKey(),
): ValuePoint | undefined {
  const e = Array.from(entries);
  const g = Array.from(graded);
  const { valueUsd, count, unique } = computeValue(e, cards, g);
  if (count === 0 && !hasHistory) return undefined;
  const point: ValuePoint = { date, valueUsd: round2(valueUsd), cards: count, unique };
  const cost = costBasis(e, cards, g, rates);
  if (cost.costed) Object.assign(point, { costUsd: round2(cost.costUsd), costedValueUsd: round2(cost.valueUsd) });
  return point;
}
