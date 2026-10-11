import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CardSnapshot } from '../api/types';
import { useCollectionStore } from '../store/collectionStore';
import { isFoil, variantLabel, variantShort } from '../utils/variants';
import CardImage from './CardImage';

export interface BinderSlot {
  card: CardSnapshot;
  owned: boolean;
  /** Master-set binders give every printing its own pocket. */
  variant?: string;
}

function useIsWide() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

function Pocket({ slot }: { slot?: BinderSlot }) {
  const owned = useCollectionStore((s) => (slot ? s.holdings.get(slot.card.id) : undefined));
  if (!slot) return <div className="aspect-[63/88] rounded-[5%/3.6%] border border-white/[0.04] bg-black/20" />;
  const foil = slot?.variant ? isFoil(slot.variant) : owned && Object.keys(owned).some(isFoil);
  const has = slot.owned;
  return (
    <Link
      to={`/card/${slot.card.id}`}
      title={`${slot.card.name} #${slot.card.number}${slot.variant ? ` · ${variantLabel(slot.variant)}` : ''}`}
      className="group relative block aspect-[63/88] rounded-[5%/3.6%] bg-black/30 p-[3%] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),inset_0_-8px_14px_rgb(0_0_0/0.35)]"
    >
      {has ? (
        <div className="relative h-full w-full overflow-hidden rounded-[4.5%/3.2%] shadow-lg transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-[1.02]">
          <CardImage id={slot.card.id} src={slot.card.image} name={slot.card.name} number={slot.card.number} setName={slot.card.setName} types={slot.card.types} alt={slot.card.name} />
          {foil && <div className="foil" style={{ ['--foil-o' as string]: '0.25' }} />}
        </div>
      ) : (
        <div className="relative grid h-full w-full place-items-center overflow-hidden rounded-[4.5%/3.2%] border border-dashed border-white/10">
          <div className="absolute inset-0 opacity-[0.07] grayscale transition-opacity group-hover:opacity-30">
            <CardImage id={slot.card.id} src={slot.card.image} name={slot.card.name} types={slot.card.types} />
          </div>
          <span className="relative text-center font-mono text-[11px] text-faint group-hover:text-muted">
            #{slot.card.number}
            {slot.variant && <span className="block text-[9.5px]">{variantShort(slot.variant)}</span>}
          </span>
        </div>
      )}
    </Link>
  );
}

const TURN_MS = 750;
const PAGE_BG = 'linear-gradient(180deg, var(--color-surface-2), var(--color-surface)), var(--color-surface)';

interface Turn {
  from: number;
  to: number;
}

/**
 * One side of a turning leaf. Pages are shaded as they lift away from the light, darkest at 90°.
 * `fade` is the edge furthest from the rings, which catches the most shadow.
 */
function LeafFace({ children, back, fade }: { children: ReactNode; back?: boolean; fade: 'l' | 'r' }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[10px] [backface-visibility:hidden]"
      style={{ background: PAGE_BG, transform: back ? 'rotateY(180deg)' : undefined, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.05)' }}
    >
      {children}
      <div className={`page-shade absolute inset-0 ${fade === 'r' ? 'bg-gradient-to-r' : 'bg-gradient-to-l'} from-black/20 to-black/70`} />
    </div>
  );
}

