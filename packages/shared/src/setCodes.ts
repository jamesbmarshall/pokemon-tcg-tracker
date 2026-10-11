/**
 * Maps the set codes printed on physical cards (PTCGO/regulation style, e.g. "SVI", "PAL") and
 * promo codes (e.g. "SVP", "XY-P") to the TCGdex set id(s) that may contain a matching card.
 *
 * A code can map to more than one TCGdex set id: Trainer Gallery / Galarian Gallery / Shiny
 * Vault sub-printings share their parent set's code but live under their own id (e.g. "ASR"
 * covers both `swsh10` and its Trainer Gallery sibling `swsh10tg`). The scan lookup tries every
 * id for a code and keeps whichever actually has the scanned collector number.
 *
 * `SET_CODES` (from legacySets.ts) is itself the static fallback TCGdex uses when a set has no
 * official `abbreviation` in its API response; `buildCodeIndex` lets callers fold in live
 * `ptcgoCode` values from fetched sets so newly released sets resolve without a code change here.
 */
import { SET_CODES } from './legacySets';
import type { CardSet } from './types';

/** TCGdex set id -> every card code printed on its cards, built once from the static table. */
function reverse(map: Record<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, code] of Object.entries(map)) {
    const key = code.toUpperCase();
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(id);
  }
  return out;
}

/** Static code -> set id(s), derived from the same table TCGdex abbreviations fall back to. */
export const STATIC_CODE_INDEX: Map<string, Set<string>> = reverse(SET_CODES);

/**
 * Promo sub-brands are printed without their trailing "P" for every era except Scarlet & Violet
 * (e.g. a Sword & Shield promo reads "SWSH276", not "SWSHP276"; a Scarlet & Violet one reads
 * "SVP 064"). This maps the printed prefix to the internal promo code used above.
 */
export const PROMO_PREFIXES: Record<string, string> = {
  SVP: 'PR-SV',
  SWSH: 'PR-SW',
  SM: 'PR-SM',
  XY: 'xyp',
  BW: 'PR-BLW',
  DP: 'PR-DPP',
  HS: 'PR-HS',
};

/** Sub-printings with their own id, keyed by the prefix printed in front of their number. */
export const SUBSET_PREFIXES: Record<string, RegExp> = {
  TG: /tg$/,
  GG: /gg$/,
  SV: /^sma$|a$/,
};

/**
 * Builds a code index from live set data (its `ptcgoCode`, which already prefers TCGdex's own
 * `abbreviation.official` over the static table), falling back to the static index for any code
 * a caller hasn't fetched sets for yet. Call with the full fetched set list for the best match.
 */
export function buildCodeIndex(sets: Pick<CardSet, 'id' | 'ptcgoCode'>[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [code, ids] of STATIC_CODE_INDEX) out.set(code, new Set(ids));
  for (const s of sets) {
    if (!s.ptcgoCode) continue;
    const key = s.ptcgoCode.toUpperCase();
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(s.id);
  }
  return out;
}

/** Every TCGdex set id that could match a given printed code, preferring an already-built index. */
export function setIdsForCode(code: string, index: Map<string, Set<string>> = STATIC_CODE_INDEX): string[] {
  return Array.from(index.get(code.toUpperCase()) ?? []);
}

/** Every known printed code, for validating free-text input before it reaches a lookup. */
export function knownCodes(index: Map<string, Set<string>> = STATIC_CODE_INDEX): string[] {
  return Array.from(index.keys());
}
