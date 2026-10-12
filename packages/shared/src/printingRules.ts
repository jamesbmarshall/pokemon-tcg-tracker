import type { CardPrinting } from './types';
import type { RawPrinting } from './printings';

/** Versioned, language-scoped rules. A foil name alone never establishes exclusivity. */
export function classifyPrinting(cardId: string, raw: RawPrinting): Partial<CardPrinting> | undefined {
  const [lang, id] = cardId.includes(':') ? cardId.split(':') : ['en', cardId];
  const set = id.slice(0, id.lastIndexOf('-'));
  const stamps = Array.isArray(raw.stamp) ? raw.stamp : raw.stamp ? raw.stamp.split(', ') : [];
  const promotions: Record<string, string> = {
    gamestop: 'GameStop promotion', 'eb-games': 'EB Games promotion',
    'pre-release': 'Prerelease promotion', 'player-rewards-program': 'Player Rewards Program',
    'trick-or-trade': 'Trick or Trade', 'regional-championships': 'Regional Championships',
    'professor-program': 'Professor Program',
  };
  const promotion = stamps.find((stamp) => promotions[stamp]);
  if (promotion) return { distribution: 'exclusive', status: 'inferred', sourceProduct: promotions[promotion] };
  if (lang !== 'en') return undefined;
  if (/^sv03-01[67]$/.test(id) && raw.type === 'holo' && raw.foil === 'cosmos') return {
    distribution: 'exclusive', status: 'verified', sourceProduct: 'Tsareena ex Premium Collection',
    evidence: 'https://www.pokebeach.com/2024/08/new-tsareena-ex-premium-collection-releasing-this-month',
  };
  // Original EX-series parallel sets use a set-logo stamp. This is a booster printing,
  // not a promotional stamp. Keep the physical finish/stamp even though it fills a reverse slot.
  if (/^ex(?:[6-9]|1[0-6])$/.test(set) && stamps.length === 1 && stamps[0] === 'set-logo' && raw.size !== 'jumbo') return {
    distribution: 'expansion', status: 'inferred', finish: 'reverse', label: 'Reverse Holo · Set Logo',
  };
  // Historical editions and foil patterns are standard expansion printings. Unknown
  // stamps, sizes and edition treatments still go to review rather than inheriting this rule.
  const historic = /^(?:base[1-5]|gym[12]|neo[1-4]|ecard[1-3]|ex\d+|dp\d+|pl\d+|hgss\d+|bw\d+|xy\d+|sm\d+)$/.test(set);
  if (historic && ['normal', 'holo', 'reverse'].includes(raw.type) && (!raw.size || raw.size === 'standard') && stamps.every((s) => s === '1st-edition') && (!raw.subtype || raw.subtype === 'unlimited') && (!raw.foil || ['cosmos', 'galaxy', 'starlight'].includes(raw.foil))) return {
    distribution: 'expansion', status: 'inferred',
  };
  // The gold gallery cards are part of their numbered gallery, not product exclusives.
  if (/^swsh(?:9|10|11|12)tg$/.test(set) && raw.foil === 'gold' && !stamps.length && (!raw.size || raw.size === 'standard')) return {
    distribution: 'expansion', status: 'inferred',
  };
  if (['sv10.5b', 'sv10.5w'].includes(set) && ['pokeball', 'masterball', 'tinsel'].includes(raw.foil ?? '') && !stamps.length && (!raw.size || raw.size === 'standard')) return {
    distribution: 'expansion', status: 'inferred',
  };
}

/** Known provider duplicates: galleries have no reverse printings; gold TG cards
 * sometimes carry both a generic holo record and the more specific gold record. */
export function correctRawPrintings(cardId: string, raw: RawPrinting[]): RawPrinting[] {
  const id = cardId.replace(/^[a-z-]+:/, '');
  if (!/^swsh(?:9|10|11|12)tg-TG/.test(id)) return raw;
  const hasGold = raw.some((p) => p.type === 'holo' && p.foil === 'gold');
  return raw.filter((p) => p.type !== 'reverse' && !(hasGold && p.type === 'holo' && !p.foil && !p.stamp && (!p.size || p.size === 'standard')));
}
