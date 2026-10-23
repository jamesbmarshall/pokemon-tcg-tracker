import { printingRoleLabel } from '@poketracker/shared/printings';
import { printingLabel } from '@poketracker/shared/printings';
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, Heart, Minus, Plus, Trash2 } from 'lucide-react';
import { useCard, usePrintings, useSetCards } from '../api/hooks';
import { langOf } from '../api/languages';
import { LanguageBadge } from '../components/Language';
import {
  cardVariants,
  compareCardNumber,
  toSnapshot,
  usdPrices,
} from '../api/client';
import {
  costBasis,
  entryValue,
  gradedValue,
  ownedTotal,
  useCollectionStore,
  useGradedFor,
  useOwned,
  useReadOnly,
  useWished,
} from '../store/collectionStore';
import AddToList from '../components/AddToList';
import { useFx, useMoney, useRates } from '../hooks/useMoney';
import {
  CardDetailLayout,
  CardDetailHeading,
  CardCollectionSection,
  CardFinishRow,
  CardMarket,
  CardDetailNavigation,
  CardPrintingStrip,
} from '../components/CardDetailLayout';
import { imageSrc } from '../api/client';
import { useSwipe } from '../hooks/useSwipe';
import { Gain, PaidInput } from '../components/Paid';
import { ManualBadge, ValueInput } from '../components/ValueOverride';
import PriceHistory from '../components/PriceHistory';
import { paidUsd } from '../utils/fx';
import { toast } from '../store/toastStore';
import HoloCard from '../components/HoloCard';
import GradedSection from '../components/GradedSection';
import CardNotes from '../components/CardNotes';
import { SetSymbol } from '../components/SetArt';
import { Energy, ErrorState, Skeleton } from '../components/ui';
import { CONDITIONS, isFoil, variantLabel } from '../utils/variants';
import { formatDate } from '../utils/format';
import type { Condition, PokemonCard } from '../api/types';

