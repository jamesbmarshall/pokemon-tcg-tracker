import { describe, expect, it } from 'vitest';
import { usdPrices } from './catalog';
import type { PokemonCard } from './types';

type Priced = Pick<PokemonCard, 'tcgplayer' | 'cardmarket' | 'variants'>;

const base = (over: Partial<Priced> = {}): Priced => ({ variants: ['normal'], ...over });

describe('usdPrices fallback precedence', () => {
  it('prefers TCGplayer market price over everything else', () => {
    const card = base({
      tcgplayer: { url: '', updatedAt: '', prices: { normal: { market: 12.5 } } },
      cardmarket: { url: '', updatedAt: '', prices: { normal: { market: 99 } } },
    });
    expect(usdPrices(card, 999)).toEqual({ normal: 12.5 });
  });

  it('falls back to converted Cardmarket when TCGplayer has no price for a variant', () => {
    const card = base({ cardmarket: { url: '', updatedAt: '', prices: { normal: { market: 8.9 } } } });
    // 8.9 EUR converted at the 0.89 fallback rate used when no live FX rate is cached.
    expect(usdPrices(card, 999)).toEqual({ normal: 10 });
  });

  it('falls back to the PriceCharting price only when TCGdex has nothing at all for a variant', () => {
    const card = base();
    expect(usdPrices(card, 15)).toEqual({ normal: 15 });
  });

  it('leaves a variant unpriced when TCGdex has nothing and no PriceCharting price was supplied', () => {
    const card = base();
    expect(usdPrices(card)).toEqual({});
  });

  it('applies the PriceCharting fallback per-variant independently of TCGplayer/Cardmarket coverage', () => {
    const card = base({
      variants: ['normal', 'holofoil'],
      tcgplayer: { url: '', updatedAt: '', prices: { normal: { market: 3 } } },
    });
    expect(usdPrices(card, 20)).toEqual({ normal: 3, holofoil: 20 });
  });
});
