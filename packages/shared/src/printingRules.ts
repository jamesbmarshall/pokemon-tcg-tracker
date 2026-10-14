import type { CardPrinting, PokemonCard, PrintingContext } from './types';

export const POLICY_VERSION = 2;
const MIN_PEERS = 10;
const MARKETS = ['cardmarket', 'tcgplayer', 'cardtrader'] as const;
// These are API attribute meanings, never per-card or per-set corrections.
const CAMPAIGNS = new Set(['gamestop', 'eb-games', 'pre-release', 'staff', 'pokemon-center', 'snowflake', 'trick-or-trade', 'player-rewards-program', 'regional-championships', 'professor-program']);
const EDITIONS = new Set(['', 'unlimited', 'shadowless']);
export const token = (v: unknown): string => typeof v === 'string' ? v.trim().toLowerCase() : '';
export const stampsOf = (p: CardPrinting): string[] => {
  const raw = p.raw?.stamp ?? p.stamp;
  return (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []).map(token).filter(Boolean).sort();
};
export function printingSignature(p: CardPrinting): string {
  return JSON.stringify([token(p.raw?.type ?? p.finish), token(p.raw?.subtype ?? p.edition), token(p.raw?.size ?? p.size) || 'standard', stampsOf(p), token(p.raw?.foil)]);
}
export function fingerprint(value: unknown): string {
  let hash = 14695981039346656037n;
  for (const c of JSON.stringify(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(c.codePointAt(0)!)) * 1099511628211n);
  return hash.toString(16);
}
interface ProfileCard {
  context?: PrintingContext;
  printings: CardPrinting[];
}
export interface PrintingProfile {
  version: number;
  setId: string;
  fingerprint: string;
  complete: boolean;
  cards: Record<string, ProfileCard>;
}
const usable = (p: CardPrinting) => p.dataQuality === 'detailed';
const regular = (p: CardPrinting) => token(p.size) === 'standard';
const kind = (p: CardPrinting) => token(p.raw?.type ?? p.finish);
const campaign = (p: CardPrinting) => stampsOf(p).some((s) => CAMPAIGNS.has(s));
const cohort = (c?: PrintingContext) => c?.rarity && c.category ? JSON.stringify([c.setId, c.language, token(c.rarity), token(c.category), token(c.mechanic)]) : undefined;

/** Profile contains source observations, never previous inferred roles or price values. */
export function buildPrintingProfile(setId: string, cards: PokemonCard[], complete: boolean): PrintingProfile {
  const entries = cards.map((c): [string, ProfileCard] => [c.id, {
    context: c.printingContext,
    printings: (c.printings ?? []).map((p): CardPrinting => ({ id: p.id, label: p.label, finish: p.finish, size: p.size, stamp: p.stamp, edition: p.edition, raw: p.raw, productIds: p.productIds, providerId: p.providerId, dataQuality: p.dataQuality, distribution: 'unknown', status: 'unverified' })).sort((a, b) => a.id.localeCompare(b.id)),
  }]).sort(([a], [b]) => a.localeCompare(b));
  const source = Object.fromEntries(entries);
  // Provider order, prices and display names must not churn classification caches.
  const signature = entries.map(([id, c]) => [id, c.context, c.printings.map((p) => [p.id, printingSignature(p), MARKETS.map((m) => p.productIds?.[m] ?? null), p.dataQuality])]);
  return { version: POLICY_VERSION, setId, complete, fingerprint: fingerprint([POLICY_VERSION, complete, signature]), cards: source };
}

