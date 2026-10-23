import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Copy,
  ExternalLink,
  Heart,
  ListPlus,
  Minus,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import type {
  Holding,
  Slab,
  TcgCard,
  DeckZone,
} from '@poketracker/shared/tcg/types';
import type { PriceHistorySeries } from '../api/types';
import { cardValue, holdingId } from '@poketracker/shared/tcg/collection';
import {
  CardDetailLayout,
  CardDetailHeading,
  CardCollectionSection,
  CardFinishRow,
  CardMarket,
  CardGradedSection,
  CardDetailNavigation,
  CardPrintingStrip,
  CardSlabRow,
  SlabPlaceholder,
} from '../components/CardDetailLayout';
import HoloCard from '../components/HoloCard';
import { CardNotesField } from '../components/CardNotes';
import { PriceHistoryChart } from '../components/PriceHistory';
import { PaidInput, Gain } from '../components/Paid';
import { ManualBadge, ValueInput } from '../components/ValueOverride';
import { Modal } from '../components/forms';
import { ErrorState, Skeleton } from '../components/ui';
import { useFx, useMoney } from '../hooks/useMoney';
import { useSwipe } from '../hooks/useSwipe';
import { paidUsd } from '../utils/fx';
import { CONDITIONS } from '../utils/variants';
import { formatDate } from '../utils/format';
import { toast } from '../store/toastStore';
import { api } from '../api/http';
import { useGame } from './context';
import { gameApi } from './api';
import { ManaText, GradedForm } from './Cards';
import { AssetTools } from './extras';
import { SlabPhotoLightbox } from '../components/GradedSection';

const finishName = (finish: string) =>
  finish === 'nonfoil'
    ? 'Normal'
    : finish.charAt(0).toUpperCase() + finish.slice(1);
type HistoryPoint = {
  finish: string;
  source: PriceHistorySeries['source'];
  currency: 'USD' | 'EUR';
  date: string;
  price: number;
};

