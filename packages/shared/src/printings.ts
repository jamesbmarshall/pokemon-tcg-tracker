import { classifyPrinting, correctRawPrintings } from './printingRules';
import type { CardPrinting, PokemonCard } from './types';

export const PRINTING_VERSION = 1;
export interface RawPrinting {
  type: string;
  subtype?: string;
  size?: string;
  stamp?: string[] | string;
  foil?: string;
  variantId?: string;
  sourceRaw?: Pick<RawPrinting, 'type' | 'subtype' | 'size' | 'stamp' | 'foil'>;
  thirdParty?: { tcgplayer?: number; cardmarket?: number };
}
const keys: Record<string, string> = { normal: 'normal', holo: 'holofoil', reverse: 'reverseHolofoil', firstEdition: '1stEditionNormal', wPromo: 'wPromo' };
const labels: Record<string, string> = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1st Edition', wPromo: 'W Stamp Promo' };
const title = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function stableKey(value: string): string {
  let hash = 14695981039346656037n;
  for (const c of value) hash = BigInt.asUintN(64, (hash ^ BigInt(c.codePointAt(0)!)) * 1099511628211n);
  return hash.toString(16);
}

export function resolvePrintings(cardId: string, variants: string[], raw?: RawPrinting[]): CardPrinting[] {
  if (!raw?.length) return variants.map((id) => ({
    id, label: ({ normal: 'Normal', holofoil: 'Holo', reverseHolofoil: 'Reverse Holo', '1stEditionNormal': '1st Edition', '1stEditionHolofoil': '1st Ed. Holo', wPromo: 'W Stamp Promo' } as Record<string, string>)[id] ?? title(id.replace(/([A-Z])/g, ' $1')),
    finish: id, size: 'standard', distribution: id === 'wPromo' ? 'unknown' : 'expansion', status: 'inferred',
  }));
  raw = raw.map((r) => ({ ...r, sourceRaw: { type: r.type, size: r.size, subtype: r.subtype, foil: r.foil, stamp: r.stamp }, type: r.type.toLowerCase(), size: r.size?.toLowerCase() || 'standard', subtype: r.subtype?.toLowerCase() || undefined, foil: r.foil?.toLowerCase() || undefined, stamp: (Array.isArray(r.stamp) ? r.stamp.map((s) => s.toLowerCase()).sort().join(', ') : r.stamp?.toLowerCase()) || undefined }));
  raw = correctRawPrintings(cardId, raw);
  if (!raw.length) return resolvePrintings(cardId, variants);
  const unique = [...new Map(raw.map((r) => [JSON.stringify([r.type, r.subtype, r.size ?? 'standard', r.stamp, r.foil]), r])).values()];
  const legacyKey = (r: RawPrinting) => {
    const stamps = Array.isArray(r.stamp) ? r.stamp : r.stamp?.split(', ') ?? [];
    if (stamps.includes('1st-edition')) return r.type === 'holo' ? '1stEditionHolofoil' : '1stEditionNormal';
    return keys[r.type] ?? r.type;
  };
  return unique.map((r) => {
    const base = legacyKey(r);
    const stamp = Array.isArray(r.stamp) ? r.stamp.join(', ') : r.stamp;
    const special = !!(stamp || r.subtype || (r.size && r.size !== 'standard') || r.foil || !keys[r.type]);
    // Preserve existing ownership keys only when they identify exactly one physical printing.
    const ambiguous = unique.filter((p) => legacyKey(p) === base).length > 1;
    const id = special ? `${base.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}_p${stableKey(JSON.stringify([r.type, r.subtype ?? '', r.size ?? 'standard', stamp ?? '', r.foil ?? '']))}` : base;
    const label = [r.foil ? `${title(r.foil)} ${labels[r.type] ?? title(r.type)}` : labels[r.type] ?? title(r.type), stamp, r.subtype, r.size && r.size !== 'standard' ? title(r.size) : undefined].filter(Boolean).join(' · ');
    return { id, label, finish: r.foil ?? r.type, size: r.size ?? 'standard', stamp, edition: r.subtype,
      distribution: special ? 'unknown' : 'expansion', status: special ? 'unverified' : 'inferred', providerId: r.variantId, legacyAliases: special && !ambiguous ? [base] : [],
      raw: r.sourceRaw ?? { type: r.type, subtype: r.subtype, size: r.size, stamp: r.stamp, foil: r.foil }, productIds: r.thirdParty,
      ...classifyPrinting(cardId, r) };
  });
}

type Printable = Pick<PokemonCard, 'variants'> & Partial<Pick<PokemonCard, 'printings'>>;
/** Legacy data remains provisional until refreshed; explicitly unverified detailed printings do not fill standard slots. */
export function standardVariants(card: Printable): string[] {
  if (!card.printings?.length) return card.variants?.length ? card.variants : ['normal'];
  return card.printings.filter((p) => p.distribution === 'expansion').map((p) => p.id);
}
export function printingLabel(card: Partial<Pick<PokemonCard, 'printings'>>, id: string): string | undefined {
  return card.printings?.find((p) => p.id === id)?.label;
}
