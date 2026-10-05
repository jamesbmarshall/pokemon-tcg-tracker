import { describe, expect, it } from 'vitest';
import { COMPANIES, GRADE_SCALES, companyName, defaultLabel, formatGrade, gradeRank, labelOptions, verifyLink } from './grading';

describe('grade scales', () => {
  it('offers every company in the picker', () => {
    expect(COMPANIES.map((c) => c.value)).toEqual(['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'Other']);
  });

  it('PSA has no 9.5 but has half grades below 9 and Authentic', () => {
    expect(GRADE_SCALES.PSA.slice(0, 3)).toEqual(['10', '9', '8.5']);
    expect(GRADE_SCALES.PSA).not.toContain('9.5');
    expect(GRADE_SCALES.PSA).toContain('1.5');
    expect(GRADE_SCALES.PSA.at(-1)).toBe('Authentic');
  });

  it('BGS/CGC/SGC/TAG step in halves from 10 to 1', () => {
    for (const c of ['BGS', 'CGC', 'SGC', 'TAG'] as const) {
      expect(GRADE_SCALES[c].slice(0, 3)).toEqual(['10', '9.5', '9']);
      expect(GRADE_SCALES[c]).toContain('1');
    }
    expect(GRADE_SCALES.TAG).not.toContain('Authentic');
  });

  it('ACE only issues whole grades', () => {
    expect(GRADE_SCALES.ACE).toEqual(['10', '9', '8', '7', '6', '5', '4', '3', '2', '1']);
  });
});

describe('labels', () => {
  it('suggests company-specific 10 labels', () => {
    expect(labelOptions('PSA', '10')).toEqual(['Gem Mint']);
    expect(labelOptions('BGS', '10')).toEqual(['Pristine', 'Black Label']);
    expect(labelOptions('CGC', '10')).toEqual(['Gem Mint', 'Pristine']);
  });

  it('maps other grades to descriptors', () => {
    expect(defaultLabel('PSA', '9')).toBe('Mint');
    expect(defaultLabel('PSA', '8')).toBe('NM-MT');
    expect(defaultLabel('BGS', '9.5')).toBe('Gem Mint');
    expect(defaultLabel('CGC', '9.5')).toBe('Mint+');
    expect(defaultLabel('PSA', '1')).toBe('Poor');
    expect(defaultLabel('PSA', 'Authentic')).toBe('Authentic');
    expect(labelOptions('PSA', 'nonsense')).toEqual([]);
  });
});

describe('formatting', () => {
  it('names the grader, using the free-text name for Other', () => {
    expect(companyName({ company: 'PSA' })).toBe('PSA');
    expect(companyName({ company: 'Other', companyName: ' GMA ' })).toBe('GMA');
    expect(companyName({ company: 'Other' })).toBe('Graded');
  });

  it('formats the slab shorthand', () => {
    expect(formatGrade({ company: 'BGS', grade: '9.5' })).toBe('BGS 9.5');
    expect(formatGrade({ company: 'PSA', grade: 'Authentic' })).toBe('PSA Auth');
  });

  it('ranks numeric grades above Authentic', () => {
    expect(['9', 'Authentic', '10', '9.5'].sort((a, b) => gradeRank(b) - gradeRank(a))).toEqual(['10', '9.5', '9', 'Authentic']);
  });
});

describe('verifyLink', () => {
  it('deep-links PSA and CGC certs, URL-encoding the number', () => {
    expect(verifyLink({ company: 'PSA', certNumber: ' 81234567 ' })).toEqual({ url: 'https://www.psacard.com/cert/81234567', deepLink: true });
    expect(verifyLink({ company: 'CGC', certNumber: '12/34' })).toEqual({ url: 'https://www.cgccards.com/certlookup/12%2F34/', deepLink: true });
  });

  it('points BGS and SGC at their lookup pages', () => {
    expect(verifyLink({ company: 'BGS', certNumber: '1' })).toMatchObject({ deepLink: false, url: expect.stringContaining('beckett.com') });
    expect(verifyLink({ company: 'SGC', certNumber: '1' })).toMatchObject({ deepLink: false, url: expect.stringContaining('gosgc.com') });
  });

  it('has nothing for unknown lookups or a missing cert', () => {
    expect(verifyLink({ company: 'TAG', certNumber: '1' })).toBeUndefined();
    expect(verifyLink({ company: 'PSA', certNumber: '  ' })).toBeUndefined();
    expect(verifyLink({ company: 'PSA' })).toBeUndefined();
  });
});