function FinishRow({
  card,
  finish,
  history,
}: {
  card: TcgCard;
  finish: string;
  history: HistoryPoint[];
}) {
  const { state, save, readOnly, busy } = useGame();
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const { rates } = useFx();
  const money = useMoney();
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const entry = state.entries.find(
    (e) => e.cardId === card.id && e.finish === finish,
  );
  const n = entry?.quantity ?? 0;
  const market = cardValue(card, finish, rates.EUR);
  const paid = paidUsd(entry?.paid, rates);
  const update = async (patch: Partial<Holding>) => {
    const current = latest.current.entries.find(
      (e) => e.cardId === card.id && e.finish === finish,
    );
    const record: Holding = {
      ...current,
      id: holdingId(card.id, finish),
      cardId: card.id,
      finish,
      quantity: current?.quantity ?? 0,
      addedAt: current?.addedAt ?? new Date().toISOString(),
      ...patch,
    };
    return save([{ kind: 'entry', id: record.id, data: record }]);
  };
  const adjust = async (delta: number) => {
    const quantity =
      latest.current.entries.find(
        (e) => e.cardId === card.id && e.finish === finish,
      )?.quantity ?? 0;
    if (
      (await update({ quantity: Math.max(0, quantity + delta) })) &&
      delta < 0
    )
      toast(`Removed one ${finishName(finish)} copy`, {
        action: {
          label: 'Undo',
          run: () => {
            void adjust(1);
          },
        },
      });
  };
  const series: PriceHistorySeries[] = [
    ...new Set(history.filter((p) => p.finish === finish).map((p) => p.source)),
  ].map((source) => {
    const points = history
      .filter((p) => p.finish === finish && p.source === source)
      .sort((a, b) => a.date.localeCompare(b.date));
    const quote = card.prices[finish]?.find((q) => q.source === source);
    return {
      variant: finish,
      source,
      currency: points[0].currency,
      points: points.slice(-days),
      updatedAt: quote?.at,
      url: quote?.url,
    };
  });
  return (
    <CardFinishRow
      owned={n > 0}
      foil={/foil|etched/.test(finish) && finish !== 'nonfoil'}
      info={
        <>
          <p className="text-sm font-semibold">{finishName(finish)}</p>
          <p className="text-xs text-muted">Counts towards set completion</p>
          {card.prices[finish]?.find((q) => q.url)?.url && (
            <a
              className="text-xs text-muted hover:text-accent"
              href={card.prices[finish].find((q) => q.url)!.url}
              target="_blank"
              rel="noreferrer"
            >
              View this printing on{' '}
              {card.prices[finish].find((q) => q.url)!.source === 'tcgplayer'
                ? 'TCGplayer'
                : 'Cardmarket'}
            </a>
          )}
          <p className="font-mono text-[11px] text-muted tabular">
            {n > 0 && entry?.valueUsd != null ? (
              <>
                {money(entry.valueUsd)} your value{' '}
                <ManualBadge className="normal-case" />
              </>
            ) : market != null ? (
              `${money(market)} market`
            ) : (
              'No price data'
            )}
          </p>
          {n > 0 && paid != null && (entry?.valueUsd ?? market) != null && (
            <Gain
              valueUsd={(entry?.valueUsd ?? market ?? 0) * n}
              costUsd={paid * n}
              className="text-[11px]"
            />
          )}
        </>
      }
      controls={
        readOnly ? (
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
              <>
                <PaidInput
                  value={entry.paid}
                  label={`Paid per ${finishName(finish)} copy`}
                  onCommit={(paid) => {
                    void update({ paid });
                  }}
                />
                <ValueInput
                  value={entry.valueUsd}
                  label={`Your value per ${finishName(finish)} copy`}
                  onCommit={(valueUsd) => {
                    void update({ valueUsd });
                  }}
                />
                <select
                  disabled={busy}
                  value={entry.condition ?? 'NM'}
                  onChange={(e) => void update({ condition: e.target.value })}
                  className="input !h-8 !w-auto !rounded-lg !px-2 !text-xs"
                  aria-label={`Condition of ${finishName(finish)} copy`}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.value} · {c.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {n > 0 ? (
              <div className="flex items-center rounded-lg border border-line-strong">
                <button
                  disabled={busy}
                  onClick={() => void adjust(-1)}
                  className="grid h-8 w-8 place-items-center text-muted hover:text-fg"
                  aria-label={`Remove one ${finishName(finish)}`}
                >
                  <Minus size={14} />
                </button>
                <span className="w-7 text-center font-mono text-sm font-bold tabular">
                  {n}
                </span>
                <button
                  disabled={busy}
                  onClick={() => void adjust(1)}
                  className="grid h-8 w-8 place-items-center text-muted hover:text-fg"
                  aria-label={`Add one ${finishName(finish)}`}
                >
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              <button
                disabled={busy}
                onClick={() => void adjust(1)}
                className="btn btn-primary !h-8 !rounded-lg !px-3 !text-xs"
                aria-label={`Add ${finishName(finish)} copy`}
              >
                <Plus size={14} />
                Add
              </button>
            )}
          </>
        )
      }
      history={
        <PriceHistoryChart
          cardId={card.id}
          variant={finish}
          series={series}
          days={days}
          onDaysChange={setDays}
        />
      }
    />
  );
}

