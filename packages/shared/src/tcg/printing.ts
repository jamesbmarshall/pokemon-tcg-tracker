/** Physical identity is independent of finish, price and completion policy. */
export interface CollectibleVariant {
  id: string;
  label: string;
  finish: string;
  size: string;
  stamp?: string;
  edition?: string;
  treatments?: string[];
  distribution: 'expansion' | 'exclusive' | 'unknown';
  status: 'verified' | 'inferred' | 'unverified';
  /** Eligibility can change without changing this variant's identity. */
  role?: 'core' | 'parallel' | 'additional' | 'unresolved';
  decision?: {
    policyVersion: number;
    rule: string;
    reason: string;
    profile?: string;
    peers?: number;
    occurrences?: number;
    products?: string[];
  };
  dataQuality?: 'detailed' | 'generated' | 'flags' | 'invalid' | 'conflict';
  sourceProduct?: string;
  evidence?: string;
  providerId?: string;
  legacyAliases?: string[];
  raw?: { type: string; subtype?: string; size?: string; stamp?: string | string[]; foil?: string };
  productIds?: { tcgplayer?: number; cardmarket?: number; cardtrader?: number };
}
