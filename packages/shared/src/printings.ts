import { classifyPrintings } from './printingRules';
import type { CardPrinting, PokemonCard } from './types';

export const PRINTING_VERSION = 2;
export interface RawPrinting {
  type: string;
  subtype?: string;
  size?: string;
  stamp?: string[] | string;
  foil?: string;
  variantId?: string;
  sourceRaw?: Pick<RawPrinting, 'type' | 'subtype' | 'size' | 'stamp' | 'foil'>;
  thirdParty?: { tcgplayer?: number; cardmarket?: number; cardtrader?: number };
  dataQuality?: CardPrinting['dataQuality'];
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
    finish: id, size: 'standard', distribution: 'unknown', status: 'unverified', role: 'unresolved', dataQuality: 'flags',
    decision: { policyVersion: 1, rule: 'R90', reason: 'Only summary finish flags are available.' },
  }));
  const stringOrNull = (v: unknown) => v == null || typeof v === 'string';
  raw = raw.map((r) => {
    const valid = r && typeof r.type === 'string' && !!r.type.trim() && [r.size, r.subtype, r.foil].every(stringOrNull) && (stringOrNull(r.stamp) || Array.isArray(r.stamp) && r.stamp.every((v) => typeof v === 'string'));
    return { ...r,
      sourceRaw: { type: r?.type, size: r?.size, subtype: r?.subtype, foil: r?.foil, stamp: r?.stamp },
      dataQuality: !valid ? 'invalid' as const : r.dataQuality ?? (r.variantId === 'generated' ? 'generated' as const : 'detailed' as const),
      type: typeof r?.type === 'string' ? r.type.toLowerCase() : 'unknown',
      size: typeof r?.size === 'string' ? r.size.toLowerCase() : 'standard',
      subtype: typeof r?.subtype === 'string' ? r.subtype.toLowerCase() || undefined : undefined,
      foil: typeof r?.foil === 'string' ? r.foil.toLowerCase() || undefined : undefined,
      stamp: (Array.isArray(r?.stamp) ? r.stamp.filter((v) => typeof v === 'string').map((v) => v.toLowerCase()).sort().join(', ') : typeof r?.stamp === 'string' ? r.stamp.toLowerCase() : '') || undefined,
    };
  });
  if (!raw.length) return resolvePrintings(cardId, variants);
  const grouped = new Map<string, RawPrinting>();
  for (const r of raw) {
    const key = JSON.stringify([r.type, r.subtype, r.size ?? 'standard', r.stamp, r.foil]);
    const prev = grouped.get(key);
    if (!prev) { grouped.set(key, r); continue; }
    const conflicts = ['tcgplayer', 'cardmarket', 'cardtrader'].some((market) => {
      const m = market as keyof NonNullable<RawPrinting['thirdParty']>;
      return prev.thirdParty?.[m] != null && r.thirdParty?.[m] != null && prev.thirdParty[m] !== r.thirdParty[m];
    });
    grouped.set(key, { ...prev, thirdParty: { ...prev.thirdParty, ...r.thirdParty }, dataQuality: conflicts || prev.dataQuality !== r.dataQuality ? 'conflict' : prev.dataQuality });
  }
  const unique = [...grouped.values()];
  const legacyKey = (r: RawPrinting) => {
    const stamps = Array.isArray(r.stamp) ? r.stamp : r.stamp?.split(', ') ?? [];
    if (stamps.includes('1st-edition')) return r.type === 'holo' ? '1stEditionHolofoil' : '1stEditionNormal';
    return keys[r.type] ?? r.type;
  };
  return classifyPrintings(cardId, unique.map((r): CardPrinting => {
    const base = legacyKey(r);
    const stamp = Array.isArray(r.stamp) ? r.stamp.join(', ') : r.stamp;
    const special = !!(stamp || r.subtype || (r.size && r.size !== 'standard') || r.foil || !keys[r.type]);
    // Preserve existing ownership keys only when they identify exactly one physical printing.
    const ambiguous = unique.filter((p) => legacyKey(p) === base).length > 1;
    const id = special ? `${base.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}_p${stableKey(JSON.stringify([r.type, r.subtype ?? '', r.size ?? 'standard', stamp ?? '', r.foil ?? '']))}` : base;
    const label = [r.foil ? `${title(r.foil)} ${labels[r.type] ?? title(r.type)}` : labels[r.type] ?? title(r.type), stamp, r.subtype, r.size && r.size !== 'standard' ? title(r.size) : undefined].filter(Boolean).join(' · ');
    return { id, label, finish: r.foil ?? r.type, size: r.size ?? 'standard', stamp, edition: r.subtype,
      distribution: 'unknown', status: 'unverified', dataQuality: r.dataQuality, providerId: r.variantId, legacyAliases: special && !ambiguous ? [base] : [],
      raw: r.sourceRaw ?? { type: r.type, subtype: r.subtype, size: r.size, stamp: r.stamp, foil: r.foil }, productIds: r.thirdParty,
      };
  }));
}

type Printable = Pick<PokemonCard, 'variants'> & Partial<Pick<PokemonCard, 'printings'>>;
/** Legacy data remains provisional until refreshed; explicitly unverified detailed printings do not fill standard slots. */
export function standardVariants(card: Printable): string[] {
  if (!card.printings?.length) return card.variants ?? [];
  return card.printings.filter((p) => p.role === 'core' || p.role === 'parallel').map((p) => p.id);
}
export function printingLabel(card: Partial<Pick<PokemonCard, 'printings'>>, id: string): string | undefined {
  return card.printings?.find((p) => p.id === id)?.label;
}

export function printingRoleLabel(printing: CardPrinting): string {
  return printing.role === 'core' || printing.role === 'parallel' ? 'Counts towards Master' : printing.role === 'additional' ? 'Extra · not needed for Master' : 'Not counted towards Master · needs checking';
}