function VariantRow({ card, variant }: { card: PokemonCard; variant: string }) {
  const snap = useMemo(() => toSnapshot(card), [card]);
  const owned = useOwned(card.id);
  const entry = useCollectionStore((s) =>
    s.entries.get(`${card.id}::${variant}`),
  );
  const adjust = useCollectionStore((s) => s.adjust);
  const reassignEntry = useCollectionStore((s) => s.reassignEntry);
  const updateEntry = useCollectionStore((s) => s.updateEntry);
  const readOnly = useReadOnly();
  const money = useMoney();
  const { rates } = useFx();
  const n = owned?.[variant] ?? 0;
  const printing = card.printings?.find((p) => p.id === variant);
  const market = usdPrices(card)[variant];
  const low = card.tcgplayer?.prices[variant]?.low;
  const paidEach = n ? paidUsd(entry?.paid, rates) : undefined;
  const manualValue = n > 0 ? entry?.valueUsd : undefined;

  return (
    <CardFinishRow
      owned={n > 0}
      foil={isFoil(variant)}
      info={
        <>
          {' '}
          {!readOnly && n > 0 && !card.variants.includes(variant) && (
            <select
              aria-label={`Identify legacy ${variantLabel(variant)}`}
              className="input mb-2"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  void reassignEntry(card.id, variant, e.target.value);
              }}
            >
              <option value="">Identify this printing…</option>
              {card.printings?.map((p) => (
                <option key={p.id} value={p.id} disabled={!!owned?.[p.id]}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <p className="text-sm font-semibold">
            {printingLabel(card, variant) ?? variantLabel(variant)}
          </p>
          <p className="text-xs text-muted" title={printing?.decision?.reason}>
            {printing ? printingRoleLabel(printing) : ''}
          </p>
          {printing?.productIds?.tcgplayer && (
            <a
              className="text-xs text-muted hover:text-accent"
              href={`https://www.tcgplayer.com/product/${printing.productIds.tcgplayer}`}
              target="_blank"
              rel="noreferrer"
            >
              View this printing on TCGplayer
            </a>
          )}
          <p className="font-mono text-[11px] text-muted tabular">
            {manualValue != null ? (
              <>
                <span>{money(manualValue)}</span> your value{' '}
                <ManualBadge className="normal-case" />
              </>
            ) : market ? (
              `${money(market)} market`
            ) : (
              'No price data'
            )}
            {low ? ` · from ${money(low)}` : ''}
          </p>
          {paidEach != null && market != null && (
            <Gain
              valueUsd={(manualValue ?? market) * n}
              costUsd={paidEach * n}
              className="text-[11px]"
            />
          )}
        </>
      }
      controls={
        <>
          {' '}
          {readOnly ? (
            n > 0 && (
              <span className="font-mono text-sm font-bold tabular">
                ×{n}
                {entry?.condition && (
                  <span className="ml-2 text-xs font-normal text-muted">
                    {entry.condition}
                  </span>
                )}
              </span>
            )
          ) : (
            <>
              {n > 0 && entry && (
                <PaidInput
                  value={entry.paid}
                  label={`Paid per ${variantLabel(variant)} copy`}
                  onCommit={(paid) => {
                    void updateEntry(card.id, variant, { paid });
                    toast(
                      paid ? 'Purchase price saved' : 'Purchase price cleared',
                    );
                  }}
                />
              )}
              {n > 0 && entry && (
                <ValueInput
                  value={entry.valueUsd}
                  label={`Your value per ${variantLabel(variant)} copy`}
                  onCommit={(valueUsd) => {
                    void updateEntry(card.id, variant, { valueUsd });
                    toast(
                      valueUsd != null
                        ? 'Your value saved'
                        : 'Your value cleared',
                    );
                  }}
                />
              )}
              {n > 0 && entry && (
                <select
                  value={entry.condition ?? 'NM'}
                  onChange={(e) =>
                    updateEntry(card.id, variant, {
                      condition: e.target.value as Condition,
                    })
                  }
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
                <div className="flex items-center rounded-lg border border-line-strong">
                  <button
                    onClick={async () => {
                      await adjust(snap, variant, -1);
                      if (n === 1)
                        toast(`Removed ${variantLabel(variant)}`, {
                          action: {
                            label: 'Undo',
                            run: () => adjust(snap, variant, 1),
                          },
                        });
                    }}
                    className="grid h-8 w-8 place-items-center text-muted hover:text-fg"
                    aria-label={`Remove one ${variantLabel(variant)}`}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-7 text-center font-mono text-sm font-bold tabular">
                    {n}
                  </span>
                  <button
                    onClick={() => adjust(snap, variant, 1)}
                    className="grid h-8 w-8 place-items-center text-muted hover:text-fg"
                    aria-label={`Add one ${variantLabel(variant)}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => adjust(snap, variant, 1)}
                  className="btn btn-primary !h-8 !rounded-lg !px-3 !text-xs"
                >
                  <Plus size={14} /> Add
                </button>
              )}
            </>
          )}
        </>
      }
      history={<PriceHistory cardId={card.id} variant={variant} />}
    />
  );
}

function OtherPrintings({
  card,
  searchResults,
}: {
  card: PokemonCard;
  searchResults?: string;
}) {
  const { data } = usePrintings(card.name, langOf(card.id));
  const byCard = useCollectionStore((s) => s.byCard);
  const slabbed = useCollectionStore((s) => s.gradedByCard);
  const all = data?.filter((c) => c.id !== card.id) ?? [];
  const others = all.slice(0, 24);
  return (
    <CardPrintingStrip
      name={card.name}
      count={all.length}
      items={others.map((c) => ({
        id: c.id,
        url: `/card/${c.id}`,
        state: searchResults ? { searchResults } : undefined,
        name: c.name,
        image: c.image,
        number: c.number,
        setName: c.setName,
        caption: `${c.releaseDate.slice(0, 4)} · #${c.number}`,
        owned: byCard.has(c.id) || slabbed.has(c.id),
      }))}
    />
  );
}

export default function CardPage() {
  const { cardId = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const searchResults = (state as { searchResults?: string } | null)
    ?.searchResults;
  const {
    data: card,
    isLoading,
    error,
    refetch,
    isPlaceholderData,
  } = useCard(cardId);
  const setId = card?.set.id ?? '';
  const { data: setCards } = useSetCards(setId);
  const owned = useOwned(cardId);
  const slabs = useGradedFor(cardId);
  const wished = useWished(cardId);
  const readOnly = useReadOnly();
  const collectionLabel = useCollectionStore((s) => {
    const c = s.collections.find((x) => x.id === s.collectionId);
    return c && !(c.kind === 'personal' && c.mine)
      ? `In ${c.name}`
      : 'In your collection';
  });
  const toggleWishlist = useCollectionStore((s) => s.toggleWishlist);
  const removeCard = useCollectionStore((s) => s.removeCard);
  const restoreEntries = useCollectionStore((s) => s.restoreEntries);
  const remember = useCollectionStore((s) => s.remember);
  const money = useMoney();
  const { data: rates } = useRates();
  const allEntries = useCollectionStore((s) => s.entries);
  const fromEur = (eur?: number) =>
    eur == null ? undefined : eur / (rates?.EUR || 0.89);

  const list = useMemo(
    () => (setCards ? [...setCards].sort(compareCardNumber) : []),
    [setCards],
  );
  const { prev, next, pos } = useMemo(() => {
    const i = list.findIndex((c) => c.id === cardId);
    return {
      prev: i > 0 ? list[i - 1] : undefined,
      next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined,
      pos: i,
    };
  }, [list, cardId]);

  // Keep the local snapshot (and its price) fresh whenever an owned or wishlisted card is viewed
  useEffect(() => {
    if (card && !isPlaceholderData && (owned || wished)) void remember([card]);
  }, [card, isPlaceholderData, owned, wished, remember]);

  // `dir` tells the incoming card which side to slide in from.
  const go = (to: PokemonCard | undefined, dir: 1 | -1) =>
    to && navigate(`/card/${to.id}`, { state: { dir, searchResults } });
  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: () => go(next, 1),
    onSwipeRight: () => go(prev, -1),
  });

  const slide = (state as { dir?: number } | null)?.dir;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'ArrowLeft' && prev)
        navigate(`/card/${prev.id}`, { state: { dir: -1, searchResults } });
      if (e.key === 'ArrowRight' && next)
        navigate(`/card/${next.id}`, { state: { dir: 1, searchResults } });
      if (
        e.key === 'Escape' &&
        setId &&
        !document.querySelector('[role="dialog"]')
      )
        navigate(searchResults ?? `/sets/${setId}`, {
          state: { fromCard: cardId },
        });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate, setId, cardId, searchResults]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,420px)_1fr]">
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
      <ErrorState
        title="Couldn't load this card"
        error={error}
        onRetry={() => refetch()}
      >
        <Link to={searchResults ?? '/sets'} className="btn btn-ghost">
          {searchResults ? 'Back to search results' : 'Browse sets'}
        </Link>
      </ErrorState>
    );
  }

  const variants = [
    ...new Set([
      ...cardVariants(card),
      ...Object.keys(owned ?? {}),
      ...slabs.map((g) => g.variant),
    ]),
  ];
  const rawTotal = ownedTotal(owned);
  // Slabs are owned copies whether or not they count towards set completion.
  const total = rawTotal + slabs.length;
  const snap = toSnapshot(card);
  const cardsMap = new Map([[card.id, snap]]);
  const cardEntries = Array.from(allEntries.values()).filter(
    (e) => e.cardId === card.id,
  );
  // Each owned variant's contribution uses its manual override (entryValue) when set, else market price.
  const ownedValue =
    cardEntries.reduce(
      (s, e) => s + (entryValue(e, cardsMap) ?? 0) * e.quantity,
      0,
    ) + slabs.reduce((s, g) => s + gradedValue(g, cardsMap), 0);
  const cost = rates
    ? costBasis(cardEntries, cardsMap, slabs, rates)
    : undefined;
  const hasManualValue =
    cardEntries.some((e) => e.valueUsd != null) ||
    slabs.some((g) => g.valueUsd != null);
  const foilish =
    /holo|rare|ex|illustration|secret|ultra|gx|vmax|vstar/i.test(
      card.rarity ?? '',
    ) || variants.some(isFoil);

  return (
    <CardDetailLayout
      swipeRef={swipeRef}
      canBrowse={!!(prev || next)}
      preload={
        <>
          {' '}
          <div hidden aria-hidden="true">
            {[prev, next].map((neighbour, i) => (
              <img
                key={i}
                src={
                  neighbour?.images.large
                    ? imageSrc(neighbour.images.large)
                    : undefined
                }
                alt=""
                decoding="async"
              />
            ))}
          </div>
        </>
      }
      navigation={
        <CardDetailNavigation
          setUrl={`/sets/${card.set.id}`}
          setName={card.set.name}
          cardId={card.id}
          searchResults={searchResults}
          symbol={
            <SetSymbol
              src={card.set.images.symbol}
              className="h-5 w-5 shrink-0 object-contain"
            />
          }
          badge={<LanguageBadge id={card.id} />}
          previous={!!prev}
          next={!!next}
          position={pos}
          total={setCards?.length ?? 0}
          onPrevious={() => go(prev, -1)}
          onNext={() => go(next, 1)}
        />
      }
      artwork={
        <div
          key={card.id}
          className={`card-artwork mx-auto ${slide === 1 ? 'animate-slide-from-right' : slide === -1 ? 'animate-slide-from-left' : ''}`}
        >
          <HoloCard
            id={card.id}
            src={card.images.large}
            name={card.name}
            number={card.number}
            setName={card.set.name}
            types={card.types}
            foil={foilish}
          />
        </div>
      }
      otherPrintings={
        <OtherPrintings card={card} searchResults={searchResults} />
      }
    >
      <CardDetailHeading
        setLabel={
          <Link
            to={`/sets/${card.set.id}`}
            state={{ fromCard: card.id }}
            className="truncate text-fg hover:text-accent"
          >
            #{card.number}/{card.set.printedTotal} · {card.set.name}
          </Link>
        }
        release={card.set.releaseDate.slice(0, 4)}
        typeLine={
          <>
            {card.supertype}
            {card.subtypes?.length ? ` · ${card.subtypes.join(' · ')}` : ''}
          </>
        }
        rarity={
          <>
            {card.rarity && <span>{card.rarity}</span>}
            {card.regulationMark && (
              <span className="grid h-4 min-w-4 place-items-center rounded-sm border border-line-strong px-0.5 font-mono text-[9.5px] text-fg">
                {card.regulationMark}
              </span>
            )}
          </>
        }
        title={card.name}
        stats={
          <>
            {card.hp && (
              <span className="flex items-baseline gap-1.5 font-display text-2xl font-medium tabular">
                <span className="font-label text-[10px] font-semibold text-muted">
                  HP
                </span>
                {card.hp}
              </span>
            )}
            {card.types?.map((t) => (
              <Energy key={t} type={t} size={24} />
            ))}
          </>
        }
        artist={
          card.artist && (
            <Link
              to={`/search?artist=${encodeURIComponent(card.artist)}`}
              className="italic hover:text-accent"
            >
              Illus. {card.artist}
            </Link>
          )
        }
      />

      {/* Collection */}
      <CardCollectionSection
        label={collectionLabel}
        summary={
          <>
            {' '}
            {total ? (
              <>
                {total} {total === 1 ? 'copy' : 'copies'}{' '}
                <span className="text-muted">· {money(ownedValue)}</span>
                {hasManualValue && (
                  <ManualBadge className="ml-1.5 align-middle normal-case" />
                )}
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
          </>
        }
        cost={
          <>
            {' '}
            {cost && cost.costed > 0 && (
              <p className="mt-1 text-xs text-muted">
                Paid {money(cost.costUsd)}
                {cost.costed < total
                  ? ` for ${cost.costed} of ${total}`
                  : ''} ·{' '}
                <Gain valueUsd={cost.valueUsd} costUsd={cost.costUsd} icon />
              </p>
            )}
          </>
        }
        actions={
          <>
            {' '}
            {!readOnly && (
              <div className="flex gap-2">
                <AddToList card={card} />
                <button
                  onClick={async () => {
                    const on = await toggleWishlist(card);
                    toast(on ? 'Added to wishlist' : 'Removed from wishlist', {
                      tone: on ? 'success' : 'default',
                    });
                  }}
                  className={`btn !h-9 !text-xs ${wished ? 'border border-wish/40 bg-wish/10 text-wish' : 'btn-ghost'}`}
                  aria-pressed={wished}
                >
                  <Heart size={14} fill={wished ? 'currentColor' : 'none'} />{' '}
                  {wished ? 'Wishlisted' : 'Wishlist'}
                </button>
                {rawTotal > 0 && (
                  <button
                    onClick={async () => {
                      const removed = await removeCard(card.id);
                      toast(`Removed all ${card.name}`, {
                        action: {
                          label: 'Undo',
                          run: () => restoreEntries(removed),
                        },
                      });
                    }}
                    className="btn btn-ghost !h-9 !w-9 !p-0 hover:!text-loss"
                    aria-label="Remove all copies"
                    title="Remove all copies"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
          </>
        }
      >
        {variants.map((v) => (
          <VariantRow key={v} card={card} variant={v} />
        ))}
      </CardCollectionSection>

      {variants.some((v) => !card.variants.includes(v)) && (
        <p className="text-sm text-muted">
          Some owned entries use legacy printing labels. They are preserved, but
          need identification before they count towards completion.
        </p>
      )}
      <GradedSection card={card} />

      <CardNotes key={card.id} cardId={card.id} />

      {/* Market */}
      {(card.tcgplayer || card.cardmarket) && (
        <CardMarket
          links={
            <>
              {card.tcgplayer?.url && (
                <a
                  href={card.tcgplayer.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                >
                  TCGplayer <ExternalLink size={12} />
                </a>
              )}
              {card.cardmarket && (
                <a
                  href={card.cardmarket.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                >
                  Cardmarket <ExternalLink size={12} />
                </a>
              )}
            </>
          }
          columns={[
            <>
              TCGplayer{' '}
              <span className="normal-case tracking-normal text-faint">
                (US)
              </span>
            </>,
            <>
              Cardmarket{' '}
              <span className="normal-case tracking-normal text-faint">
                (EU)
              </span>
            </>,
            'From',
          ]}
          rows={Array.from(
            new Set([
              ...variants,
              ...Object.keys(card.tcgplayer?.prices ?? {}),
            ]),
          ).map((v) => {
            const t = card.tcgplayer?.prices[v],
              c = card.cardmarket?.prices[v];
            const lows = [t?.low, fromEur(c?.low)].filter(
              (x): x is number => !!x,
            );
            return {
              id: v,
              label: printingLabel(card, v) ?? variantLabel(v),
              values: [
                money(t?.market ?? t?.mid),
                money(fromEur(c?.market ?? c?.mid)),
                <span className="font-normal text-muted">
                  {money(lows.length ? Math.min(...lows) : undefined)}
                </span>,
              ],
            };
          })}
          note={
            <>
              TCGplayer market and Cardmarket trend prices, converted at
              today&apos;s rate. Updated{' '}
              {formatDate(
                card.tcgplayer?.updatedAt || card.cardmarket?.updatedAt || '',
              )}
              .
            </>
          }
        />
      )}

      {/* Gameplay */}
      {(card.abilities?.length ||
        card.attacks?.length ||
        card.rules?.length) && (
        <section>
          <h2 className="mb-2 font-display text-2xl font-medium">Card text</h2>
          <div className="divide-y divide-line border-y border-line">
            {card.abilities?.map((a) => (
              <div key={a.name} className="py-4">
                <p className="text-sm">
                  <span className="mr-2 rounded bg-[#e0483b] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {a.type}
                  </span>
                  <span className="font-semibold">{a.name}</span>
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {a.text}
                </p>
              </div>
            ))}
            {card.attacks?.map((a) => (
              <div key={a.name} className="py-4">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {a.cost.map((c, i) => (
                      <Energy key={i} type={c} size={18} />
                    ))}
                  </div>
                  <p className="flex-1 font-semibold">{a.name}</p>
                  {a.damage && (
                    <p className="font-display text-2xl font-medium tabular">
                      {a.damage}
                    </p>
                  )}
                </div>
                {a.text && (
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {a.text}
                  </p>
                )}
              </div>
            ))}
            {card.rules?.map((r, i) => (
              <p key={i} className="py-3 text-xs leading-relaxed text-muted">
                {r}
              </p>
            ))}
          </div>
        </section>
      )}

      {(card.weaknesses || card.resistances || card.retreatCost) && (
        <section className="grid grid-cols-3 divide-x divide-line border-y border-line">
          {[
            { label: 'Weakness', items: card.weaknesses },
            { label: 'Resistance', items: card.resistances },
          ].map(({ label, items }) => (
            <div key={label} className="px-4 py-3 first:pl-0">
              <p className="eyebrow">{label}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {items?.length ? (
                  items.map((w) => (
                    <span
                      key={w.type}
                      className="flex items-center gap-1 font-mono text-sm"
                    >
                      <Energy type={w.type} size={18} /> {w.value}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-faint">—</span>
                )}
              </div>
            </div>
          ))}
          <div className="px-4 py-3">
            <p className="eyebrow">Retreat</p>
            <div className="mt-2 flex gap-1">
              {card.retreatCost?.length ? (
                card.retreatCost.map((c, i) => (
                  <Energy key={i} type={c} size={18} />
                ))
              ) : (
                <span className="text-sm text-faint">—</span>
              )}
            </div>
          </div>
        </section>
      )}

      {card.flavorText && (
        <blockquote className="border-l-2 border-line-strong pl-4 font-display text-base italic text-muted">
          {card.flavorText}
        </blockquote>
      )}
    </CardDetailLayout>
  );
}
