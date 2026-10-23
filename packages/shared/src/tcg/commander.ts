import type {
  DeckItem,
  DeckIssue,
  DeckResult,
  MagicDetails,
  TcgCard,
  Holding,
} from './types';
export const COMMANDER_RULES_VERSION = 1;
const details = (c: TcgCard) => c.details as unknown as MagicDetails;
const text = (c: TcgCard) => c.faces.map((f) => f.text).join('\n');
const type = (c: TcgCard) => details(c).typeLine ?? '';
export function commanderEligible(c: TcgCard) {
  return (
    (/Legendary/.test(c.faces[0]?.typeLine ?? type(c)) &&
      /Creature/.test(c.faces[0]?.typeLine ?? type(c))) ||
    /can be your commander/i.test(text(c)) ||
    /Legendary.*Background/.test(type(c))
  );
}
function pairs(a: TcgCard, b: TcgCard): boolean {
  const at = text(a),
    bt = text(b);
  const keyword = (c: TcgCard, k: string) =>
    details(c).keywords?.includes(k) ?? false;
  if (
    keyword(a, 'Partner') &&
    keyword(b, 'Partner') &&
    !/Partner with /.test(at + bt)
  )
    return true;
  if (keyword(a, 'Friends forever') && keyword(b, 'Friends forever'))
    return true;
  if (
    at.includes(`Partner with ${b.name}`) &&
    bt.includes(`Partner with ${a.name}`)
  )
    return true;
  if (
    (keyword(a, 'Choose a Background') &&
      /Legendary.*Background/.test(type(b))) ||
    (keyword(b, 'Choose a Background') && /Legendary.*Background/.test(type(a)))
  )
    return true;
  const doctor = (c: TcgCard) =>
    /Legendary Creature — (?:Time Lord Doctor|Doctor Time Lord)$/.test(
      c.faces[0]?.typeLine ?? '',
    );
  return (
    (keyword(a, "Doctor's companion") && doctor(b)) ||
    (keyword(b, "Doctor's companion") && doctor(a))
  );
}
export function checkCommander(
  items: DeckItem[],
  cards: Map<string, TcgCard>,
): DeckResult {
  const issues: DeckIssue[] = [];
  const add = (
    code: string,
    message: string,
    ids: string[] = [],
    unverified = false,
  ) =>
    issues.push({
      code,
      message,
      cardIds: ids,
      ...(unverified ? { unverified } : {}),
    });
  const active = items.filter((i) => i.zone !== 'maybeboard' && i.quantity > 0);
  const missing = active.filter(
    (i) => !cards.has(i.cardId) || cards.get(i.cardId)?.details.kind !== 'mtg',
  );
  if (missing.length)
    add(
      'metadata',
      'Card details are missing; legality could not be verified.',
      missing.map((i) => i.cardId),
      true,
    );
  const playable = active.filter(
    (i) => cards.has(i.cardId) && cards.get(i.cardId)?.details.kind === 'mtg',
  );
  const commanders = playable.filter((i) => i.zone === 'commander');
  const total = active
    .filter((i) => i.zone !== 'companion')
    .reduce((n, i) => n + i.quantity, 0);
  if (total !== 100)
    add(
      'deck-size',
      `Deck has ${total} cards including commanders; it needs exactly 100.`,
    );
  if (
    commanders.length < 1 ||
    commanders.length > 2 ||
    commanders.some((i) => i.quantity !== 1)
  )
    add('commander-count', 'Choose one commander or one permitted pair.');
  for (const i of commanders)
    if (!commanderEligible(cards.get(i.cardId)!))
      add(
        'commander-eligibility',
        `${cards.get(i.cardId)!.name} cannot be a commander.`,
        [i.cardId],
      );
  if (
    commanders.length === 1 &&
    /Background/.test(type(cards.get(commanders[0].cardId)!)) &&
    !/Creature/.test(type(cards.get(commanders[0].cardId)!)) &&
    !/can be your commander/i.test(text(cards.get(commanders[0].cardId)!))
  )
    add(
      'commander-eligibility',
      'A Background needs a commander with Choose a Background.',
    );
  if (
    commanders.length === 2 &&
    !pairs(cards.get(commanders[0].cardId)!, cards.get(commanders[1].cardId)!)
  )
    add(
      'commander-pair',
      'These cards do not form a permitted commander pair.',
      commanders.map((i) => i.cardId),
    );
  const identity = new Set(
    commanders.flatMap(
      (i) => details(cards.get(i.cardId)!).colorIdentity ?? [],
    ),
  );
  const identityKnown =
    commanders.length > 0 &&
    commanders.every(
      (i) => details(cards.get(i.cardId)!).rulesComplete !== false,
    );
  const groups = new Map<string, { card: TcgCard; count: number }>();
  for (const i of playable) {
    const c = cards.get(i.cardId)!,
      d = details(c);
    if (
      d.rulesComplete === false ||
      !d.legalities?.commander ||
      !Array.isArray(d.colorIdentity)
    )
      add(
        'metadata',
        `${c.name}: Commander data is unavailable.`,
        [c.id],
        true,
      );
    else {
      if (d.legalities.commander !== 'legal')
        add(
          'format-illegal',
          `${c.name} is ${d.legalities.commander.replaceAll('_', ' ')} in Commander.`,
          [c.id],
        );
      if (
        identityKnown &&
        d.colorIdentity.some((color) => !identity.has(color))
      )
        add(
          'color-identity',
          `${c.name} is outside the commander's color identity.`,
          [c.id],
        );
    }
    if (i.zone === 'companion') continue;
    const key = c.identity;
    const group = groups.get(key) ?? { card: c, count: 0 };
    group.count += i.quantity;
    groups.set(key, group);
  }
  // Explicit Oracle-text exceptions avoid per-printing copy limits and stale card-name lists.
  const numbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
  };
  for (const { card: c, count } of groups.values()) {
    if (
      /\bBasic\b.*\bLand\b/.test(type(c)) ||
      /A deck can have any number of cards named/i.test(text(c))
    )
      continue;
    const m = /A deck can have up to (\w+) cards named/i.exec(text(c));
    const limit = m ? (numbers[m[1].toLowerCase()] ?? Number(m[1])) : 1;
    if (!Number.isFinite(limit))
      add(
        'copy-rule',
        `${c.name}: copy exception needs verification.`,
        [c.id],
        true,
      );
    else if (count > limit)
      add(
        'copy-limit',
        `${c.name}: ${count} copies exceeds the ${limit}-copy limit.`,
        [c.id],
      );
  }
  const companions = playable.filter((i) => i.zone === 'companion');
  if (companions.length > 1 || companions.some((i) => i.quantity !== 1))
    add('companion-count', 'A deck can have at most one companion.');
  for (const i of companions) {
    const c = cards.get(i.cardId)!;
    if (!(details(c).keywords ?? []).includes('Companion'))
      add('companion', `${c.name} does not have Companion.`, [c.id]);
    else {
      const starting = playable
        .filter((item) => item.zone !== 'companion')
        .map((item) => ({
          card: cards.get(item.cardId)!,
          quantity: item.quantity,
        }));
      const nonlands = starting.filter(
        ({ card }) => !/\bLand\b/.test(card.faces[0]?.typeLine ?? type(card)),
      );
      const costs = (card: TcgCard) =>
        (card.faces[0]?.manaCost ?? '').match(/\{[^}]+\}/g) ?? [];
      const activated = (card: TcgCard) =>
        card.faces.some(
          (face) =>
            /[^\n]+:\s*\S/.test(face.text) ||
            /\b(?:Cycling|Equip|Transmute|Unearth|Ninjutsu|Reinforce|Transfigure|Level up|Outlast|Scavenge|Embalm|Eternalize|Encore|Boast|Reconfigure|Channel|Craft|Crew)\b/i.test(
              face.text,
            ),
        ) ||
        (/\bLand\b/.test(card.faces[0]?.typeLine ?? type(card)) &&
          (details(card).producedMana?.length ?? 0) > 0);
      let allowed: boolean | undefined;
      switch (c.faces[0]?.name ?? c.name) {
        case 'Gyruda, Doom of Depths':
          allowed = starting.every(
            ({ card }) => details(card).manaValue % 2 === 0,
          );
          break;
        case 'Obosh, the Preypiercer':
          allowed = nonlands.every(
            ({ card }) => details(card).manaValue % 2 === 1,
          );
          break;
        case 'Lurrus of the Dream-Den':
          allowed = starting
            .filter(({ card }) =>
              /\b(?:Artifact|Battle|Creature|Enchantment|Planeswalker)\b/.test(
                card.faces[0]?.typeLine ?? type(card),
              ),
            )
            .every(({ card }) => details(card).manaValue <= 2);
          break;
        case 'Keruga, the Macrosage':
          allowed = nonlands.every(({ card }) => details(card).manaValue >= 3);
          break;
        case 'Jegantha, the Wellspring':
          allowed = starting.every(({ card }) => {
            const symbols = costs(card);
            return new Set(symbols).size === symbols.length;
          });
          break;
        case 'Zirda, the Dawnwaker':
          allowed = starting
            .filter(({ card }) =>
              /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/.test(
                card.faces[0]?.typeLine ?? type(card),
              ),
            )
            .every(({ card }) => activated(card));
          break;
        case 'Lutri, the Spellchaser': {
          const identities = nonlands.flatMap(({ card, quantity }) =>
            Array.from({ length: Math.min(quantity, 2) }, () => card.identity),
          );
          allowed = new Set(identities).size === identities.length;
          break;
        }
        case 'Yorion, Sky Nomad':
          allowed = false;
          break;
        case 'Umori, the Collector': {
          const types = [
            'Artifact',
            'Battle',
            'Creature',
            'Enchantment',
            'Instant',
            'Kindred',
            'Planeswalker',
            'Sorcery',
          ];
          allowed = types.some((t) =>
            nonlands.every(({ card }) =>
              new RegExp(`\\b${t}\\b`).test(
                card.faces[0]?.typeLine ?? type(card),
              ),
            ),
          );
          break;
        }
        case 'Kaheera, the Orphanguard': {
          allowed = starting
            .filter(({ card }) =>
              /\bCreature\b/.test(card.faces[0]?.typeLine ?? type(card)),
            )
            .every(
              ({ card }) =>
                /\b(?:Cat|Elemental|Nightmare|Dinosaur|Beast)\b/.test(
                  card.faces[0]?.typeLine ?? type(card),
                ) || /\bChangeling\b/.test(text(card)),
            );
          break;
        }
      }
      // Oracle-text heuristics cannot prove all activated-ability and characteristic rules.
      if (allowed === undefined || c.name === 'Zirda, the Dawnwaker')
        add(
          'companion-condition',
          `${c.name}: its companion condition needs manual verification.`,
          [c.id],
          true,
        );
      else if (!allowed)
        add(
          'companion-condition',
          `${c.name}: the starting deck does not meet its companion condition.`,
          [c.id],
        );
    }
    if (groups.has(c.identity))
      add('companion-copy', `${c.name} also appears in the starting deck.`, [
        c.id,
      ]);
  }
  return {
    status: issues.some((i) => !i.unverified)
      ? 'illegal'
      : issues.length
        ? 'unverified'
        : 'legal',
    issues,
  };
}
export function deckOwnership(
  items: DeckItem[],
  cards: Map<string, TcgCard>,
  holdings: Holding[],
) {
  const groups = new Map<
    string,
    {
      name: string;
      cardId: string;
      needed: number;
      owned: number;
      missing: number;
    }
  >();
  for (const i of items.filter((i) => i.zone !== 'maybeboard')) {
    const c = cards.get(i.cardId);
    if (!c) continue;
    const g = groups.get(c.identity) ?? {
      name: c.name,
      cardId: c.id,
      needed: 0,
      owned: 0,
      missing: 0,
    };
    g.needed += i.quantity;
    groups.set(c.identity, g);
  }
  for (const h of holdings) {
    const c = cards.get(h.cardId);
    if (!c?.paper) continue;
    const g = groups.get(c.identity);
    if (g) g.owned += h.quantity;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    missing: Math.max(0, g.needed - g.owned),
  }));
}
export function deckAnalysis(items: DeckItem[], cards: Map<string, TcgCard>) {
  const curve: Record<string, number> = {},
    colors: Record<string, number> = {},
    types: Record<string, number> = {};
  for (const i of items.filter(
    (i) => i.zone === 'main' || i.zone === 'commander',
  )) {
    const c = cards.get(i.cardId);
    if (!c) continue;
    const d = details(c);
    if (!/\bLand\b/.test(d.typeLine)) {
      const bucket = d.manaValue >= 7 ? '7+' : String(d.manaValue);
      curve[bucket] = (curve[bucket] ?? 0) + i.quantity;
    }
    for (const color of d.colors ?? [])
      colors[color] = (colors[color] ?? 0) + i.quantity;
    // One primary category per card prevents artifact creatures inflating the deck total.
    const category =
      [
        'Land',
        'Creature',
        'Planeswalker',
        'Battle',
        'Instant',
        'Sorcery',
        'Artifact',
        'Enchantment',
      ].find((t) => new RegExp(`\\b${t}\\b`).test(d.typeLine)) ?? 'Other';
    types[category] = (types[category] ?? 0) + i.quantity;
  }
  return { curve, colors, types };
}
