/**
 * Card variant (printing) labels and the collection entry key. Variant names come from TCGdex;
 * unknown ones still get a readable label so new printings don't need a code change.
 */
const VARIANT_LABELS: Record<string, string> = {
  normal: 'Normal',
  holofoil: 'Holo',
  reverseHolofoil: 'Reverse Holo',
  '1stEditionHolofoil': '1st Ed. Holo',
  '1stEditionNormal': '1st Edition',
  unlimited: 'Unlimited',
  unlimitedHolofoil: 'Unlimited Holo',
  wPromo: 'W Stamp Promo',
};

const VARIANT_SHORT: Record<string, string> = {
  normal: 'N',
  holofoil: 'H',
  reverseHolofoil: 'RH',
  '1stEditionHolofoil': '1H',
  '1stEditionNormal': '1E',
  unlimited: 'U',
  unlimitedHolofoil: 'UH',
  wPromo: 'W',
};

/** Human label for a variant; unknown camelCase names are split into words ("fooBar" -> "Foo Bar"). */
export function variantLabel(variant: string): string {
  return VARIANT_LABELS[variant] ?? variant.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

export function variantShort(variant: string): string {
  return VARIANT_SHORT[variant] ?? variant.slice(0, 2).toUpperCase();
}

export function isFoil(variant: string) {
  return /holo/i.test(variant);
}

/**
 * Id of a collection entry. One entry per card+variant, so the key is deterministic and the same
 * printing added twice updates one row instead of creating a duplicate. Must match entryKey in
 * @poketracker/shared/value, which the server uses.
 */
export function entryKey(cardId: string, variant: string): string {
  return `${cardId}::${variant}`;
}

/** Raw card conditions, best first, using the usual TCG grading shorthand. */
export const CONDITIONS = [
  { value: 'M', label: 'Mint' },
  { value: 'NM', label: 'Near Mint' },
  { value: 'LP', label: 'Lightly Played' },
  { value: 'MP', label: 'Moderately Played' },
  { value: 'HP', label: 'Heavily Played' },
  { value: 'DMG', label: 'Damaged' },
] as const;
