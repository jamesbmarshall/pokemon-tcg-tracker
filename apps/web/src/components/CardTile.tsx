import { memo, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Minus, Plus } from 'lucide-react';
import type { CardSnapshot, PokemonCard } from '../api/types';
import { toSnapshot } from '../api/client';
import CardImage from './CardImage';
import { ownedTotal, useCollectionStore, useGradedFor, useOwned, useReadOnly, useWished } from '../store/collectionStore';
import { usePublicShare } from './shareContext';
import { formatGrade } from '../utils/grading';
import { useMoney } from '../hooks/useMoney';
import { isFoil, variantLabel, variantShort } from '../utils/variants';
import { toast } from '../store/toastStore';

interface Props {
  card: PokemonCard | CardSnapshot;
  /** Dim cards you don't own (set checklists) */
  dimMissing?: boolean;
  showSet?: boolean;
  quickAdd?: boolean;
  index?: number;
  /** Show a single printing (master-set view): ownership, price and add button for just this variant. */
  variant?: string;
  /** Show wishlist and custom-list buttons on the tile (search results). */
  listActions?: boolean;
}
import AddToList from './AddToList';
import { foilLeave, foilMove } from '../utils/foil';
import { LanguageBadge } from './Language';

function CardTile({ card, dimMissing = false, showSet = false, quickAdd = false, index = 0, variant, listActions = false }: Props) {
  const s = useMemo(() => ('set' in card ? toSnapshot(card) : card), [card]);
  const owned = useOwned(s.id);
  const allSlabs = useGradedFor(s.id);
  const slabs = useMemo(() => (variant ? allSlabs.filter((g) => g.variant === variant) : allSlabs), [allSlabs, variant]);
  const wished = useWished(s.id);
  const adjust = useCollectionStore((st) => st.adjust);
  const toggleWishlist = useCollectionStore((st) => st.toggleWishlist);
  const readOnly = useReadOnly();
  const shared = usePublicShare();
  const money = useMoney();

  const qty = variant ? (owned?.[variant] ?? 0) : ownedTotal(owned);
  // Any slab means you own the card; the set-completion switch only affects progress.
  const total = qty + slabs.length;
  const isOwned = total > 0;
  const topSlab = slabs[0];
  const hasFoil = variant ? isOwned && isFoil(variant) : !!owned && Object.keys(owned).some(isFoil);
  const price = variant ? s.prices[variant] : Math.max(0, ...s.variants.map((v) => s.prices[v] ?? 0)) || undefined;
  const label = variant ? variantLabel(variant) : '';

  const change = async (variant: string, delta: number) => {
    const before = owned?.[variant] ?? 0;
    await adjust(s, variant, delta);
    if (delta < 0 && before === 1) {
      toast(`Removed ${s.name} (${variantLabel(variant)})`, { action: { label: 'Undo', run: () => adjust(s, variant, 1) } });
    }
  };

  return (
    <div
      id={variant ? `card-${s.id}--${variant}` : `card-${s.id}`}
      data-card={s.id}
      // Lift the tile above its neighbours while its lists menu is open, so the menu isn't covered.
      className="group relative animate-rise scroll-mt-24 has-[[aria-expanded=true]]:z-30"
      style={{ animationDelay: `${Math.min(index, 24) * 18}ms` }}
    >
      <CardLink
        to={shared ? undefined : `/card/${s.id}`}
        className="block focus-visible:outline-offset-4"
        label={`${s.name} ${s.number}${variant ? ` ${label}` : ''}, ${isOwned ? `owned ×${total}` : 'not owned'}${topSlab ? `, graded ${formatGrade(topSlab)}` : ''}`}
      >
        <div
          onPointerMove={foilMove}
          onPointerLeave={foilLeave}
          className={`relative aspect-[63/88] overflow-hidden rounded-[4.5%/3.2%] bg-surface-2 transition-all duration-300 group-hover:-translate-y-1 ${
            isOwned ? 'shadow-card ring-1 ring-accent/50' : 'ring-1 ring-line'
          } ${isOwned ? 'group-hover:shadow-card-lift' : ''}`}
        >
          <CardImage
            id={s.id}
            src={s.image}
            name={s.name}
            number={s.number}
            setName={s.setName}
            types={s.types}
            className={`transition-[filter,opacity] duration-300 ${dimMissing && !isOwned ? 'opacity-45 grayscale-[0.85] group-hover:opacity-90 group-hover:grayscale-0' : ''}`}
          />
          {(hasFoil || !dimMissing) && <div className="foil" style={{ opacity: hasFoil ? undefined : 'calc(var(--foil-o,0) * 0.35)' }} />}
          <div className="glare" />
          {qty > 0 && <span className="absolute right-1.5 top-1.5 animate-pop rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-on-accent shadow-md">×{qty}</span>}
          {topSlab && (
            <span
              className={`absolute bottom-1.5 left-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold shadow-md ${
                topSlab.countsTowardSet ? 'bg-fg text-canvas' : 'border border-dashed border-paper/70 bg-onyx/80 text-paper'
              }`}
              title={`${slabs.length} graded cop${slabs.length > 1 ? 'ies' : 'y'}${topSlab.countsTowardSet ? '' : ' · kept out of set progress'}`}
            >
              {formatGrade(topSlab)}
              {slabs.length > 1 && <span className="ml-1 opacity-60">+{slabs.length - 1}</span>}
            </span>
          )}
          <LanguageBadge id={s.id} className="absolute bottom-1.5 right-1.5" />
          {wished && !isOwned && !topSlab && (
            <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-onyx/80 text-blush" title="On wishlist">
              <Heart size={13} fill="currentColor" />
            </span>
          )}
        </div>
      </CardLink>

      <div className="mt-2 flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          {shared ? (
            <p className={`truncate text-[13px] font-medium leading-tight ${dimMissing && !isOwned ? 'text-muted' : ''}`}>{s.name}</p>
          ) : (
            <Link to={`/card/${s.id}`} className={`block truncate text-[13px] font-medium leading-tight hover:text-accent ${dimMissing && !isOwned ? 'text-muted' : ''}`}>
              {s.name}
            </Link>
          )}
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
            {showSet ? `${s.setName} · ` : ''}#{s.number}
            {variant && <span className={isOwned ? 'text-muted' : ''}> · {label}</span>}
          </p>
        </div>
        {price !== undefined && <span className="shrink-0 font-mono text-[11px] text-muted tabular">{money(price, { compact: true })}</span>}
      </div>

      {readOnly ? null : (
        <div className="mt-1.5 flex items-start gap-1 px-0.5 pointer-coarse:flex-wrap pointer-coarse:[&_button]:min-h-9 pointer-coarse:[&_button]:min-w-8">
          {variant ? (
            <div
              className={`flex min-w-0 flex-1 pointer-coarse:basis-full transition-opacity ${quickAdd || isOwned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100 pointer-coarse:opacity-100'}`}
            >
              <button
                onClick={() => change(variant, 1)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (qty) void change(variant, -1);
                }}
                title={`${label} — click to add${qty ? ', right-click to remove one' : ''}`}
                aria-label={`Add ${label}${qty ? ` (have ${qty})` : ''}`}
                className={`inline-flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[10px] font-semibold transition-all active:scale-90 ${
                  qty
                    ? isFoil(variant)
                      ? 'holo-bar border-transparent text-onyx'
                      : 'border-accent bg-accent text-on-accent'
                    : 'border-line bg-surface-2 text-muted hover:border-accent/60 hover:text-fg'
                } ${qty ? 'rounded-r-none' : ''}`}
              >
                <Plus size={10} strokeWidth={3} />
                {qty ? `${variantShort(variant)} ${qty}` : `Add ${variantShort(variant)}`}
              </button>
              {qty > 0 && (
                <button
                  onClick={() => change(variant, -1)}
                  aria-label={`Remove one ${label}`}
                  className="grid h-6 w-5 place-items-center rounded-r-md border border-l-0 border-line bg-surface-3 text-muted hover:text-loss"
                >
                  <Minus size={10} />
                </button>
              )}
            </div>
          ) : (
            <div
              className={`flex min-w-0 flex-1 flex-wrap gap-1 pointer-coarse:basis-full transition-opacity ${quickAdd || isOwned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100 pointer-coarse:opacity-100'}`}
            >
              {s.variants.map((v) => {
                const n = owned?.[v] ?? 0;
                return (
                  <span key={v} className="inline-flex">
                    <button
                      onClick={() => change(v, 1)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (n) void change(v, -1);
                      }}
                      title={`${variantLabel(v)} — click to add${n ? ', right-click to remove one' : ''}`}
                      aria-label={`Add ${variantLabel(v)}${n ? ` (have ${n})` : ''}`}
                      className={`h-6 rounded-md border px-1.5 font-mono text-[10px] font-semibold transition-all active:scale-90 ${
                        n
                          ? isFoil(v)
                            ? 'holo-bar border-transparent text-onyx'
                            : 'border-accent bg-accent text-on-accent'
                          : 'border-line bg-surface-2 text-muted hover:border-accent/60 hover:text-fg'
                      } ${n && quickAdd ? 'rounded-r-none' : ''}`}
                    >
                      {variantShort(v)}
                      {n > 1 && <span className="ml-0.5 opacity-70">{n}</span>}
                    </button>
                    {n > 0 && quickAdd && (
                      <button
                        onClick={() => change(v, -1)}
                        aria-label={`Remove one ${variantLabel(v)}`}
                        className="grid h-6 w-5 place-items-center rounded-r-md border border-l-0 border-line bg-surface-3 text-muted hover:text-loss"
                      >
                        <Minus size={10} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {listActions && !shared && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={async () => {
                  const on = await toggleWishlist(s);
                  toast(on ? `Added ${s.name} to wishlist` : `Removed ${s.name} from wishlist`, { tone: on ? 'success' : 'default' });
                }}
                aria-pressed={wished}
                aria-label={wished ? `Remove ${s.name} from wishlist` : `Add ${s.name} to wishlist`}
                title={wished ? 'On wishlist' : 'Add to wishlist'}
                className={`grid h-6 w-6 place-items-center rounded-md border transition-colors active:scale-90 ${
                  wished ? 'border-wish/40 bg-wish/10 text-wish' : 'border-line bg-surface-2 text-muted hover:border-wish/50 hover:text-wish'
                }`}
              >
                <Heart size={12} fill={wished ? 'currentColor' : 'none'} />
              </button>
              <AddToList card={s} compact />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The tile's image link; a plain block on public share pages, which have no card page to go to. */
function CardLink({ to, label, className, children }: { to?: string; label: string; className: string; children: ReactNode }) {
  if (!to) return <div role="img" aria-label={label} className={className}>{children}</div>;
  return (
    <Link to={to} className={className} aria-label={label}>
      {children}
    </Link>
  );
}

export default memo(CardTile);
