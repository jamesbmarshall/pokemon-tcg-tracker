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

export function variantLabel(variant: string): string {
  return VARIANT_LABELS[variant] ?? variant.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

export function variantShort(variant: string): string {
  return VARIANT_SHORT[variant] ?? variant.slice(0, 2).toUpperCase();
}

export function isFoil(variant: string) {
  return /holo/i.test(variant);
}

export function entryKey(cardId: string, variant: string): string {
  return `${cardId}::${variant}`;
}

export const CONDITIONS = [
  { value: 'M', label: 'Mint' },
  { value: 'NM', label: 'Near Mint' },
  { value: 'LP', label: 'Lightly Played' },
  { value: 'MP', label: 'Moderately Played' },
  { value: 'HP', label: 'Heavily Played' },
  { value: 'DMG', label: 'Damaged' },
] as const;