export default function BinderView({ slots, pocketSize = 9 }: { slots: BinderSlot[]; pocketSize?: 9 | 12 }) {
  const wide = useIsWide();
  const perView = wide ? 2 : 1;
  const pages = useMemo(() => {
    const out: BinderSlot[][] = [];
    for (let i = 0; i < slots.length; i += pocketSize) out.push(slots.slice(i, i + pocketSize));
    return out.length ? out : [[]];
  }, [slots, pocketSize]);
  const views = Math.ceil(pages.length / perView);
  const [view, setView] = useState(0);
  const [turning, setTurning] = useState<Turn | null>(null);
  const current = Math.min(view, views - 1);
  // Drop a turn whose pages vanished (slots shrank or the layout switched between single and spread).
  const turn = turning && turning.from < views && turning.to < views && turning.from !== turning.to ? turning : null;

  const go = (delta: 1 | -1) => {
    const to = Math.min(Math.max(current + delta, 0), views - 1);
    if (to === current) return;
    // Starting a new turn mid-flip just continues from wherever the last one was heading.
    setTurning({ from: current, to });
    setView(to);
  };

  useEffect(() => {
    if (!turning) return;
    const t = window.setTimeout(() => setTurning(null), TURN_MS + 100);
    return () => window.clearTimeout(t);
  }, [turning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cols = pocketSize === 9 ? 'grid-cols-3' : 'grid-cols-4';
  const pad = (col: number) => (perView === 2 ? (col === 0 ? 'pr-5' : 'pl-5') : '');

  const page = (index: number, col: number) =>
    index < pages.length ? (
      <div className={pad(col)}>
        <div className={`grid ${cols} gap-2 sm:gap-2.5`}>
          {Array.from({ length: pocketSize }, (_, k) => (
            <Pocket key={k} slot={pages[index][k]} />
          ))}
        </div>
        <p className="mt-2 text-center font-mono text-[10px] text-faint">p. {index + 1}</p>
      </div>
    ) : null;

  /*
   * While a leaf turns, the pages underneath already show where it's going, except the one it hasn't covered yet.
   *   Spread, forward:  old right page flips over the rings and its reverse becomes the new left page.
   *   Spread, back:     mirror image.
   *   Single, forward:  the page swings away around the rings on the left, revealing the next one.
   *   Single, back:     the previous page swings in from the left over the current one.
   */
  const fwd = turn ? turn.to > turn.from : true;
  const base = (col: number) => {
    if (!turn) return current * perView + col;
    if (perView === 1) return fwd ? turn.to : turn.from;
    return (col === 0) === fwd ? turn.from * 2 + col : turn.to * 2 + col;
  };
  const leafCol = !turn ? -1 : perView === 1 ? 0 : fwd ? 1 : 0;
  const leaf = (() => {
    if (!turn) return null;
    let front: ReactNode;
    let back: ReactNode = null;
    let anim: string;
    let origin: string;
    let fade: 'l' | 'r';
    if (perView === 1) {
      front = page(fwd ? turn.from : turn.to, 0);
      anim = fwd ? 'page-turn-forward' : 'page-turn-in';
      origin = 'left center';
      fade = 'r';
    } else if (fwd) {
      front = page(turn.from * 2 + 1, 1);
      back = page(turn.to * 2, 0);
      anim = 'page-turn-forward';
      origin = 'left center';
      fade = 'r';
    } else {
      front = page(turn.from * 2, 0);
      back = page(turn.to * 2 + 1, 1);
      anim = 'page-turn-back';
      origin = 'right center';
      fade = 'l';
    }
    return (
      <div
        key={`${turn.from}-${turn.to}`}
        aria-hidden
        inert
        data-testid="turning-leaf"
        className="pointer-events-none absolute inset-0 z-10 [transform-style:preserve-3d]"
        style={{ transformOrigin: origin, animation: `${anim} ${TURN_MS}ms cubic-bezier(0.45, 0.05, 0.25, 1) both` }}
        onAnimationEnd={(e) => e.target === e.currentTarget && setTurning(null)}
      >
        <LeafFace fade={fade}>{front}</LeafFace>
        {back && (
          <LeafFace back fade={fade === 'l' ? 'r' : 'l'}>
            {back}
          </LeafFace>
        )}
      </div>
    );
  })();

  const labelPages = perView === 2 ? `Pages ${current * 2 + 1}–${Math.min(current * 2 + 2, pages.length)}` : `Page ${current + 1}`;

  return (
    <div className="space-y-4">
      <div
        className="relative mx-auto grid gap-0 rounded-[22px] p-3 shadow-pop sm:p-4"
        style={{
          gridTemplateColumns: `repeat(${perView}, minmax(0, 1fr))`,
          maxWidth: perView === 2 ? (pocketSize === 9 ? 1060 : 1240) : 520,
          background: PAGE_BG,
          boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.06), 0 30px 80px -30px rgb(0 0 0 / 0.9)',
        }}
      >
        {Array.from({ length: perView }, (_, col) => (
          <div key={col} className="relative">
            {page(base(col), col)}
            {col === leafCol && leaf}
          </div>
        ))}
        {perView === 2 && (
          <div aria-hidden className="pointer-events-none absolute inset-y-6 left-1/2 z-20 flex w-6 -translate-x-1/2 flex-col justify-around">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-black/60 to-transparent" />
            {[0, 1, 2].map((r) => (
              <span key={r} className="relative mx-auto h-4 w-4 rounded-full bg-gradient-to-br from-[#d8d6e0] to-[#6d6a7a] shadow-[0_2px_4px_rgb(0_0_0/0.6)]" />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button className="btn btn-ghost !h-9 !w-9 !p-0" aria-label="Previous page" disabled={current === 0} onClick={() => go(-1)}>
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-28 text-center font-mono text-xs text-muted tabular">
          {labelPages} of {pages.length}
        </span>
        <button className="btn btn-ghost !h-9 !w-9 !p-0" aria-label="Next page" disabled={current >= views - 1} onClick={() => go(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <p className="text-center text-[11px] text-faint">Tip: use ← → to turn pages</p>
    </div>
  );
}
