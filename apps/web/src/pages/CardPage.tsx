import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Heart, Minus, Plus, Trash2 } from 'lucide-react';
import { useCard, usePrintings, useSetCards } from '../api/hooks';
import { langOf } from '../api/languages';
import { LanguageBadge } from '../components/Language';
import { cardVariants, compareCardNumber, toSnapshot, usdPrices } from '../api/client';
import { costBasis, ownedTotal, priceOf, useCollectionStore, useGradedFor, useOwned, useWished } from '../store/collectionStore';
import { useFx, useMoney, useRates } from '../hooks/useMoney';
import { useSwipe } from '../hooks/useSwipe';
import { Gain, PaidInput } from '../components/Paid';
import { paidUsd } from '../utils/fx';
import { toast } from '../store/toastStore';
import HoloCard from '../components/HoloCard';
import GradedSection from '../components/GradedSection';
import CardNotes from '../components/CardNotes';
import CardImage from '../components/CardImage';
import { SetSymbol } from '../components/SetArt';
import { Energy, ErrorState, Skeleton } from '../components/ui';
import { typeColor } from '../utils/energy';
import { CONDITIONS, isFoil, variantLabel } from '../utils/variants';
import { formatDate } from '../utils/format';
import type { Condition, PokemonCard } from '../api/types';

