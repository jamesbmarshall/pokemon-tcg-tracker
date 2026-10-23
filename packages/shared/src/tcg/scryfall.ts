import type { CardFace, MagicCard, TcgSet, Quote } from './types';
/** Only provider fields we consume; raw payloads never cross the API boundary. */
export interface ScryfallCard {
  all_parts?: { id: string; component: string }[];
  id: string;
  oracle_id?: string;
  name: string;
  printed_name?: string;
  lang: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  artist?: string;
  image_uris?: { normal?: string };
  card_faces?: Partial<ScryfallCard>[];
  oracle_text?: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  layout?: string;
  legalities?: Record<string, string>;
  produced_mana?: string[];
  finishes?: string[];
  games?: string[];
  digital?: boolean;
  promo?: boolean;
  variation?: boolean;
  frame_effects?: string[];
  border_color?: string;
  full_art?: boolean;
  textless?: boolean;
  prices?: Record<string, string | null>;
  purchase_uris?: { tcgplayer?: string; cardmarket?: string };
}
export function fromScryfall(
  raw: ScryfallCard,
  at = new Date().toISOString(),
): MagicCard {
  const face = (f: Partial<ScryfallCard>): CardFace => ({
    name: f.name ?? raw.name,
    text: f.oracle_text ?? '',
    typeLine: f.type_line ?? '',
    manaCost: f.mana_cost,
    image: f.image_uris?.normal,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
  });
  const faces = raw.card_faces?.length ? raw.card_faces.map(face) : [face(raw)];
  const prices: Record<string, Quote[]> = {};
  for (const [finish, keys] of Object.entries({
    nonfoil: ['usd', 'eur'],
    foil: ['usd_foil', 'eur_foil'],
    etched: ['usd_etched'],
  })) {
    if (!raw.finishes?.includes(finish)) continue;
    for (const key of keys) {
      const value = raw.prices?.[key];
      if (value == null || value === '') continue;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      const usd = key.startsWith('usd');
      (prices[finish] ??= []).push({
        amount,
        currency: usd ? 'USD' : 'EUR',
        source: usd ? 'tcgplayer' : 'cardmarket',
        at,
        url: usd ? raw.purchase_uris?.tcgplayer : raw.purchase_uris?.cardmarket,
      });
    }
  }
  return {
    game: 'mtg',
    id: `mtg:${raw.id}`,
    providerId: raw.id,
    identity: `mtg:${raw.oracle_id ?? raw.id}`,
    name: raw.name,
    printedName: raw.printed_name,
    language: raw.lang,
    setId: `mtg:${raw.set}`,
    setCode: raw.set,
    setName: raw.set_name,
    number: raw.collector_number,
    rarity: raw.rarity ?? '',
    artist: raw.artist ?? '',
    image: raw.image_uris?.normal ?? faces.find((f) => f.image)?.image ?? '',
    faces,
    finishes: raw.finishes ?? [],
    treatments: [
      ...(raw.frame_effects ?? []),
      ...(raw.full_art ? ['full art'] : []),
      ...(raw.textless ? ['textless'] : []),
      ...(raw.border_color ? [`${raw.border_color} border`] : []),
      ...(raw.promo ? ['promo'] : []),
    ],
    extra: /token|emblem|art_series/.test(raw.layout ?? ''),
    paper:
      !raw.digital &&
      (raw.games?.includes('paper') ?? false) &&
      !raw.all_parts?.some(
        (part) => part.id === raw.id && part.component === 'meld_result',
      ),
    prices,
    fetchedAt: at,
    details: {
      kind: 'mtg',
      oracleId: raw.oracle_id,
      colors: raw.colors ?? [
        ...new Set((raw.card_faces ?? []).flatMap((f) => f.colors ?? [])),
      ],
      colorIdentity: raw.color_identity ?? [],
      manaValue: raw.cmc ?? 0,
      typeLine: raw.type_line ?? faces.map((f) => f.typeLine).join(' // '),
      oracleText: raw.oracle_text ?? faces.map((f) => f.text).join('\n'),
      keywords: raw.keywords ?? [],
      layout: raw.layout ?? 'normal',
      meldResultId:
        raw.layout === 'meld'
          ? raw.all_parts?.find(
              (part) => part.component === 'meld_result' && part.id !== raw.id,
            )?.id
          : undefined,
      rulesComplete:
        !!raw.oracle_id &&
        Array.isArray(raw.color_identity) &&
        !!raw.legalities &&
        !!raw.type_line &&
        Number.isFinite(raw.cmc),
      legalities: raw.legalities ?? {},
      producedMana: raw.produced_mana ?? [],
    },
  };
}
export function scryfallSet(raw: {
  id: string;
  code: string;
  name: string;
  released_at?: string;
  card_count?: number;
  set_type?: string;
  parent_set_code?: string;
}): TcgSet {
  return {
    game: 'mtg',
    id: `mtg:${raw.code}`,
    providerId: raw.id,
    code: raw.code,
    name: raw.name,
    releaseDate: raw.released_at ?? '',
    total: raw.card_count ?? 0,
    type: raw.set_type ?? '',
    parentId: raw.parent_set_code ? `mtg:${raw.parent_set_code}` : undefined,
  };
}
export function scryfallQuery(query: import('./types').TcgSearch): string {
  // Quoted atoms cannot inject operators; free-text query intentionally supports Scryfall syntax.
  const atom = (v: string | number) => `"${String(v).replace(/["\\]/g, '')}"`;
  const terms = [
    'game:paper',
    'include:extras',
    query.q ? `(${query.q})` : '',
    query.language ? `lang:${atom(query.language)}` : '',
  ];
  const fields: Record<string, string> = {
    set: 'set',
    number: 'cn',
    text: 'o',
    type: 't',
    color: 'c',
    identity: 'id',
    mv: 'mv',
    rarity: 'r',
    artist: 'a',
    legal: 'legal',
  };
  for (const [key, field] of Object.entries(fields))
    if (query[key] !== undefined && query[key] !== '')
      terms.push(`${field}:${atom(query[key]!)}`);
  if (['foil', 'nonfoil', 'etched'].includes(String(query.finish)))
    terms.push(`is:${query.finish}`);
  return terms.filter(Boolean).join(' ');
}