function CardLists({ card }: { card: TcgCard }) {
  const { module, state, save, busy } = useGame();
  const [open, setOpen] = useState(false),
    [listId, setListId] = useState(''),
    [zone, setZone] = useState<DeckZone>('main');
  const selected = state.lists.find((l) => l.id === listId);
  return (
    <>
      <button
        className="btn btn-ghost !h-9 !text-xs"
        onClick={() => setOpen(true)}
      >
        <ListPlus size={14} />
        Lists
      </button>
      {open && (
        <Modal title="Add to a list or deck" onClose={() => setOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selected) return;
              const section = selected.kind === 'list' ? 'main' : zone;
              const existing = selected.items.find(
                (i) => i.cardId === card.id && i.zone === section,
              );
              const items = existing
                ? selected.items.map((i) =>
                    i === existing
                      ? {
                          ...i,
                          quantity:
                            selected.kind === 'list' ? 1 : i.quantity + 1,
                        }
                      : i,
                  )
                : [
                    ...selected.items,
                    { cardId: card.id, zone: section, quantity: 1 },
                  ];
              void save([
                { kind: 'list', id: selected.id, data: { ...selected, items } },
              ]).then((ok) => {
                if (ok) {
                  toast(`Added to ${selected.name}`);
                  setOpen(false);
                }
              });
            }}
          >
            <label className="block text-sm">
              List or deck
              <select
                required
                className="input mt-1 w-full"
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              >
                <option value="">Choose list</option>
                {state.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {selected?.kind === 'deck' && (
              <label className="block text-sm">
                Section
                <select
                  className="input mt-1 w-full"
                  value={zone}
                  onChange={(e) => setZone(e.target.value as DeckZone)}
                >
                  {['main', 'commander', 'companion', 'maybeboard'].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <Link to={`/${module.id}/lists`} className="btn btn-ghost">
                Create deck or list
              </Link>
              <button disabled={busy || !selected} className="btn btn-primary">
                Add card
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function SlabRow({ card, slab }: { card: TcgCard; slab: Slab }) {
  const { save, remove, readOnly, busy, collectionId, module } = useGame();
  const { rates } = useFx();
  const money = useMoney();
  const [editing, setEditing] = useState(false);
  const value =
    slab.valueUsd ?? slab.pcPrice ?? cardValue(card, slab.finish, rates.EUR);
  const cost = paidUsd(slab.paid, rates);
  const [viewer, setViewer] = useState<number | null>(null);
  const base = `/api/collections/${collectionId}/games/${module.id}`;
  const photoQuery = useQuery({
    queryKey: [
      'tcg-photos',
      collectionId,
      module.id,
      'graded',
      slab.id,
      undefined,
    ],
    queryFn: () =>
      api<{ id: string }[]>(`${base}/records/graded/${slab.id}/photos`),
  });
  const photos = (photoQuery.data ?? []).map((p) => ({
    ...p,
    url: `${base}/photos/${p.id}`,
  }));

  return (
    <CardSlabRow
      company={slab.company}
      name={slab.company}
      grade={slab.grade}
      notes={slab.notes}
      artwork={
        <button
          onClick={() => photos.length && setViewer(0)}
          disabled={!photos.length}
          aria-label={
            photos.length
              ? `View ${photos.length} photo${photos.length > 1 ? 's' : ''}`
              : undefined
          }
          className="relative h-[104px] w-[74px] shrink-0 overflow-hidden rounded-lg border border-line-strong bg-surface-2 enabled:cursor-zoom-in"
        >
          {photos[0] ? (
            <img
              src={photos[0].url}
              alt={`${slab.company} ${slab.grade} slab`}
              className="h-full w-full object-cover"
            />
          ) : (
            <SlabPlaceholder
              company={slab.company}
              name={slab.company}
              grade={slab.grade}
            />
          )}
          {photos.length > 1 && (
            <span className="absolute bottom-1 right-1 rounded bg-onyx/80 text-paper px-1 font-mono text-[9px]">
              {photos.length}
            </span>
          )}
        </button>
      }
      finish={finishName(slab.finish)}
      certificate={
        <>
          {' '}
          {slab.certNumber && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-mono text-faint">
                Cert <span className="text-fg">{slab.certNumber}</span>
              </span>
              <button
                className="inline-flex items-center gap-1 text-muted hover:text-accent"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(slab.certNumber!)
                    .then(() => toast('Cert number copied'))
                    .catch(() => toast(`Cert ${slab.certNumber}`))
                }
              >
                <Copy size={11} />
                Copy
              </button>
            </p>
          )}
        </>
      }
      countControl={
        <>
          {' '}
          {!readOnly && (
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                disabled={busy}
                checked={slab.countsTowardSet}
                onChange={(e) =>
                  void save([
                    {
                      kind: 'graded',
                      id: slab.id,
                      data: { ...slab, countsTowardSet: e.target.checked },
                    },
                  ])
                }
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative h-4 w-7 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-3 peer-checked:after:bg-on-accent"
              />
              Counts towards set
            </label>
          )}
        </>
      }
      value={money(value)}
      valueCaption={
        <>
          {' '}
          {slab.valueUsd != null
            ? 'your value'
            : slab.pcPrice != null
              ? 'PriceCharting'
              : 'raw-card estimate'}
        </>
      }
      gain={
        <>
          {' '}
          {value != null && cost != null && (
            <Gain valueUsd={value} costUsd={cost} className="text-[10px]" />
          )}
        </>
      }
      actions={
        <>
          {' '}
          {!readOnly && (
            <div className="flex gap-1">
              <button
                className="btn btn-ghost !h-8 !w-8 !p-0"
                aria-label={`Edit ${slab.company} ${slab.grade}`}
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} />
              </button>
              <button
                disabled={busy}
                className="btn btn-ghost !h-8 !w-8 !p-0 hover:!text-loss"
                aria-label={`Remove ${slab.company} ${slab.grade}`}
                onClick={() => void remove('graded', slab.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </>
      }
    >
      {' '}
      {viewer !== null && photos[viewer] && (
        <SlabPhotoLightbox
          photos={photos}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          title={`${card.name} · ${slab.company} ${slab.grade}`}
        />
      )}
      {editing && (
        <GradedForm
          card={card}
          copy={slab}
          trigger={false}
          onDone={() => setEditing(false)}
        >
          <div className="mt-4 border-t border-line pt-4">
            <AssetTools kind="graded" item={slab} />
          </div>
        </GradedForm>
      )}
    </CardSlabRow>
  );
}

export function GameCard({ id }: { id: string }) {
  const { module, state, save, remove, readOnly, busy } = useGame();
  const { rates } = useFx();
  const money = useMoney();
  const navigate = useNavigate();
  const location = useLocation();
  const [face, setFace] = useState(0);
  const q = useQuery({
    queryKey: ['tcg-card', module.id, id],
    queryFn: () => gameApi.card(module.id, id),
  });
  const card = q.data ?? state.cards.find((c) => c.id === id);
  const set = useQuery({
    queryKey: ['tcg-set', module.id, card?.setId, card?.language],
    queryFn: () => gameApi.set(module.id, card!.setId, card!.language),
    enabled: !!card,
  });
  const sets = useQuery({
    queryKey: ['tcg-sets', module.id],
    queryFn: () => gameApi.sets(module.id),
    staleTime: 6 * 3600_000,
    enabled: !!card,
  });
  const history = useQuery({
    queryKey: ['tcg-prices', module.id, id],
    queryFn: () =>
      api<HistoryPoint[]>(
        `/api/games/${module.id}/cards/${encodeURIComponent(id)}/prices`,
      ),
  });
  const printings = useQuery({
    queryKey: ['tcg-reprints', module.id, id],
    queryFn: () =>
      gameApi.search(module.id, {
        q: `oracleid:${String(card?.details.oracleId ?? '')}`,
      }),
    enabled: !!card?.details.oracleId,
  });
  const list = [...(set.data?.cards ?? [])].sort((a, b) =>
    a.number.localeCompare(b.number, undefined, { numeric: true }),
  );
  const pos = list.findIndex((c) => c.id === id),
    prev = pos > 0 ? list[pos - 1] : undefined,
    next = pos >= 0 ? list[pos + 1] : undefined;
  const searchResults = (location.state as { searchResults?: string } | null)
    ?.searchResults;
  const go = (to: TcgCard | undefined, dir: 1 | -1) => {
    if (to)
      navigate(`/${module.id}/card/${encodeURIComponent(to.id)}`, {
        state: { dir, searchResults },
      });
  };
  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: () => go(next, 1),
    onSwipeRight: () => go(prev, -1),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,button,[contenteditable]',
        ) ||
        document.querySelector('[role="dialog"],dialog[open]')
      )
        return;
      if (e.key === 'ArrowLeft' && prev)
        navigate(`/${module.id}/card/${encodeURIComponent(prev.id)}`, {
          state: { dir: -1, searchResults },
        });
      if (e.key === 'ArrowRight' && next)
        navigate(`/${module.id}/card/${encodeURIComponent(next.id)}`, {
          state: { dir: 1, searchResults },
        });
      if (e.key === 'Escape' && card)
        navigate(
          searchResults ??
            `/${module.id}/sets/${encodeURIComponent(card.setId)}`,
          { state: { fromCard: id } },
        );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate, module.id, card, id, searchResults]);
  if (!card)
    return q.error ? (
      <ErrorState
        title="Couldn't load this card"
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    ) : (
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,420px)_1fr]">
        <Skeleton className="aspect-[63/88]" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  const entries = state.entries.filter(
      (e) => e.cardId === id && e.quantity > 0,
    ),
    slabs = state.graded.filter((g) => g.cardId === id);
  const rawTotal = entries.reduce((n, e) => n + e.quantity, 0),
    total = rawTotal + slabs.length;
  const holdingValue = (e: Holding) =>
    (e.valueUsd ?? cardValue(card, e.finish, rates.EUR) ?? 0) * e.quantity;
  const slabValue = (g: Slab) =>
    g.valueUsd ?? g.pcPrice ?? cardValue(card, g.finish, rates.EUR) ?? 0;
  const ownedValue =
    entries.reduce((n, e) => n + holdingValue(e), 0) +
    slabs.reduce((n, g) => n + slabValue(g), 0);
  const costed = entries.filter((e) => e.paid),
    costedSlabs = slabs.filter((g) => g.paid);
  const cost =
    costed.reduce((n, e) => n + (paidUsd(e.paid, rates) ?? 0) * e.quantity, 0) +
    costedSlabs.reduce((n, g) => n + (paidUsd(g.paid, rates) ?? 0), 0);
  const costedValue =
    costed.reduce((n, e) => n + holdingValue(e), 0) +
    costedSlabs.reduce((n, g) => n + slabValue(g), 0);
  const wanted = state.wishlist.includes(id),
    faceData = card.faces[face] ?? card.faces[0];
  const variants = [
    ...new Set([
      ...card.finishes,
      ...entries.map((e) => e.finish),
      ...slabs.map((g) => g.finish),
    ]),
  ];
  const setMeta = sets.data?.find((s) => s.id === card.setId);
  const quotes = Object.values(card.prices).flat();
  const sources = [...new Set(quotes.map((q) => q.source))];
  const others = printings.data?.cards.filter((c) => c.id !== id) ?? [];
  const slide = (location.state as { dir?: number } | null)?.dir;
  return (
    <CardDetailLayout
      swipeRef={swipeRef}
      canBrowse={!!(prev || next)}
      navigation={
        <CardDetailNavigation
          setUrl={`/${module.id}/sets/${encodeURIComponent(card.setId)}`}
          setName={card.setName}
          cardId={id}
          searchResults={searchResults}
          badge={
            card.language !== 'en' && (
              <span className="rounded border border-line-strong px-1 font-mono text-[10px] uppercase text-muted">
                {card.language}
              </span>
            )
          }
          previous={!!prev}
          next={!!next}
          position={pos}
          total={list.length}
          onPrevious={() => go(prev, -1)}
          onNext={() => go(next, 1)}
        />
      }
      artwork={
        <>
          <div
            key={id}
            className={`card-artwork mx-auto ${slide === 1 ? 'animate-slide-from-right' : slide === -1 ? 'animate-slide-from-left' : ''}`}
          >
            <HoloCard
              id={id}
              src={faceData?.image ?? card.image}
              name={card.printedName ?? card.name}
              number={card.number}
              setName={card.setName}
              foil={card.finishes.some((f) => f === 'foil' || f === 'etched')}
            />
          </div>
          {card.faces.filter((f) => f.image).length > 1 && (
            <button
              className="btn btn-ghost mx-auto mt-4 flex !h-8 !text-xs"
              onClick={() => setFace((face + 1) % card.faces.length)}
            >
              <RotateCw size={14} />
              Flip card
            </button>
          )}
        </>
      }
      otherPrintings={
        <CardPrintingStrip
          name={card.name}
          count={others.length}
          items={others.slice(0, 24).map((c) => ({
            id: c.id,
            url: `/${module.id}/card/${encodeURIComponent(c.id)}`,
            state: searchResults ? { searchResults } : undefined,
            name: c.name,
            image: c.image,
            number: c.number,
            setName: c.setName,
            caption: `#${c.number} · ${c.language.toUpperCase()}`,
            owned:
              state.entries.some((e) => e.cardId === c.id && e.quantity > 0) ||
              state.graded.some((g) => g.cardId === c.id),
          }))}
        />
      }
    >
      <CardDetailHeading
        setLabel={
          <Link
            to={`/${module.id}/sets/${encodeURIComponent(card.setId)}`}
            state={{ fromCard: id }}
            className="truncate text-fg hover:text-accent"
          >
            #{card.number}
            {setMeta?.total ? `/${setMeta.total}` : ''} · {card.setName}
          </Link>
        }
        release={setMeta?.releaseDate.slice(0, 4)}
        typeLine={faceData?.typeLine ?? ''}
        rarity={card.rarity}
        title={card.printedName ?? card.name}
        stats={
          <span className="flex items-center gap-1 text-lg">
            <ManaText text={faceData?.manaCost ?? ''} />
          </span>
        }
        artist={
          card.artist && (
            <Link
              className="italic hover:text-accent"
              to={`/${module.id}/search?artist=${encodeURIComponent(card.artist)}`}
            >
              Illus. {card.artist}
            </Link>
          )
        }
      />
      <CardCollectionSection
        label="In your collection"
        summary={
          total ? (
            <>
              {total} {total === 1 ? 'copy' : 'copies'}{' '}
              <span className="text-muted">· {money(ownedValue)}</span>
              {[...entries, ...slabs].some((e) => e.valueUsd != null) && (
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
          )
        }
        cost={
          costed.length + costedSlabs.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              Paid {money(cost)} ·{' '}
              <Gain valueUsd={costedValue} costUsd={cost} icon />
            </p>
          )
        }
        actions={
          !readOnly && (
            <div className="flex gap-2">
              <CardLists card={card} />
              <button
                disabled={busy}
                onClick={() =>
                  void (wanted
                    ? remove('wishlist', id)
                    : save([{ kind: 'wishlist', id, data: { id } }]))
                }
                className={`btn !h-9 !text-xs ${wanted ? 'border border-wish/40 bg-wish/10 text-wish' : 'btn-ghost'}`}
                aria-pressed={wanted}
              >
                <Heart size={14} fill={wanted ? 'currentColor' : 'none'} />
                {wanted ? 'Wishlisted' : 'Wishlist'}
              </button>
              {rawTotal > 0 && (
                <button
                  disabled={busy}
                  className="btn btn-ghost !h-9 !w-9 !p-0 hover:!text-loss"
                  aria-label="Remove all copies"
                  title="Remove all copies"
                  onClick={() =>
                    void save(
                      entries.map((e) => ({
                        kind: 'entry',
                        id: e.id,
                        data: { ...e, quantity: 0 },
                      })),
                    ).then((ok) => {
                      if (ok)
                        toast(`Removed all ${card.name}`, {
                          action: {
                            label: 'Undo',
                            run: () => {
                              void save(
                                entries.map((e) => ({
                                  kind: 'entry',
                                  id: e.id,
                                  data: e,
                                })),
                              );
                            },
                          },
                        });
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )
        }
      >
        {variants.map((f) => (
          <FinishRow
            key={f}
            card={card}
            finish={f}
            history={history.data ?? []}
          />
        ))}
      </CardCollectionSection>
      {module.capabilities.graded && (!readOnly || slabs.length > 0) && (
        <CardGradedSection
          count={slabs.length}
          action={!readOnly && <GradedForm card={card} />}
        >
          {slabs.length ? (
            <ul className="divide-y divide-line">
              {slabs.map((s) => (
                <SlabRow key={s.id} card={card} slab={s} />
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted">
              Got this card in a slab? Record the grader, grade and cert number,
              and add photos of the case.
            </p>
          )}
        </CardGradedSection>
      )}
      <CardNotesField
        key={id}
        saved={state.notes.find((n) => n.id === id)?.text ?? ''}
        readOnly={readOnly}
        onSave={(text) => save([{ kind: 'note', id, data: { id, text } }])}
      />
      {sources.length > 0 && (
        <CardMarket
          links={sources.map((source) => {
            const quote = quotes.find((q) => q.source === source && q.url);
            return (
              quote?.url && (
                <a
                  key={source}
                  href={quote.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                >
                  {source === 'tcgplayer'
                    ? 'TCGplayer'
                    : source === 'cardmarket'
                      ? 'Cardmarket'
                      : source}
                  <ExternalLink size={12} />
                </a>
              )
            );
          })}
          columns={sources.map((source) =>
            source === 'tcgplayer' ? (
              <>
                TCGplayer{' '}
                <span className="normal-case tracking-normal text-faint">
                  (US)
                </span>
              </>
            ) : source === 'cardmarket' ? (
              <>
                Cardmarket{' '}
                <span className="normal-case tracking-normal text-faint">
                  (EU)
                </span>
              </>
            ) : (
              source
            ),
          )}
          rows={variants.map((f) => ({
            id: f,
            label: finishName(f),
            values: sources.map((source) => {
              const quote = card.prices[f]?.find((q) => q.source === source);
              return money(
                quote
                  ? quote.currency === 'EUR'
                    ? quote.amount / rates.EUR
                    : quote.amount
                  : undefined,
              );
            }),
          }))}
          note={
            <>
              TCGplayer market and Cardmarket prices, converted at today&apos;s
              rate. Updated{' '}
              {formatDate(
                quotes
                  .map((q) => q.at)
                  .sort()
                  .at(-1) ?? card.fetchedAt,
              )}
              .
            </>
          }
        />
      )}
      <section data-card-text>
        <h2 className="mb-2 font-display text-2xl font-medium">Card text</h2>
        <div className="divide-y divide-line border-y border-line">
          {card.faces.map((f, i) => (
            <div key={i} className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 font-semibold">{f.name}</p>
                <ManaText text={f.manaCost ?? ''} />
                {f.power != null && (
                  <p className="font-display text-2xl font-medium tabular">
                    {f.power}/{f.toughness}
                  </p>
                )}
                {f.loyalty && (
                  <span className="font-display text-2xl">
                    {f.loyalty} loyalty
                  </span>
                )}
                {f.defense && (
                  <span className="font-display text-2xl">
                    {f.defense} defense
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-faint">{f.typeLine}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                <ManaText text={f.text} />
              </p>
            </div>
          ))}
        </div>
      </section>
      {module.cardFacts && (
        <section className="grid grid-cols-3 divide-x divide-line border-y border-line">
          {module.cardFacts(card).map((f) => (
            <div key={f.label} className="px-4 py-3 first:pl-0">
              <p className="eyebrow">{f.label}</p>
              <p className="mt-2 text-sm">{f.value}</p>
            </div>
          ))}
        </section>
      )}
      {card.treatments.length > 0 && (
        <p className="text-xs text-faint">{card.treatments.join(' · ')}</p>
      )}
      {q.error && (
        <p role="status" className="text-xs text-muted">
          Showing saved card details. The catalogue could not be refreshed.{' '}
          <button className="text-accent" onClick={() => void q.refetch()}>
            Try again
          </button>
        </p>
      )}
    </CardDetailLayout>
  );
}
