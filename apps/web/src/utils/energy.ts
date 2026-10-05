/** Energy-type icons and CSS colour tokens, used for type badges and card placeholders. */
import { Droplet, Eye, Flame, Hand, Hexagon, Leaf, Moon, Sparkles, Star, Swords, Zap, type LucideIcon } from 'lucide-react';

export const TYPE_META: Record<string, { icon: LucideIcon; color: string }> = {
  Grass: { icon: Leaf, color: 'var(--color-grass)' },
  Fire: { icon: Flame, color: 'var(--color-fire)' },
  Water: { icon: Droplet, color: 'var(--color-water)' },
  Lightning: { icon: Zap, color: 'var(--color-lightning)' },
  Psychic: { icon: Eye, color: 'var(--color-psychic)' },
  Fighting: { icon: Hand, color: 'var(--color-fighting)' },
  Darkness: { icon: Moon, color: 'var(--color-darkness)' },
  Metal: { icon: Hexagon, color: 'var(--color-metal)' },
  Dragon: { icon: Swords, color: 'var(--color-dragon)' },
  Fairy: { icon: Sparkles, color: 'var(--color-fairy)' },
  Colorless: { icon: Star, color: 'var(--color-colorless)' },
};

export const ENERGY_TYPES = Object.keys(TYPE_META);

/** Colour token for a card type. Unknown or missing types fall back to Colorless rather than no colour. */
export function typeColor(type?: string) {
  return (type && TYPE_META[type]?.color) || 'var(--color-colorless)';
}

