import type { GradedCopy, GradingCompany } from '../api/types';

export const COMPANIES: { value: GradingCompany; name: string }[] = [
  { value: 'PSA', name: 'PSA' },
  { value: 'BGS', name: 'Beckett (BGS)' },
  { value: 'CGC', name: 'CGC' },
  { value: 'SGC', name: 'SGC' },
  { value: 'TAG', name: 'TAG' },
  { value: 'ACE', name: 'ACE' },
  { value: 'Other', name: 'Other' },
];

const halves = (from: number) => Array.from({ length: (10 - from) * 2 + 1 }, (_, i) => String(10 - i / 2));
const wholes = Array.from({ length: 10 }, (_, i) => String(10 - i));

/** Grades each company actually issues, best first. */
export const GRADE_SCALES: Record<GradingCompany, string[]> = {
  PSA: ['10', '9', ...halves(1).filter((g) => Number(g) < 9), 'Authentic'],
  BGS: [...halves(1), 'Authentic'],
  CGC: [...halves(1), 'Authentic'],
  SGC: [...halves(1), 'Authentic'],
  TAG: [...halves(1)],
  ACE: [...wholes],
  Other: [...halves(1), 'Authentic'],
};

/** Companies whose slabs commonly carry sub-grades. */
export const SUBGRADE_COMPANIES = new Set<GradingCompany>(['BGS', 'CGC', 'TAG', 'ACE']);

const DESCRIPTORS: Record<string, string> = {
  '10': 'Gem Mint',
  '9.5': 'Gem Mint',
  '9': 'Mint',
  '8.5': 'NM-MT+',
  '8': 'NM-MT',
  '7.5': 'NM+',
  '7': 'Near Mint',
  '6.5': 'EX-MT+',
  '6': 'EX-MT',
  '5.5': 'EX+',
  '5': 'Excellent',
  '4.5': 'VG-EX+',
  '4': 'VG-EX',
  '3.5': 'VG+',
  '3': 'Very Good',
  '2.5': 'Good+',
  '2': 'Good',
  '1.5': 'Fair',
  '1': 'Poor',
};

/** Label suggestions for a grade; the first one is the default. */
export function labelOptions(company: GradingCompany, grade: string): string[] {
  if (grade === 'Authentic') return ['Authentic', 'Altered'];
  const base = DESCRIPTORS[grade];
  if (!base) return [];
  if (grade === '10') {
    if (company === 'BGS') return ['Pristine', 'Black Label'];
    if (company === 'CGC' || company === 'SGC' || company === 'TAG') return ['Gem Mint', 'Pristine'];
    return ['Gem Mint'];
  }
  if (grade === '9.5' && (company === 'CGC' || company === 'SGC')) return ['Mint+'];
  return [base];
}

export const defaultLabel = (company: GradingCompany, grade: string) => labelOptions(company, grade)[0];

export const companyName = (g: Pick<GradedCopy, 'company' | 'companyName'>) => (g.company === 'Other' ? g.companyName?.trim() || 'Graded' : g.company);

/** Short slab text, e.g. "PSA 10" or "BGS 9.5". */
export const formatGrade = (g: Pick<GradedCopy, 'company' | 'companyName' | 'grade'>) =>
  g.grade === 'Authentic' ? `${companyName(g)} Auth` : `${companyName(g)} ${g.grade}`;

/** Numeric value for sorting slabs best-first; Authentic sorts last. */
export const gradeRank = (grade: string) => (Number.isFinite(Number(grade)) ? Number(grade) : -1);

/**
 * Public cert lookups. PSA and CGC accept the number in the URL; Beckett and SGC only
 * have a search page, so the number is copied for pasting.
 */
export function verifyLink(g: Pick<GradedCopy, 'company' | 'certNumber'>): { url: string; deepLink: boolean } | undefined {
  const cert = g.certNumber?.trim();
  if (!cert) return undefined;
  const enc = encodeURIComponent(cert);
  switch (g.company) {
    case 'PSA':
      return { url: `https://www.psacard.com/cert/${enc}`, deepLink: true };
    case 'CGC':
      return { url: `https://www.cgccards.com/certlookup/${enc}/`, deepLink: true };
    case 'BGS':
      return { url: 'https://www.beckett.com/grading/card-lookup', deepLink: false };
    case 'SGC':
      return { url: 'https://gosgc.com/cert-code-lookup', deepLink: false };
    default:
      return undefined;
  }
}

export const SUBGRADE_KEYS = ['centering', 'corners', 'edges', 'surface'] as const;
