import type {
  Completion,
  Holding,
  Slab,
  TcgCard,
  Quote,
  SealedProduct,
} from './types';
export function catalogCompletion(
  cards: TcgCard[],
  holdings: Holding[],
  slabs: Slab[],
  complete: boolean,
): Completion {
  const slots = new Set(
    holdings
      .filter((e) => e.quantity > 0)
      .map((e) => `${e.cardId}::${e.finish}`),
  );
  for (const g of slabs)
    if (g.countsTowardSet) slots.add(`${g.cardId}::${g.finish}`);
  const identities = new Set<string>(),
    ownedIdentities = new Set<string>();
  let printings = 0,
    finishes = 0,
    ownedPrintings = 0,
    ownedFinishes = 0;
  for (const c of cards) {
    identities.add(c.identity);
    printings++;
    let owned = false;
    for (const f of c.finishes) {
      finishes++;
      if (slots.has(`${c.id}::${f}`)) {
        owned = true;
        ownedFinishes++;
      }
    }
    if (owned) {
      ownedPrintings++;
      ownedIdentities.add(c.identity);
    }
  }
  return {
    cards: { owned: ownedIdentities.size, total: identities.size },
    printings: { owned: ownedPrintings, total: printings },
    finishes: { owned: ownedFinishes, total: finishes },
    complete,
  };
}
export const holdingId = (cardId: string, finish: string) =>
  `${cardId}::${finish}`;
export function quoteUsd(quote: Quote, eurPerUsd: number): number {
  return quote.currency === 'USD' ? quote.amount : quote.amount / eurPerUsd;
}
export function cardValue(
  card: TcgCard | undefined,
  finish: string,
  eurPerUsd = 1,
): number | undefined {
  const quotes = card?.prices[finish] ?? [];
  const quote =
    quotes.find((q) => q.currency === 'USD') ??
    quotes.find((q) => q.currency === 'EUR');
  return quote ? quoteUsd(quote, eurPerUsd) : undefined;
}
export function collectionValue(
  cards: TcgCard[],
  entries: Holding[],
  graded: Slab[],
  sealed: SealedProduct[],
  eurPerUsd = 1,
) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const raw = entries.reduce(
    (sum, e) =>
      sum +
      e.quantity *
        (e.valueUsd ?? cardValue(byId.get(e.cardId), e.finish, eurPerUsd) ?? 0),
    0,
  );
  const slabs = graded.reduce(
    (sum, g) =>
      sum +
      (g.valueUsd ??
        g.pcPrice ??
        cardValue(byId.get(g.cardId), g.finish, eurPerUsd) ??
        0),
    0,
  );
  const products = sealed
    .filter((s) => s.status === 'sealed')
    .reduce((sum, s) => sum + (s.valueUsd ?? (s.pcPrice ?? 0) * s.quantity), 0);
  return {
    valueUsd: raw + slabs + products,
    cards: entries.reduce((sum, e) => sum + e.quantity, 0) + graded.length,
  };
}
