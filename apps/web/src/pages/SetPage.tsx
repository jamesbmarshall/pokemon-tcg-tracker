import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ShareButton } from '../components/ShareDialog';
import { ArrowUpDown, ChevronLeft, Grid3x3, LayoutGrid, Search, X, Zap } from 'lucide-react';
import { useSet, useSetCards } from '../api/hooks';
import { cardVariants, toSnapshot } from '../api/client';
import { gradedValue, priceOf, useCollectionStore, useReadOnly } from '../store/collectionStore';
import { SetLogo, SetSymbol } from '../components/SetArt';
import { useSettings } from '../store/settingsStore';
import { useMoney } from '../hooks/useMoney';
import { useViewPref } from '../hooks/useViewPrefs';
import { LanguageBadge } from '../components/Language';
import CardGrid, { type GridTile } from '../components/CardGrid';
import BinderView from '../components/BinderView';
import { CardSkeletonGrid, Segmented, Skeleton, ErrorState } from '../components/ui';
import { isBaseCard, setProgress } from '../utils/progress';
import { formatDate } from '../utils/format';
import type { PokemonCard } from '../api/types';

type Show = 'all' | 'owned' | 'missing' | 'wishlist';
type Sort = 'number' | 'name' | 'rarity';

/** Rough rarity tier so "Rarity" sorts chase cards first rather than alphabetically. */
const RARITY_TIERS: [RegExp, number][] = [
  [/hyper|secret|gold|mega hyper/i, 9],
  [/special illustration/i, 8],
  [/illustration|full art|trainer gallery|shiny ultra|amazing|crown/i, 7],
  [/ultra|double|vmax|vstar|\bv\b|ex|gx|legend|prime|lv\.x|ace spec|radiant|shiny/i, 6],
  [/holo/i, 4],
  [/^rare$/i, 3],
  [/uncommon/i, 2],
  [/common/i, 1],
];
const rarityTier = (r?: string) => (r ? (RARITY_TIERS.find(([re]) => re.test(r))?.[1] ?? 5) : 0);

