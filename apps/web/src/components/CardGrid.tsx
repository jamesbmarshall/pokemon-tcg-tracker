import type { CardSnapshot, PokemonCard } from '../api/types';
import CardTile from './CardTile';

export interface GridTile {
  card: PokemonCard | CardSnapshot;
  /** When set, the tile represents this single printing of the card. */
  variant?: string;
}

export default function CardGrid({
  cards,
  tiles,
  dimMissing,
  showSet,
  quickAdd,
}: {
  cards?: (PokemonCard | CardSnapshot)[];
  tiles?: GridTile[];
  dimMissing?: boolean;
  showSet?: boolean;
  quickAdd?: boolean;
}) {
  const items: GridTile[] = tiles ?? (cards ?? []).map((card) => ({ card }));
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
      {items.map(({ card, variant }, i) => (
        <CardTile key={variant ? `${card.id}::${variant}` : card.id} card={card} variant={variant} index={i} dimMissing={dimMissing} showSet={showSet} quickAdd={quickAdd} />
      ))}
    </div>
  );
}
