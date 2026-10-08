/**
 * Extracts card-identifying candidates (collector number, printed total, set/promo code) from
 * raw OCR text of a card's bottom strip. Runs entirely client-side; the server only ever sees
 * the candidate the user confirmed, via GET /api/cards/lookup.
 *
 * OCR on a small, low-contrast strip misreads characters often, so number-like tokens are
 * normalised before matching: O/o and I/i/l/L are folded into 0 and 1 respectively wherever they
 * sit among digits (e.g. "l23/198" -> "123/198", "12O/198" -> "120/198").
 */
import { PROMO_PREFIXES, SUBSET_PREFIXES, knownCodes } from './setCodes';

export interface ScanCandidate {
  /** Printed collector number, e.g. "123", "TG05", "045". Zero-padding is kept as printed. */
  number: string;
  /** Printed total, e.g. "198", "TG30". Absent for promos, which have no total. */
  total?: string;
  /** A printed set or promo code, e.g. "SVI", "PR-SV". Absent when none was found nearby. */
  setCode?: string;
  /** 0-1: how sure the match is, for picking which candidate to try first. */
  confidence: number;
  /** The substring that was matched, for tests and debugging. */
  raw: string;
}

/** Folds common OCR misreads of digits (O->0, I/l->1) within an otherwise numeric token. */
function fixDigits(token: string): string {
  return token.replace(/[OIL]/g, (c) => (c === 'O' ? '0' : '1'));
}

interface Span {
  start: number;
  end: number;
}

const overlaps = (a: Span, spans: Span[]) => spans.some((s) => a.start < s.end && a.end > s.start);

const PROMO_RE = /\b(SVP|SWSH|SM|XY|BW|DP|HS)[-\s]?(\d{2,4})\b/g;
const SUBSET_FRACTION_RE = /\b(TG|GG|SV)(\d{1,3})\s*\/\s*(?:TG|GG|SV)?(\d{1,3})\b/g;
const SUBSET_STANDALONE_RE = /\b(TG|GG|SV)(\d{1,3})\b/g;
const PLAIN_FRACTION_RE = /\b([0-9OIL]{1,4})\s*\/\s*([0-9OIL]{1,4})\b/g;

/**
 * Looks for a known set code within `window` characters either side of a number match, so
 * "SVI 123/198" and "123/198 SVI" both attach the code to the number. Codes embedded inside the
 * number match itself (e.g. the "SV" of "SV045") are never considered.
 */
function nearbyCode(text: string, span: Span, codes: Set<string>, window = 16): string | undefined {
  const before = text.slice(Math.max(0, span.start - window), span.start);
  const after = text.slice(span.end, span.end + window);
  for (const token of [...before.match(/[A-Z][A-Z-]{1,6}/g) ?? [], ...after.match(/[A-Z][A-Z-]{1,6}/g) ?? []]) {
    if (codes.has(token)) return token;
  }
  return undefined;
}

/**
 * Parses OCR text into candidates, best match first. `knownCodeList` lets callers pass a
 * live-fetched code list (see setCodes.ts `knownCodes`); it defaults to the static table.
 */
export function parseScanText(text: string, knownCodeList: string[] = knownCodes()): ScanCandidate[] {
  const upper = text.toUpperCase();
  const codes = new Set(knownCodeList.map((c) => c.toUpperCase()));
  const consumed: Span[] = [];
  const out: ScanCandidate[] = [];

  for (const m of upper.matchAll(PROMO_RE)) {
    const span = { start: m.index!, end: m.index! + m[0].length };
    const setCode = PROMO_PREFIXES[m[1]];
    if (!setCode) continue;
    out.push({ number: fixDigits(m[2]).padStart(3, '0'), setCode, confidence: 0.9, raw: m[0] });
    consumed.push(span);
  }

  for (const m of upper.matchAll(SUBSET_FRACTION_RE)) {
    const span = { start: m.index!, end: m.index! + m[0].length };
    if (overlaps(span, consumed)) continue;
    const prefix = m[1];
    out.push({ number: `${prefix}${fixDigits(m[2])}`, total: `${prefix}${fixDigits(m[3])}`, confidence: 0.9, raw: m[0] });
    consumed.push(span);
  }

  for (const m of upper.matchAll(PLAIN_FRACTION_RE)) {
    const span = { start: m.index!, end: m.index! + m[0].length };
    if (overlaps(span, consumed)) continue;
    const number = fixDigits(m[1]);
    const total = fixDigits(m[2]);
    // Real printed set totals are almost always 2+ digits; a single-digit total like "1/1" or
    // "3/4" is too common in unrelated OCR noise (page numbers, ratios, etc.) to trust.
    if (total.length < 2) continue;
    // The number is normally <= the total, but secret rares legitimately print a number above
    // the set total (e.g. "201/198"), so that case is kept, just with lower confidence.
    const isSecretRare = Number(number) > Number(total);
    out.push({
      number,
      total,
      setCode: nearbyCode(upper, span, codes),
      confidence: isSecretRare ? 0.6 : 0.8,
      raw: m[0],
    });
    consumed.push(span);
  }

  for (const m of upper.matchAll(SUBSET_STANDALONE_RE)) {
    const span = { start: m.index!, end: m.index! + m[0].length };
    if (overlaps(span, consumed)) continue;
    const prefix = m[1];
    out.push({ number: `${prefix}${fixDigits(m[2])}`, confidence: 0.5, raw: m[0] });
    consumed.push(span);
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export { PROMO_PREFIXES, SUBSET_PREFIXES };
