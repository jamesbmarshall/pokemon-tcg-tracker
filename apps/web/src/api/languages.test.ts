import { describe, expect, it } from 'vitest';
import { fromEnglishCategory, fromEnglishType, isLang, langOf, language, LANGUAGES, splitId, toEnglishCategory, toEnglishType, withLang } from './languages';

describe('languages', () => {
  it('keeps English ids bare and prefixes the rest', () => {
    expect(withLang('en', 'sv01-001')).toBe('sv01-001');
    expect(withLang('ja', 'SV4a-001')).toBe('ja:SV4a-001');
    expect(withLang('zh-tw', 'S10b-001')).toBe('zh-tw:S10b-001');
  });

  it('splits namespaced ids, treating unknown or missing prefixes as English', () => {
    expect(splitId('ja:SV4a-001')).toEqual({ lang: 'ja', raw: 'SV4a-001' });
    expect(splitId('zh-tw:S10b')).toEqual({ lang: 'zh-tw', raw: 'S10b' });
    expect(splitId('sv03.5-006')).toEqual({ lang: 'en', raw: 'sv03.5-006' });
    expect(splitId('xx:abc')).toEqual({ lang: 'en', raw: 'xx:abc' });
    expect(langOf('fr:sv01-001')).toBe('fr');
  });

  it('validates codes and looks up metadata', () => {
    expect(isLang('ja')).toBe(true);
    expect(isLang('klingon')).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(language('ja')).toMatchObject({ short: 'JP', name: 'Japanese' });
    expect(LANGUAGES[0].code).toBe('en');
    expect(new Set(LANGUAGES.map((l) => l.short)).size).toBe(LANGUAGES.length);
  });

  it('maps localised energy types and categories both ways', () => {
    expect(toEnglishType('fr', 'Feu')).toBe('Fire');
    expect(toEnglishType('de', 'Unlicht')).toBe('Darkness');
    expect(toEnglishType('ja', 'Fire')).toBe('Fire');
    expect(fromEnglishType('es', 'Lightning')).toBe('Rayo');
    expect(fromEnglishType('en', 'Water')).toBe('Water');
    expect(toEnglishCategory('it', 'Allenatore')).toBe('Trainer');
    expect(fromEnglishCategory('fr', 'Energy')).toBe('Énergie');
    expect(fromEnglishCategory('ja', 'Pokemon')).toBe('Pokemon');
  });
});
