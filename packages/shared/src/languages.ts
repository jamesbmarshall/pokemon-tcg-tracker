/**
 * Card languages. TCGdex serves each language as its own catalogue. European languages
 * reuse the English set ids, and Asian languages have their own sets (SV4a, S10b…), so
 * ids are namespaced: English stays bare ("sv01-001") for backwards compatibility,
 * everything else is prefixed ("ja:SV4a-001", "fr:sv01-001").
 */

export type Lang = 'en' | 'ja' | 'fr' | 'de' | 'it' | 'es' | 'pt' | 'zh-tw' | 'zh-cn' | 'ko' | 'th' | 'id';

export interface Language {
  code: Lang;
  /** Short badge shown on cards, e.g. "JP". */
  short: string;
  name: string;
  native: string;
}

// Ordered by catalogue completeness on TCGdex.
export const LANGUAGES: Language[] = [
  { code: 'en', short: 'EN', name: 'English', native: 'English' },
  { code: 'ja', short: 'JP', name: 'Japanese', native: '日本語' },
  { code: 'fr', short: 'FR', name: 'French', native: 'Français' },
  { code: 'de', short: 'DE', name: 'German', native: 'Deutsch' },
  { code: 'it', short: 'IT', name: 'Italian', native: 'Italiano' },
  { code: 'es', short: 'ES', name: 'Spanish', native: 'Español' },
  { code: 'pt', short: 'PT', name: 'Portuguese', native: 'Português' },
  { code: 'zh-tw', short: 'TC', name: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'th', short: 'TH', name: 'Thai', native: 'ไทย' },
  { code: 'id', short: 'ID', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'zh-cn', short: 'SC', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'ko', short: 'KR', name: 'Korean', native: '한국어' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && BY_CODE.has(v as Lang);
export const language = (code: Lang): Language => BY_CODE.get(code)!;

// Language codes are lowercase ("ja", "zh-tw"); TCGdex ids never contain ':', so this can't misfire.
const PREFIX = /^([a-z]{2}(?:-[a-z]{2})?):(.+)$/;

/** Splits a namespaced id into its language and the provider's raw id. */
export function splitId(id: string): { lang: Lang; raw: string } {
  const m = PREFIX.exec(id);
  return m && isLang(m[1]) ? { lang: m[1], raw: m[2] } : { lang: 'en', raw: id };
}

export const withLang = (lang: Lang, raw: string) => (lang === 'en' ? raw : `${lang}:${raw}`);
export const langOf = (id: string): Lang => splitId(id).lang;

// European catalogues localise energy types and categories; the app keys colours, icons and
// filters off the English names, so map them back. Asian catalogues already use English.
const TYPE_NAMES: Partial<Record<Lang, Record<string, string>>> = {
  fr: { Combat: 'Fighting', Dragon: 'Dragon', Eau: 'Water', Feu: 'Fire', Fée: 'Fairy', Incolore: 'Colorless', Métal: 'Metal', Obscurité: 'Darkness', Plante: 'Grass', Psy: 'Psychic', Électrique: 'Lightning' },
  de: { Drache: 'Dragon', Elektro: 'Lightning', Farblos: 'Colorless', Fee: 'Fairy', Feuer: 'Fire', Kampf: 'Fighting', Metall: 'Metal', Pflanze: 'Grass', Psycho: 'Psychic', Unlicht: 'Darkness', Wasser: 'Water' },
  it: { Acqua: 'Water', Drago: 'Dragon', Erba: 'Grass', Folletto: 'Fairy', Fuoco: 'Fire', Incolore: 'Colorless', Lampo: 'Lightning', Lotta: 'Fighting', Metallo: 'Metal', Oscurità: 'Darkness', Psico: 'Psychic' },
  es: { Agua: 'Water', Dragón: 'Dragon', Fuego: 'Fire', Hada: 'Fairy', Incolora: 'Colorless', Lucha: 'Fighting', Metálica: 'Metal', Oscura: 'Darkness', Planta: 'Grass', Psíquico: 'Psychic', Rayo: 'Lightning' },
  pt: { Dragão: 'Dragon', Elétrico: 'Lightning', Fada: 'Fairy', Fogo: 'Fire', Incolor: 'Colorless', Lutador: 'Fighting', Metal: 'Metal', Planta: 'Grass', Psíquico: 'Psychic', Sombrio: 'Darkness', Água: 'Water' },
};

const CATEGORY_NAMES: Partial<Record<Lang, Record<string, string>>> = {
  fr: { Pokémon: 'Pokemon', Dresseur: 'Trainer', Énergie: 'Energy' },
  de: { Pokémon: 'Pokemon', Trainer: 'Trainer', Energie: 'Energy' },
  it: { Pokémon: 'Pokemon', Allenatore: 'Trainer', Energia: 'Energy' },
  es: { Pokémon: 'Pokemon', Entrenador: 'Trainer', Energía: 'Energy' },
  pt: { Pokémon: 'Pokemon', Treinador: 'Trainer', Energia: 'Energy' },
};

const invert = (m?: Record<string, string>) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) : undefined);

export const toEnglishType = (lang: Lang, t: string) => TYPE_NAMES[lang]?.[t] ?? t;
export const fromEnglishType = (lang: Lang, t: string) => invert(TYPE_NAMES[lang])?.[t] ?? t;
export const toEnglishCategory = (lang: Lang, c: string) => CATEGORY_NAMES[lang]?.[c] ?? c;
export const fromEnglishCategory = (lang: Lang, c: string) => invert(CATEGORY_NAMES[lang])?.[c] ?? c;
