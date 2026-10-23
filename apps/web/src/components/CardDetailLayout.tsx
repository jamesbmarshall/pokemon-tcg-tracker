import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import CardImage from './CardImage';
import { useCardArtworkSize } from '../hooks/useCardArtworkSize';

/** Presentation shared by every TCG. Game adapters supply content and mutations. */
export function CardDetailLayout({
  navigation,
  artwork,
  children,
  otherPrintings,
  preload,
  swipeRef,
  canBrowse = false,
}: {
  navigation: ReactNode;
  artwork: ReactNode;
  children: ReactNode;
  otherPrintings?: ReactNode;
  preload?: ReactNode;
  swipeRef?: Ref<HTMLDivElement>;
  canBrowse?: boolean;
}) {
  const artworkRef = useCardArtworkSize();
  return (
    <div ref={swipeRef} className="space-y-5 md:space-y-12" data-card-detail>
      {preload}
      {navigation}
      <div
        className="relative grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,400px)_1fr] lg:gap-16"
        data-card-columns
      >
        <div
          ref={artworkRef}
          className="relative mx-auto w-full max-w-[400px] md:sticky md:top-10 md:self-start"
          data-card-artwork
        >
          {artwork}
          <p
            data-artwork-hint
            className="mt-4 text-center text-xs text-faint pointer-coarse:hidden"
          >
            Move your pointer over the card
          </p>
          {canBrowse && (
            <p
              data-artwork-hint
              className="mt-4 hidden text-center text-xs text-faint pointer-coarse:block"
            >
              Swipe left or right to browse the set
            </p>
          )}
        </div>
        <div className="relative min-w-0 space-y-8" data-card-content>
          {children}
        </div>
      </div>
      {otherPrintings}
    </div>
  );
}

export function CardDetailHeading({
  setLabel,
  release,
  typeLine,
  rarity,
  title,
  stats,
  artist,
}: {
  setLabel: ReactNode;
  release?: ReactNode;
  typeLine: ReactNode;
  rarity?: ReactNode;
  title: string;
  stats?: ReactNode;
  artist?: ReactNode;
}) {
  return (
    <header data-card-identity>
      <div className="relative grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1.5 overflow-hidden rounded-md border border-line-strong bg-surface py-3 pl-5 pr-4 font-label text-[10.5px] font-medium text-muted">
        <span className="absolute inset-y-0 left-0 w-1 bg-accent" aria-hidden />
        {setLabel}
        <span className="text-right tabular">{release}</span>
        <p className="truncate">{typeLine}</p>
        <span className="flex items-center justify-end gap-2">{rarity}</span>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-[2.6rem] font-medium leading-tight tracking-tight sm:text-[3.2rem]">
          {title}
        </h1>
        {stats}
      </div>
      {artist && <p className="mt-1 text-sm text-muted">{artist}</p>}
    </header>
  );
}

