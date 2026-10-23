import type { DeckItem, DeckZone, TcgCard, DeckTextRow } from './types';
export type { DeckTextRow } from './types';
export function parseMagicDeck(text: string): {
  rows: DeckTextRow[];
  errors: string[];
} {
  const rows: DeckTextRow[] = [],
    errors: string[] = [];
  let zone: DeckZone = 'main';
  if (text.length > 200_000)
    return { rows, errors: ['Deck text exceeds 200,000 characters.'] };
  const zones: Record<string, DeckZone> = {
    commander: 'commander',
    commanders: 'commander',
    commandzone: 'commander',
    deck: 'main',
    main: 'main',
    mainboard: 'main',
    companion: 'companion',
    maybeboard: 'maybeboard',
    sideboard: 'maybeboard',
  };
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return;
    const heading = zones[line.toLowerCase().replace(/[\s:[\]]/g, '')];
    if (heading) {
      zone = heading;
      return;
    }
    const m =
      /^(\d+)x?\s+(.+?)(?:\s+\(([a-zA-Z0-9]+)\)\s+([^\s]+))?(?:\s+\*F\*)?$/.exec(
        line,
      );
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 1000) {
      errors.push(`Line ${idx + 1}: expected quantity and card name.`);
      return;
    }
    rows.push({
      name: m[2].trim(),
      quantity: Number(m[1]),
      zone,
      set: m[3]?.toLowerCase(),
      number: m[4],
      line: idx + 1,
    });
  });
  return { rows, errors };
}
export function formatMagicDeck(
  items: DeckItem[],
  cards: Map<string, TcgCard>,
): string {
  return (['commander', 'main', 'companion', 'maybeboard'] as const)
    .map((zone) => {
      const lines = items
        .filter((i) => i.zone === zone)
        .map((i) => {
          const c = cards.get(i.cardId);
          return c
            ? `${i.quantity} ${c.name} (${c.setCode.toUpperCase()}) ${c.number}`
            : '';
        })
        .filter(Boolean);
      return lines.length
        ? `${zone === 'main' ? 'Deck' : zone[0].toUpperCase() + zone.slice(1)}\n${lines.join('\n')}`
        : '';
    })
    .filter(Boolean)
    .join('\n\n');
}
