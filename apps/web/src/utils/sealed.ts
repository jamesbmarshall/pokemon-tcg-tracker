/** Sealed-product reference data: human-readable labels for each product type. */
import type { SealedProductType } from '../api/types';

export const PRODUCT_TYPES: { value: SealedProductType; label: string }[] = [
  { value: 'booster_box', label: 'Booster box' },
  { value: 'etb', label: 'Elite Trainer Box' },
  { value: 'booster_bundle', label: 'Booster bundle' },
  { value: 'tin', label: 'Tin' },
  { value: 'collection_box', label: 'Collection box' },
  { value: 'blister', label: 'Blister pack' },
  { value: 'booster_pack', label: 'Booster pack' },
  { value: 'other', label: 'Other' },
];

export const PRODUCT_TYPE_LABEL: Record<SealedProductType, string> = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.value, t.label])) as Record<SealedProductType, string>;
