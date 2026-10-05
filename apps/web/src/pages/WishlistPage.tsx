import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShareButton } from '../components/ShareDialog';
import { Check, Heart, X } from 'lucide-react';
import { useCollectionStore, useReadOnly } from '../store/collectionStore';
import { useMoney } from '../hooks/useMoney';
import { useViewPref } from '../hooks/useViewPrefs';
import { EmptyState, PageHeader, Segmented } from '../components/ui';
import CardImage from '../components/CardImage';
import { toast } from '../store/toastStore';
import { variantLabel } from '../utils/variants';
import type { CardSnapshot } from '../api/types';

const cheapest = (c: CardSnapshot) => {
  const entries = Object.entries(c.prices).filter(([, p]) => p > 0);
  if (!entries.length) return undefined;
  return entries.reduce((a, b) => (b[1] < a[1] ? b : a));
};

export default function WishlistPage() {
  const wishlist = useCollectionStore((s) => s.wishlist);
  const cards = useCollectionStore((s) => s.cards);
  const byCard = useCollectionStore((s) => s.byCard);
  const slabs = useCollectionStore((s) => s.gradedByCard);
  const toggleWishlist = useCollectionStore((s) => s.toggleWishlist);
  const adjust = useCollectionStore((s) => s.adjust);
  const readOnly = useReadOnly();
  const money = useMoney();
  const [sort, setSort] = useViewPref<'added' | 'price'>('wishlist.sort', 'added', ['added', 'price']);

  const items = useMemo(() => {
    const list = Array.from(wishlist.values())
      .map((w) => ({ w, card: cards.get(w.cardId) }))
      .filter((x): x is { w: typeof x.w; card: CardSnapshot } => !!x.card);
    if (sort === 'price') list.sort((a, b) => (cheapest(b.card)?.[1] ?? 0) - (cheapest(a.card)?.[1] ?? 0));
    else list.sort((a, b) => b.w.addedAt.localeCompare(a.w.addedAt));
    return list;
  }, [wishlist, cards, sort]);

  const total = items.reduce((s, x) => s + (cheapest(x.card)?.[1] ?? 0), 0);

  if (wishlist.size === 0) {
    return (
      <EmptyState icon={<Heart size={28} />} title="No chase cards yet" action={<Link to="/search" className="btn btn-primary">Find cards</Link>}>
        Tap <b>Wishlist</b> on any card page to keep track of what you're hunting. You'll see the running cost to pick them all up.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${wishlist.size} card${wishlist.size > 1 ? 's' : ''}`}
        title="Wishlist"
        actions={
          <div className="flex items-center gap-4">
            <ShareButton scope="wishlist" what="your wishlist" compact />
            <Segmented
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'added', label: 'Newest' },
                { value: 'price', label: 'Price' },
              ]}
            />
            <div className="text-right">
              <p className="eyebrow">To buy them all</p>
              <p className="font-display text-2xl font-bold tabular">{money(total)}</p>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-7">
        {items.map(({ card }, i) => {
          const best = cheapest(card);
          const owned = byCard.has(card.id) || slabs.has(card.id);
          return (
            <div key={card.id} className="group animate-rise" style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
              <Link to={`/card/${card.id}`} className="relative block">
                <div className="aspect-[63/88] overflow-hidden rounded-[4.5%/3.2%] ring-1 ring-[#ff6fae]/30 transition-transform duration-300 group-hover:-translate-y-1">
                  <CardImage id={card.id} src={card.image} name={card.name} number={card.number} setName={card.setName} types={card.types} alt={card.name} />
                </div>
                {owned && <span className="absolute left-1.5 top-1.5 rounded-full bg-volt px-2 py-0.5 text-[10px] font-bold text-ink">Owned</span>}
              </Link>
              <p className="mt-2 truncate text-[13px] font-medium">{card.name}</p>
              <p className="truncate font-mono text-[10.5px] text-faint">
                {card.setName} · #{card.number}
              </p>
              <p className="mt-1 font-mono text-xs tabular">
                {best ? (
                  <>
                    {money(best[1])} <span className="text-faint">{variantLabel(best[0])}</span>
                  </>
                ) : (
                  <span className="text-faint">No price</span>
                )}
              </p>
              <div hidden={readOnly} className="mt-2 flex gap-1.5">
                <button
                  onClick={async () => {
                    const v = best?.[0] ?? card.variants[0];
                    await adjust(card, v, 1);
                    await toggleWishlist(card);
                    toast(`Got it! ${card.name} moved to your collection`, { tone: 'success' });
                  }}
                  className="btn btn-primary !h-8 flex-1 !rounded-lg !px-2 !text-xs"
                >
                  <Check size={13} /> Got it
                </button>
                <button
                  onClick={async () => {
                    await toggleWishlist(card);
                    toast(`Removed ${card.name}`, { action: { label: 'Undo', run: () => void toggleWishlist(card) } });
                  }}
                  className="btn btn-ghost !h-8 !w-8 !rounded-lg !p-0"
                  aria-label="Remove from wishlist"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