export default function SetPage() {
  const { setId = '' } = useParams();
  const { data: set, isLoading: setLoading, error: setError, refetch: refetchSet } = useSet(setId);
  const { data: cards = [], isLoading, error, refetch } = useSetCards(setId);
  const byCard = useCollectionStore((s) => s.holdings);
  const slabs = useCollectionStore((s) => s.gradedByCard);
  const graded = useCollectionStore((s) => s.graded);
  const wishlist = useCollectionStore((s) => s.wishlist);
  const entries = useCollectionStore((s) => s.entries);
  const snapshots = useCollectionStore((s) => s.cards);
  const { setView, setSetView, setMode, setSetMode, quickAdd, setQuickAdd, pocketSize } = useSettings();
  const readOnly = useReadOnly();
  const money = useMoney();

  const [show, setShow] = useViewPref<Show>('set.show', 'all', ['all', 'owned', 'missing', 'wishlist']);
  const [sort, setSort] = useViewPref<Sort>('set.sort', 'number', ['number', 'name', 'rarity']);
  const [rarity, setRarity] = useState('');
  const [q, setQ] = useState('');

  const progress = useMemo(() => setProgress(cards, byCard), [cards, byCard]);
  const rarities = useMemo(() => Array.from(new Set(cards.map((c) => c.rarity).filter(Boolean) as string[])), [cards]);

  const ownedValue = useMemo(() => {
    let usd = 0;
    for (const e of entries.values()) if (e.setId === setId) usd += (priceOf(snapshots.get(e.cardId), e.variant) ?? 0) * e.quantity;
    for (const g of graded.values()) if (g.setId === setId) usd += gradedValue(g, snapshots);
    return usd;
  }, [entries, graded, snapshots, setId]);

  const master = setMode === 'master';
  // Base hides secret rares, unless the set has no numbered cards to show at all.
  const baseOnly = setMode === 'base' && progress.base.total > 0;

  /** One tile per card, or per printing in master mode so every gap is visible on the grid. */
  const tiles = useMemo<(GridTile & { card: PokemonCard })[]>(() => {
    const needle = q.trim().toLowerCase();
    const list = cards.filter((c) => {
      if (baseOnly && !isBaseCard(c)) return false;
      if (rarity && c.rarity !== rarity) return false;
      if (needle && !c.name.toLowerCase().includes(needle) && c.number !== needle) return false;
      if (show === 'wishlist') return wishlist.has(c.id);
      return true;
    });
    if (sort === 'rarity') list.sort((a, b) => rarityTier(b.rarity) - rarityTier(a.rarity) || a.number.localeCompare(b.number, undefined, { numeric: true }));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    const out = master ? list.flatMap((card) => cardVariants(card).map((variant) => ({ card, variant }))) : list.map((card) => ({ card, variant: undefined as string | undefined }));
    return out.filter(({ card, variant }) => {
      const held = byCard.get(card.id);
      // Display-only slabs still mean you own the card, but they don't fill a gap in the set.
      if (show === 'owned') return variant ? !!held?.[variant] || !!slabs.get(card.id)?.some((g) => g.variant === variant) : !!held || slabs.has(card.id);
      if (show === 'missing') return variant ? !held?.[variant] : !held;
      return true;
    });
  }, [cards, rarity, q, show, sort, byCard, slabs, wishlist, master, baseOnly]);

  // Returning from a card: bring its tile back into view and briefly highlight it.
  const fromCard = (useLocation().state as { fromCard?: string } | null)?.fromCard;
  useEffect(() => {
    if (!fromCard || !tiles.length) return;
    const el = [...document.querySelectorAll<HTMLElement>('[data-card]')].find((e) => e.dataset.card === fromCard);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });
    el.querySelector('a')?.focus({ preventScroll: true });
    el.dataset.flash = '';
    const t = setTimeout(() => delete el.dataset.flash, 1600);
    return () => clearTimeout(t);
  }, [fromCard, tiles.length]);

  const slots = useMemo(
    () => tiles.map(({ card, variant }) => ({ card: toSnapshot(card), variant, owned: variant ? !!byCard.get(card.id)?.[variant] : byCard.has(card.id) })),
    [tiles, byCard],
  );

  const modes = [
    { key: 'base' as const, label: 'Base', hint: 'Numbered cards', ...progress.base },
    { key: 'full' as const, label: 'Full', hint: 'Incl. secret rares', ...progress.full },
    { key: 'master' as const, label: 'Master', hint: 'Every variant', ...progress.master },
  ];

  if (setError || error) {
    return (
      <ErrorState
        title="Couldn't load this set"
        error={setError || error}
        onRetry={() => {
          if (setError) void refetchSet();
          if (error) void refetch();
        }}
      >
        <Link to="/sets" className="btn btn-ghost">
          Back to sets
        </Link>
      </ErrorState>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/sets" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft size={16} /> Sets
      </Link>

      {/* Header */}
      {setLoading || !set ? (
        <Skeleton className="h-52" />
      ) : (
        <section className="grid gap-8 border-b border-line pb-8 pt-2 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-14">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <SetLogo
              src={set.images.logo}
              name={set.name}
              className="h-20 w-auto max-w-[220px] object-contain drop-shadow-logo"
              fallbackClassName="hidden"
            />
            <div>
              <p className="eyebrow flex items-center gap-2">
                <SetSymbol src={set.images.symbol} className="h-3.5 w-3.5 object-contain" />
                {set.series}
                {set.ptcgoCode && <span className="font-mono normal-case tracking-normal text-faint">· {set.ptcgoCode}</span>}
              </p>
              <h1 className="mt-2 flex items-center gap-3 font-display text-[2.1rem] font-medium leading-tight tracking-tight sm:text-[2.6rem]">
                {set.name}
                <LanguageBadge id={set.id} className="!text-xs" />
              </h1>
              <p className="mt-1.5 text-sm text-muted">
                Released {formatDate(set.releaseDate)} · {set.printedTotal} cards
                {set.total > set.printedTotal && ` + ${set.total - set.printedTotal} secret`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {ownedValue > 0 && (
                  <p className="text-xs text-muted">
                    Your copies are worth <span className="font-mono text-fg">{money(ownedValue)}</span>
                  </p>
                )}
                <ShareButton scope="set" target={set.id} what={`your ${set.name} cards`} compact />
              </div>
            </div>
          </div>
          <div role="group" aria-label="Completion" className="grid grid-cols-3 border-t border-line">
            {modes.map((m) => {
              const active = setMode === m.key;
              const p = m.total ? Math.floor((m.owned / m.total) * 100) : 0;
              return (
                <button
                  key={m.key}
                  onClick={() => setSetMode(m.key)}
                  aria-pressed={active}
                  title={`${m.label}: ${m.hint.toLowerCase()}`}
                  className={`group relative flex flex-col items-start px-3 pb-1 pt-3 text-left transition-colors first:pl-0 disabled:cursor-default ${active ? 'text-fg' : 'text-muted enabled:hover:text-fg'}`}
                >
                  <span className={`absolute inset-x-0 -top-px h-[2px] ${active ? 'bg-accent' : 'bg-transparent'}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{m.label}</span>
                  <span className="mt-1 font-display text-[1.9rem] font-medium leading-none tabular">{isLoading ? '–' : `${p}%`}</span>
                  <span className="mt-1.5 font-mono text-[10.5px] text-muted tabular">{isLoading ? '…' : `${m.owned}/${m.total}`}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Toolbar */}
      <div className="sticky top-14 z-20 -mx-4 space-y-3 border-b border-line bg-canvas/95 px-4 py-3 lg:top-0">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Show>
            size="sm"
            value={show}
            onChange={setShow}
            options={[
              { value: 'all', label: `All ${(master ? progress.master.total : baseOnly ? progress.base.total : cards.length) || ''}` },
              { value: 'owned', label: 'Owned' },
              { value: 'missing', label: 'Missing', title: master ? 'Variants you don’t have yet' : 'Cards with no copies' },
              { value: 'wishlist', label: 'Wishlist' },
            ]}
          />
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or #" className="input !h-9 !w-40 !pl-8 !text-xs" />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint" aria-label="Clear">
                <X size={13} />
              </button>
            )}
          </div>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} className="input !h-9 !w-auto !text-xs" aria-label="Rarity">
            <option value="">All rarities</option>
            {rarities.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label className="relative inline-flex items-center">
            <ArrowUpDown size={13} className="pointer-events-none absolute left-2.5 text-faint" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input !h-9 !w-auto !pl-8 !text-xs" aria-label="Sort">
              <option value="number">Number</option>
              <option value="rarity">Rarity</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              hidden={readOnly}
              onClick={() => setQuickAdd(!quickAdd)}
              aria-pressed={quickAdd}
              title="Quick add: variant buttons always visible, with − to remove. Ideal while opening packs."
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                quickAdd ? 'border-accent bg-accent text-on-accent' : 'border-line-strong text-muted hover:text-fg'
              }`}
            >
              <Zap size={14} fill={quickAdd ? 'currentColor' : 'none'} /> Quick add
            </button>
            <Segmented
              size="sm"
              value={setView}
              onChange={setSetView}
              options={[
                { value: 'grid', label: <LayoutGrid size={14} />, title: 'Grid' },
                { value: 'binder', label: <Grid3x3 size={14} />, title: 'Binder pages' },
              ]}
            />
          </div>
        </div>
        {quickAdd && (
          <p className="text-[11px] text-muted">
            <span className="text-accent">Quick add is on.</span>{' '}
            {master ? (
              <>
                Every printing has its own tile. Tap <b>Add</b> under one to add a copy; use − to take one off.
              </>
            ) : (
              <>
                Tap <b>N</b> (normal), <b>RH</b> (reverse holo) or <b>H</b> (holo) under a card to add a copy; use − to take one off.
              </>
            )}
          </p>
        )}
      </div>

      {isLoading ? (
        <CardSkeletonGrid />
      ) : tiles.length === 0 ? (
        <p className="border-y border-line py-12 text-center text-sm text-muted">
          {show === 'missing' ? 'Nothing missing here. Lovely.' : show === 'owned' ? 'You don’t own any cards from this set yet.' : 'No cards match these filters.'}
        </p>
      ) : setView === 'binder' ? (
        <BinderView slots={slots} pocketSize={pocketSize} />
      ) : (
        <CardGrid tiles={tiles} dimMissing quickAdd={quickAdd} />
      )}
    </div>
  );
}