function VariantRow({ card, variant }: { card: PokemonCard; variant: string }) {
  const snap = useMemo(() => toSnapshot(card), [card]);
  const owned = useOwned(card.id);
  const entry = useCollectionStore((s) => s.entries.get(`${card.id}::${variant}`));
  const adjust = useCollectionStore((s) => s.adjust);
  const updateEntry = useCollectionStore((s) => s.updateEntry);
  const money = useMoney();
  const { rates } = useFx();
  const n = owned?.[variant] ?? 0;
  const market = usdPrices(card)[variant];
  const low = card.tcgplayer?.prices[variant]?.low;
  const paidEach = n ? paidUsd(entry?.paid, rates) : undefined;

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 transition-colors ${n ? 'bg-volt/[0.06]' : ''}`}>
      <span className={`h-8 w-1 rounded-full ${n ? (isFoil(variant) ? 'holo-bar' : 'bg-volt') : 'bg-surface-3'}`} />
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold">{variantLabel(variant)}</p>
        <p className="font-mono text-[11px] text-muted tabular">
          {market ? `${money(market)} market` : 'No price data'}
          {low ? ` · from ${money(low)}` : ''}
        </p>
        {paidEach != null && market != null && <Gain valueUsd={market * n} costUsd={paidEach * n} className="text-[11px]" />}
      </div>
      {n > 0 && entry && (
        <PaidInput
          value={entry.paid}
          label={`Paid per ${variantLabel(variant)} copy`}
          onCommit={(paid) => {
            void updateEntry(card.id, variant, { paid });
            toast(paid ? 'Purchase price saved' : 'Purchase price cleared');
          }}
        />
      )}
      {n > 0 && entry && (
        <select
          value={entry.condition ?? 'NM'}
          onChange={(e) => updateEntry(card.id, variant, { condition: e.target.value as Condition })}
          className="input !h-8 !w-auto !rounded-lg !px-2 !text-xs"
          aria-label="Condition"
        >
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value} · {c.label}
            </option>
          ))}
        </select>
      )}
      {n > 0 ? (
        <div className="flex items-center rounded-xl border border-line bg-surface-2">
          <button
            onClick={async () => {
              await adjust(snap, variant, -1);
              if (n === 1) toast(`Removed ${variantLabel(variant)}`, { action: { label: 'Undo', run: () => adjust(snap, variant, 1) } });
            }}
            className="grid h-8 w-8 place-items-center text-muted hover:text-fg"
            aria-label={`Remove one ${variantLabel(variant)}`}
          >
            <Minus size={14} />
          </button>
          <span className="w-7 text-center font-mono text-sm font-bold tabular">{n}</span>
          <button onClick={() => adjust(snap, variant, 1)} className="grid h-8 w-8 place-items-center text-muted hover:text-fg" aria-label={`Add one ${variantLabel(variant)}`}>
            <Plus size={14} />
          </button>
        </div>
      ) : (
        <button onClick={() => adjust(snap, variant, 1)} className="btn btn-primary !h-8 !rounded-lg !px-3 !text-xs">
          <Plus size={14} /> Add
        </button>
      )}
    </div>
  );
}

function OtherPrintings({ card }: { card: PokemonCard }) {
  const { data } = usePrintings(card.name, langOf(card.id));
  const byCard = useCollectionStore((s) => s.byCard);
  const slabbed = useCollectionStore((s) => s.gradedByCard);
  const all = data?.filter((c) => c.id !== card.id) ?? [];
  const others = all.slice(0, 24);
  if (!others.length) return null;
  return (
    <section>
      <h2 className="mb-4 font-display text-xl font-semibold">
        Other {card.name} printings <span className="font-mono text-sm text-faint">{all.length}</span>
      </h2>
      <div className="scroll-x -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {others.map((c) => (
          <Link key={c.id} to={`/card/${c.id}`} className="group w-[112px] shrink-0 snap-start">
            <div className={`aspect-[63/88] overflow-hidden rounded-[4.5%/3.2%] ring-1 transition-transform group-hover:-translate-y-1 ${byCard.has(c.id) || slabbed.has(c.id) ? 'ring-volt/60' : 'ring-line'}`}>
              <CardImage id={c.id} src={c.image} name={c.name} number={c.number} setName={c.setName} />
            </div>
            <p className="mt-1.5 truncate text-[11px] text-muted">{c.setName}</p>
            <p className="font-mono text-[10px] text-faint">{c.releaseDate.slice(0, 4)} · #{c.number}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function CardPage() {
  const { cardId = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { data: card, isLoading, error, refetch } = useCard(cardId);
  const setId = card?.set.id ?? '';
  const { data: setCards } = useSetCards(setId);
  const owned = useOwned(cardId);
  const slabs = useGradedFor(cardId);
  const wished = useWished(cardId);
  const toggleWishlist = useCollectionStore((s) => s.toggleWishlist);
  const removeCard = useCollectionStore((s) => s.removeCard);
  const restoreEntries = useCollectionStore((s) => s.restoreEntries);
  const remember = useCollectionStore((s) => s.remember);
  const money = useMoney();
  const { data: rates } = useRates();
  const allEntries = useCollectionStore((s) => s.entries);
  const fromEur = (eur?: number) => (eur == null ? undefined : eur / (rates?.EUR || 0.89));

  const { prev, next, pos } = useMemo(() => {
    const list = setCards ? [...setCards].sort(compareCardNumber) : [];
    const i = list.findIndex((c) => c.id === cardId);
    return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined, pos: i };
  }, [setCards, cardId]);

  // Keep the local snapshot (and its price) fresh whenever an owned or wishlisted card is viewed
  useEffect(() => {
    if (card && (owned || wished)) void remember([card]);
  }, [card, owned, wished, remember]);

  // `dir` tells the incoming card which side to slide in from.
  const go = (to: PokemonCard | undefined, dir: 1 | -1) => to && navigate(`/card/${to.id}`, { state: { dir } });
  const swipeRef = useSwipe<HTMLDivElement>({ onSwipeLeft: () => go(next, 1), onSwipeRight: () => go(prev, -1) });
  const slide = (state as { dir?: number } | null)?.dir;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'ArrowLeft' && prev) navigate(`/card/${prev.id}`, { state: { dir: -1 } });
      if (e.key === 'ArrowRight' && next) navigate(`/card/${next.id}`, { state: { dir: 1 } });
      if (e.key === 'Escape' && setId && !document.querySelector('[role="dialog"]')) navigate(`/sets/${setId}`, { state: { fromCard: cardId } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate, setId, cardId]);

  if (isLoading) {
    return (
      <div className="grid gap-10 md:grid-cols-[minmax(0,420px)_1fr]">
        <Skeleton className="aspect-[63/88]" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }
  if (error || !card) {
    return (
      <ErrorState title="Couldn't load this card" error={error} onRetry={() => refetch()}>
        <Link to="/sets" className="btn btn-ghost">
          Browse sets
        </Link>
      </ErrorState>
    );
  }

  const variants = cardVariants(card);
  const rawTotal = ownedTotal(owned);
  // Slabs are owned copies whether or not they count towards set completion.
  const total = rawTotal + slabs.length;
  const snap = toSnapshot(card);
  const ownedValue =
    (owned ? Object.entries(owned).reduce((s, [v, q]) => s + (priceOf(snap, v) ?? 0) * q, 0) : 0) +
    slabs.reduce((s, g) => s + (g.valueUsd ?? priceOf(snap, g.variant) ?? 0), 0);
  const cardEntries = Array.from(allEntries.values()).filter((e) => e.cardId === card.id);
  const cost = rates ? costBasis(cardEntries, new Map([[card.id, snap]]), slabs, rates) : undefined;
  const accent = typeColor(card.types?.[0]);
  const foilish = /holo|rare|ex|illustration|secret|ultra|gx|vmax|vstar/i.test(card.rarity ?? '') || variants.some(isFoil);

  return (
    <div ref={swipeRef} className="space-y-12">
      <div className="flex items-center justify-between gap-4">
        <Link
          to={`/sets/${card.set.id}`}
          state={{ fromCard: card.id }}
          title="Back to set (Esc)"
          className="group inline-flex min-w-0 items-center gap-2.5 rounded-full border border-line bg-surface/60 py-1.5 pl-2 pr-4 text-sm transition hover:border-volt/50 hover:bg-surface focus-visible:outline-offset-2"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink/60 text-muted transition group-hover:-translate-x-0.5 group-hover:text-volt">
            <ChevronLeft size={16} />
          </span>
          <SetSymbol src={card.set.images.symbol} className="h-5 w-5 shrink-0 object-contain" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Back to set</span>
            <span className="truncate font-medium text-fg">{card.set.name}</span>
          </span>
          <LanguageBadge id={card.id} />
        </Link>
        <div className="flex items-center gap-1">
          <button disabled={!prev} onClick={() => go(prev, -1)} className="btn btn-ghost !h-9 !w-9 !p-0" aria-label="Previous card">
            <ChevronLeft size={16} />
          </button>
          {pos >= 0 && setCards && (
            <span className="px-2 font-mono text-xs text-faint tabular">
              {pos + 1}/{setCards.length}
            </span>
          )}
          <button disabled={!next} onClick={() => go(next, 1)} className="btn btn-ghost !h-9 !w-9 !p-0" aria-label="Next card">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="relative grid gap-10 md:grid-cols-[minmax(0,400px)_1fr] lg:gap-16">
        <div className="pointer-events-none absolute -left-20 -top-20 h-[420px] w-[420px] rounded-full opacity-25 blur-[100px]" style={{ background: accent }} />
        <div className="relative mx-auto w-full max-w-[400px] md:sticky md:top-10 md:self-start">
          <div key={card.id} className={slide === 1 ? 'animate-slide-from-right' : slide === -1 ? 'animate-slide-from-left' : undefined}>
            <HoloCard id={card.id} src={card.images.large} name={card.name} number={card.number} setName={card.set.name} types={card.types} foil={foilish} />
          </div>
          <p className="mt-4 text-center text-xs text-faint pointer-coarse:hidden">Move your pointer over the card</p>
          {(prev || next) && <p className="mt-4 hidden text-center text-xs text-faint pointer-coarse:block">Swipe left or right to browse the set</p>}
        </div>

        <div className="relative min-w-0 space-y-8">
          <div>
            <p className="eyebrow">
              {card.supertype}
              {card.subtypes?.length ? ` · ${card.subtypes.join(' · ')}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{card.name}</h1>
              {card.hp && (
                <span className="flex items-center gap-2 font-display text-2xl font-bold">
                  <span className="text-xs font-semibold text-muted">HP</span>
                  {card.hp}
                </span>
              )}
              {card.types?.map((t) => <Energy key={t} type={t} size={26} />)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Link to={`/sets/${card.set.id}`} state={{ fromCard: card.id }} className="font-mono underline decoration-line underline-offset-4 hover:text-fg hover:decoration-volt">
                #{card.number}/{card.set.printedTotal} · {card.set.name}
              </Link>
              {card.rarity && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs">{card.rarity}</span>}
              {card.regulationMark && <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px]">{card.regulationMark}</span>}
              {card.artist && (
                <Link to={`/search?artist=${encodeURIComponent(card.artist)}`} className="text-xs hover:text-volt">
                  Illus. {card.artist}
                </Link>
              )}
            </div>
          </div>

          {/* Collection */}
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="eyebrow">In your collection</p>
                <p className="mt-1 font-display text-xl font-semibold">
                  {total ? (
                    <>
                      {total} {total === 1 ? 'copy' : 'copies'} <span className="text-muted">· {money(ownedValue)}</span>
                      {slabs.length > 0 && (
                        <span className="ml-2 align-middle text-xs font-normal text-muted">
                          {rawTotal ? `${rawTotal} raw · ` : ''}
                          {slabs.length} graded
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted">Not owned yet</span>
                  )}
                </p>
                {cost && cost.costed > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Paid {money(cost.costUsd)}
                    {cost.costed < total ? ` for ${cost.costed} of ${total}` : ''} · <Gain valueUsd={cost.valueUsd} costUsd={cost.costUsd} icon />
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const on = await toggleWishlist(card);
                    toast(on ? 'Added to wishlist' : 'Removed from wishlist', { tone: on ? 'success' : 'default' });
                  }}
                  className={`btn !h-9 !text-xs ${wished ? 'border border-[#ff6fae]/40 bg-[#ff6fae]/15 text-[#ff8fc0]' : 'btn-ghost'}`}
                  aria-pressed={wished}
                >
                  <Heart size={14} fill={wished ? 'currentColor' : 'none'} /> {wished ? 'Wishlisted' : 'Wishlist'}
                </button>
                {rawTotal > 0 && (
                  <button
                    onClick={async () => {
                      const removed = await removeCard(card.id);
                      toast(`Removed all ${card.name}`, { action: { label: 'Undo', run: () => restoreEntries(removed) } });
                    }}
                    className="btn btn-ghost !h-9 !w-9 !p-0 hover:!text-loss"
                    aria-label="Remove all copies"
                    title="Remove all copies"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="p-2">
              {variants.map((v) => (
                <VariantRow key={v} card={card} variant={v} />
              ))}
            </div>
          </section>

          <GradedSection card={card} />

          <CardNotes key={card.id} cardId={card.id} />

          {/* Market */}
          {(card.tcgplayer || card.cardmarket) && (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">Market</h2>
                <div className="flex gap-3">
                  {card.tcgplayer?.url && (
                    <a href={card.tcgplayer.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-volt">
                      TCGplayer <ExternalLink size={12} />
                    </a>
                  )}
                  {card.cardmarket && (
                    <a href={card.cardmarket.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-volt">
                      Cardmarket <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left">
                    <tr className="eyebrow">
                      <th className="px-4 py-2.5 font-normal">Variant</th>
                      <th className="px-4 py-2.5 text-right font-normal">
                        TCGplayer <span className="normal-case tracking-normal text-faint">(US)</span>
                      </th>
                      <th className="px-4 py-2.5 text-right font-normal">
                        Cardmarket <span className="normal-case tracking-normal text-faint">(EU)</span>
                      </th>
                      <th className="px-4 py-2.5 text-right font-normal">From</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line font-mono tabular">
                    {Array.from(new Set([...variants, ...Object.keys(card.tcgplayer?.prices ?? {})])).map((v) => {
                      const t = card.tcgplayer?.prices[v];
                      const c = card.cardmarket?.prices[v];
                      const lows = [t?.low, fromEur(c?.low)].filter((x): x is number => !!x);
                      return (
                        <tr key={v}>
                          <td className="px-4 py-2.5 font-sans">{variantLabel(v)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{money(t?.market ?? t?.mid)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{money(fromEur(c?.market ?? c?.mid))}</td>
                          <td className="px-4 py-2.5 text-right text-muted">{money(lows.length ? Math.min(...lows) : undefined)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-faint">
                TCGplayer market and Cardmarket trend prices, converted at today&apos;s rate. Updated{' '}
                {formatDate(card.tcgplayer?.updatedAt || card.cardmarket?.updatedAt || '')}.
              </p>
            </section>
          )}

          {/* Gameplay */}
          {(card.abilities?.length || card.attacks?.length || card.rules?.length) && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold">Card text</h2>
              {card.abilities?.map((a) => (
                <div key={a.name} className="panel p-4">
                  <p className="text-sm">
                    <span className="mr-2 rounded bg-[#e0483b] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{a.type}</span>
                    <span className="font-semibold">{a.name}</span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{a.text}</p>
                </div>
              ))}
              {card.attacks?.map((a) => (
                <div key={a.name} className="panel p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {a.cost.map((c, i) => (
                        <Energy key={i} type={c} size={18} />
                      ))}
                    </div>
                    <p className="flex-1 font-semibold">{a.name}</p>
                    {a.damage && <p className="font-display text-xl font-bold">{a.damage}</p>}
                  </div>
                  {a.text && <p className="mt-2 text-sm leading-relaxed text-muted">{a.text}</p>}
                </div>
              ))}
              {card.rules?.map((r, i) => (
                <p key={i} className="rounded-xl border border-line px-4 py-3 text-xs leading-relaxed text-muted">
                  {r}
                </p>
              ))}
            </section>
          )}

          {(card.weaknesses || card.resistances || card.retreatCost) && (
            <section className="grid grid-cols-3 gap-3">
              {[
                { label: 'Weakness', items: card.weaknesses },
                { label: 'Resistance', items: card.resistances },
              ].map(({ label, items }) => (
                <div key={label} className="panel p-3">
                  <p className="eyebrow">{label}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {items?.length
                      ? items.map((w) => (
                          <span key={w.type} className="flex items-center gap-1 font-mono text-sm">
                            <Energy type={w.type} size={18} /> {w.value}
                          </span>
                        ))
                      : <span className="text-sm text-faint">—</span>}
                  </div>
                </div>
              ))}
              <div className="panel p-3">
                <p className="eyebrow">Retreat</p>
                <div className="mt-2 flex gap-1">
                  {card.retreatCost?.length ? card.retreatCost.map((c, i) => <Energy key={i} type={c} size={18} />) : <span className="text-sm text-faint">—</span>}
                </div>
              </div>
            </section>
          )}

          {card.flavorText && <blockquote className="border-l-2 border-volt/40 pl-4 text-sm italic text-muted">{card.flavorText}</blockquote>}
        </div>
      </div>

      <OtherPrintings card={card} />
    </div>
  );
}
