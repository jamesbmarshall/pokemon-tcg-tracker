/**
 * Collection check for a deck: how many of each named card the owner already has versus how
 * many the decklist needs.
 *
 * The strict rule ("same name + identical card text") would need comparing every field a
 * reprint might change (attacks, abilities, rules text) between printings, which the client
 * does not always have loaded. This keeps it simple and documented: a copy counts towards a
 * deck slot if it has the exact same name as a card in the deck, on any printing that is legal
 * in the deck's chosen format (so an old, format-illegal reprint of the same name doesn't
 * falsely mark a deck as "owned" for play in that format). That matches the common case
 * (reprints of a card are almost always functionally identical) while avoiding both false
 * positives from unrelated same-named errata and the cost of a full text diff.
 */
import type { CardSnapshot } from '../types';
import { checkDeckLegality, normalizedCardName, type DeckCard, type DeckFormat, type LegalityOptions } from './legality';

export interface DeckOwnership {
  name: string;
  needed: number;
  owned: number;
  missing: number;
  /** The deck's own printing id(s) for this name, for highlighting in the deck view. */
  deckCardIds: string[];
}

/**
 * `ownedQtyByCardId` should cover every raw (ungraded) copy the owner holds, keyed by card id,
 * across their whole collection (not just cards already in the deck) so a copy of a different
 * printing of the same name is still found. `allKnownCards` is every card snapshot the client
 * has seen (e.g. the collection's card cache), used to find those other printings by name.
 */
export function computeDeckOwnership(
  deckCards: DeckCard[],
  format: DeckFormat,
  ownedQtyByCardId: Map<string, number>,
  allKnownCards: Iterable<CardSnapshot>,
  legalityOpts: LegalityOptions = {},
): DeckOwnership[] {
  const byName = new Map<string, { needed: number; deckCardIds: string[] }>();
  for (const dc of deckCards) {
    const key = normalizedCardName(dc.card.name);
    if (!byName.has(key)) byName.set(key, { needed: 0, deckCardIds: [] });
    const entry = byName.get(key)!;
    entry.needed += dc.qty;
    entry.deckCardIds.push(dc.card.id);
  }

  // Every printing (deck's own, plus anything else known) sharing each name, format-legal ones only.
  const printingsByName = new Map<string, CardSnapshot[]>();
  for (const name of byName.keys()) printingsByName.set(name, []);
  for (const card of allKnownCards) {
    const key = normalizedCardName(card.name);
    if (printingsByName.has(key)) printingsByName.get(key)!.push(card);
  }
  for (const dc of deckCards) {
    const key = normalizedCardName(dc.card.name);
    const list = printingsByName.get(key)!;
    if (!list.some((c) => c.id === dc.card.id)) list.push(dc.card);
  }

  const out: DeckOwnership[] = [];
  for (const [name, { needed, deckCardIds }] of byName) {
    const printings = printingsByName.get(name) ?? [];
    // Reuses checkDeckLegality's own format-legality rule against a lone card; its other issues
    // (deck size, basic required, ...) are expected here and ignored.
    const legalPrintings =
      format === 'unlimited' ? printings : printings.filter((p) => checkDeckLegality([{ card: p, qty: 1 }], format, legalityOpts).issues.every((i) => i.code !== 'format-illegal'));
    const owned = legalPrintings.reduce((sum, p) => sum + (ownedQtyByCardId.get(p.id) ?? 0), 0);
    out.push({ name, needed, owned, missing: Math.max(0, needed - owned), deckCardIds });
  }
  return out;
}