export function CardCollectionSection({
  label,
  summary,
  cost,
  actions,
  children,
}: {
  label: string;
  summary: ReactNode;
  cost?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line-strong" data-card-collection>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="mt-1 font-display text-2xl font-medium">{summary}</p>
          {cost}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export function CardFinishRow({
  owned,
  foil,
  info,
  controls,
  history,
}: {
  owned: boolean;
  foil?: boolean;
  info: ReactNode;
  controls: ReactNode;
  history?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3" data-card-finish>
      <span
        className={`h-8 w-[3px] rounded-full ${owned ? (foil ? 'holo-bar' : 'bg-accent') : 'bg-surface-3'}`}
      />
      <div className="min-w-48 flex-1">{info}</div>
      {controls}
      {history}
    </div>
  );
}

export function CardMarket({
  links,
  columns,
  rows,
  note,
}: {
  links?: ReactNode;
  columns: ReactNode[];
  rows: { id: string; label: ReactNode; values: ReactNode[] }[];
  note: ReactNode;
}) {
  return (
    <section data-card-market>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-medium">Market</h2>
        <div className="flex gap-3">{links}</div>
      </div>
      <div className="overflow-x-auto border-y border-line-strong">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left">
            <tr className="eyebrow">
              <th className="py-2.5 pr-4 font-normal">Variant</th>
              {columns.map((label, i) => (
                <th
                  key={i}
                  className="px-4 py-2.5 text-right font-normal last:pr-0"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono tabular">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="py-2.5 pr-4 font-sans">{row.label}</td>
                {row.values.map((value, i) => (
                  <td
                    key={i}
                    className="px-4 py-2.5 text-right font-semibold last:pr-0"
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">{note}</p>
    </section>
  );
}

export function CardGradedSection({
  count,
  action,
  children,
}: {
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="border-t border-line-strong"
      aria-labelledby="graded-heading"
      data-card-graded
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <div>
          <p className="eyebrow">Graded</p>
          <h2
            id="graded-heading"
            className="mt-1 font-display text-2xl font-medium"
          >
            {count ? (
              `${count} slab${count > 1 ? 's' : ''}`
            ) : (
              <span className="text-muted">No graded copies</span>
            )}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function CardDetailNavigation({
  setUrl,
  setName,
  cardId,
  searchResults,
  badge,
  symbol,
  previous,
  next,
  position,
  total,
  onPrevious,
  onNext,
}: {
  setUrl: string;
  setName: string;
  cardId: string;
  searchResults?: string;
  badge?: ReactNode;
  symbol?: ReactNode;
  previous: boolean;
  next: boolean;
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {searchResults && (
          <Link
            to={searchResults}
            title="Back to search results (Esc)"
            className="inline-flex items-center gap-2 py-1.5 text-sm font-medium hover:text-accent"
          >
            <ChevronLeft size={16} />
            Back to search results
          </Link>
        )}
        <Link
          to={setUrl}
          state={{ fromCard: cardId }}
          title={searchResults ? 'View set' : 'Back to set (Esc)'}
          className="group inline-flex min-w-0 items-center gap-2.5 rounded-md py-1.5 pr-3 text-sm transition hover:text-fg focus-visible:outline-offset-2"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted transition group-hover:-translate-x-0.5 group-hover:text-accent">
            {searchResults ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </span>
          {symbol}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              {searchResults ? 'View set' : 'Back to set'}
            </span>
            <span className="truncate font-medium text-fg">{setName}</span>
          </span>
          {badge}
        </Link>
      </div>
      <div className="flex items-center gap-1">
        <button
          disabled={!previous}
          onClick={onPrevious}
          className="btn btn-ghost !h-9 !w-9 !p-0"
          aria-label="Previous card"
        >
          <ChevronLeft size={16} />
        </button>
        {position >= 0 && (
          <span className="px-2 font-mono text-xs text-faint tabular">
            {position + 1}/{total}
          </span>
        )}
        <button
          disabled={!next}
          onClick={onNext}
          className="btn btn-ghost !h-9 !w-9 !p-0"
          aria-label="Next card"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function CardPrintingStrip({
  name,
  count,
  items,
}: {
  name: string;
  count: number;
  items: {
    id: string;
    url: string;
    name: string;
    image: string;
    number: string;
    setName: string;
    caption: string;
    owned?: boolean;
    state?: unknown;
  }[];
}) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-4 font-display text-2xl font-medium">
        Other {name} printings{' '}
        <span className="font-mono text-sm text-faint">{count}</span>
      </h2>
      <div className="scroll-x -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {items.map((c) => (
          <Link
            key={c.id}
            to={c.url}
            state={c.state}
            className="group w-[112px] shrink-0 snap-start"
          >
            <div
              className={`aspect-[63/88] overflow-hidden rounded-[4.5%/3.2%] shadow-card ring-1 transition group-hover:-translate-y-1 group-hover:shadow-card-lift ${c.owned ? 'ring-accent/60' : 'ring-line'}`}
            >
              <CardImage
                id={c.id}
                src={c.image}
                name={c.name}
                number={c.number}
                setName={c.setName}
              />
            </div>
            <p className="mt-1.5 truncate text-[11px] text-muted">
              {c.setName}
            </p>
            <p className="font-mono text-[10px] text-faint">{c.caption}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

const GRADER_STRIP: Record<string, string> = {
  PSA: 'bg-[#c8202b] text-white',
  BGS: 'bg-gradient-to-r from-[#c9ced6] to-[#9aa3ae] text-onyx',
  CGC: 'bg-[#1f4f8f] text-white',
  SGC: 'bg-[#141414] text-white ring-1 ring-inset ring-white/20',
  TAG: 'bg-[#f2f2f2] text-onyx',
  ACE: 'bg-[#e6b422] text-onyx',
};
export function SlabPlaceholder({
  company,
  name,
  grade,
}: {
  company: string;
  name: string;
  grade: string;
}) {
  return (
    <span className="flex h-full flex-col">
      <span
        className={`px-1 py-1 text-center font-mono text-[9px] font-bold leading-none ${GRADER_STRIP[company] ?? 'bg-surface-3 text-fg'}`}
      >
        {name}
        <span className="block text-[13px]">
          {grade === 'Authentic' ? 'AUTH' : grade}
        </span>
      </span>
      <span className="grid flex-1 place-items-center text-faint">
        <ImageIcon size={16} />
      </span>
    </span>
  );
}

export function CardSlabRow({
  artwork,
  company,
  name,
  grade,
  label,
  finish,
  certificate,
  notes,
  countControl,
  value,
  valueCaption,
  gain,
  actions,
  children,
}: {
  artwork: ReactNode;
  company: string;
  name: string;
  grade: string;
  label?: string;
  finish: ReactNode;
  certificate?: ReactNode;
  notes?: string;
  countControl?: ReactNode;
  value: ReactNode;
  valueCaption: ReactNode;
  gain?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-4 py-4">
      {artwork}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${GRADER_STRIP[company] ?? 'bg-surface-3 text-fg'}`}
          >
            {name}
          </span>
          <span className="font-display text-2xl font-semibold tabular leading-none">
            {grade}
          </span>
          {label && label !== 'Authentic' && (
            <span className="text-sm text-muted">{label}</span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted">{finish}</p>
        {certificate}
        {notes && (
          <p className="mt-1.5 line-clamp-2 text-xs text-faint">{notes}</p>
        )}
        {countControl}
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <div className="text-right">
          <p className="font-mono text-sm font-semibold tabular">{value}</p>
          <p className="text-[10px] text-faint">{valueCaption}</p>
          {gain}
        </div>
        {actions}
      </div>
      {children}
    </li>
  );
}