/** TCGdex currently has no printing-level origin field to implement R10. */
export function classifyPrintings(cardId: string, input: CardPrinting[], context?: PrintingContext, profile?: PrintingProfile): CardPrinting[] {
  const validProfile = profile?.version === POLICY_VERSION && profile.complete && profile.setId === context?.setId ? profile : undefined;
  const target = validProfile?.cards[cardId];
  // Listings may omit product IDs. Enrich only an identical physical record from the same import.
  const printings = input.map((p) => {
    const source = target?.printings.find((q) => q.id === p.id && printingSignature(q) === printingSignature(p));
    return { ...p, productIds: p.productIds ?? source?.productIds, providerId: p.providerId ?? source?.providerId };
  });
  const key = cohort(context);
  const peers = validProfile && key ? Object.entries(validProfile.cards).filter(([id, c]) => id !== cardId && cohort(c.context) === key && c.printings.length > 0 && c.printings.every(usable)).map(([, c]) => c) : [];
  const occurrences = (p: CardPrinting) => peers.filter((c) => c.printings.some((q) => printingSignature(q) === printingSignature(p))).length;
  const supported = (p: CardPrinting) => peers.length >= MIN_PEERS && occurrences(p) * 5 >= peers.length * 4;
  const roles = new Map<string, CardPrinting>();
  const assign = (p: CardPrinting, role: NonNullable<CardPrinting['role']>, rule: string, reason: string, products?: string[]) => {
    roles.set(p.id, { ...p, distribution: 'unknown', sourceProduct: undefined, evidence: undefined, role,
      status: role === 'unresolved' ? 'unverified' : 'inferred',
      decision: { policyVersion: POLICY_VERSION, rule, reason, profile: validProfile?.fingerprint, ...(peers.length ? { peers: peers.length, occurrences: occurrences(p) } : {}), ...(products ? { products } : {}) } });
  };
  for (const p of printings) {
    if (!usable(p)) assign(p, 'unresolved', 'R90', 'Detailed printing data is missing, generated or conflicting.');
    else if (token(p.size) === 'jumbo') assign(p, 'additional', 'R20', 'Oversized printings are additional under the PokeTracker standard.');
    else if (campaign(p)) {
      const counterpart = printings.some((q) => usable(q) && regular(q) && !stampsOf(q).length && token(q.edition) === token(p.edition));
      assign(p, counterpart ? 'additional' : 'unresolved', counterpart ? 'R20' : 'R90', counterpart ? 'Campaign-marked alternative to an unstamped printing.' : 'Campaign printing requires catalogue release context.');
    }
  }
  const pending = () => printings.filter((p) => !roles.has(p.id));
  const cores = () => [...roles.values()].filter((p) => p.role === 'core');
  for (const p of pending()) if (regular(p) && ['normal', 'holo', 'metal', 'lenticular'].includes(kind(p)) && supported(p)) assign(p, 'core', 'R30', 'This printing matches a recurring pattern among comparable cards in this set.');
  if (cores().length) for (const p of pending()) if (regular(p) && kind(p) === 'reverse' && supported(p)) assign(p, 'parallel', 'R30', 'This parallel matches a recurring pattern among comparable cards in this set.');
  const main = [...roles.values()].filter((p) => p.decision?.rule === 'R30');
  for (const p of pending()) {
    if (peers.length < MIN_PEERS || occurrences(p) * 5 > peers.length || main.length < 2) continue;
    const linked = MARKETS.some((m) => p.productIds?.[m] != null && main.some((q) => q.productIds?.[m] === p.productIds?.[m]));
    if (linked) continue;
    const separate = MARKETS.flatMap((m) => {
      const groups = new Map<number, number>();
      for (const q of main) { const id = q.productIds?.[m]; if (id != null) groups.set(id, (groups.get(id) ?? 0) + 1); }
      return [...groups].filter(([id, count]) => count >= 2 && p.productIds?.[m] != null && p.productIds[m] !== id).map(([id]) => `${m}:${id} -> ${p.productIds![m]}`);
    });
    if (separate.length) assign(p, 'additional', 'R40', 'An uncommon extra printing has a separate product reference from the supported main printing group.', separate);
  }
  const candidates = printings.filter((p) => usable(p) && regular(p) && !stampsOf(p).length && ['normal', 'holo'].includes(kind(p)) && EDITIONS.has(token(p.edition)) && !['additional', 'unresolved'].includes(roles.get(p.id)?.role ?? ''));
  // An extra named foil must not hide the ordinary printing in a small rarity group.
  const ordinary = candidates.filter((p) => !token(p.raw?.foil));
  const defaults = ordinary.length ? ordinary : candidates;
  if (!cores().length && defaults.length === 1 && !roles.has(defaults[0].id)) assign(defaults[0], 'core', 'R50', 'The API lists one eligible ordinary-sized default printing.');
  for (const p of pending()) {
    if (!regular(p) || kind(p) !== 'reverse' || stampsOf(p).length || !EDITIONS.has(token(p.edition))) continue;
    const linked = cores().find((q) => token(q.edition) === token(p.edition) && (!token(p.raw?.foil) || MARKETS.some((m) => p.productIds?.[m] != null && q.productIds?.[m] === p.productIds[m])) && !MARKETS.some((m) => p.productIds?.[m] != null && q.productIds?.[m] != null && q.productIds[m] !== p.productIds[m]));
    if (linked) assign(p, 'parallel', 'R50', 'A listed reverse of the ordinary printing, with no conflicting product references.');
  }
  for (const p of pending()) assign(p, 'unresolved', 'R90', 'Insufficient or conflicting evidence for checklist membership.');
  return printings.map((p) => roles.get(p.id)!);
}

export function applyPrintingProfile(card: PokemonCard, profile?: PrintingProfile): PokemonCard {
  const applicable = profile?.version === POLICY_VERSION && profile.setId === card.printingContext?.setId ? profile : undefined;
  const observed = applicable?.cards[card.id]?.printings;
  const matches = observed && observed.length === card.printings?.length && observed.every((p) => card.printings?.some((q) => p.id === q.id && printingSignature(p) === printingSignature(q) && p.dataQuality === q.dataQuality));
  return { ...card, printings: classifyPrintings(card.id, card.printings ?? [], card.printingContext, applicable), printingProfile: applicable?.fingerprint, printingCoverage: applicable?.complete && matches ? 'complete' : 'partial' };
}
