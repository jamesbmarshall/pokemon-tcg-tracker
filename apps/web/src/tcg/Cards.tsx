import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from '../store/toastStore';
import { Link } from 'react-router-dom';
import type { TcgCard, Slab } from '@poketracker/shared/tcg/types';
import { cardValue, holdingId } from '@poketracker/shared/tcg/collection';
import CardImage from '../components/CardImage';
import { Modal } from '../components/forms';
import { BinderBook } from '../components/BinderView';
import { useSettings } from '../store/settingsStore';
import {
  Heart,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sun,
  Droplet,
  Skull,
  Flame,
  TreePine,
  Diamond,
  CornerUpRight,
} from 'lucide-react';
import { useMoney } from '../hooks/useMoney';
import { useGame } from './context';
import { currentRates } from '../utils/fx';
const MANA = {
  W: { label: 'White mana', color: '#eee7c4', icon: Sun },
  U: { label: 'Blue mana', color: '#94bdd8', icon: Droplet },
  B: { label: 'Black mana', color: '#b7afb0', icon: Skull },
  R: { label: 'Red mana', color: '#e69a87', icon: Flame },
  G: { label: 'Green mana', color: '#8bbba2', icon: TreePine },
  C: { label: 'Colorless mana', color: '#cbc7bc', icon: Diamond },
  T: { label: 'Tap', color: '#cbc7bc', icon: CornerUpRight },
};
export function ManaText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[^}]+\})/).map((part, n) => {
        if (!part.startsWith('{')) return part;
        const symbol = part.slice(1, -1),
          meta = MANA[symbol as keyof typeof MANA],
          Icon = meta?.icon;
        return (
          <span
            key={n}
            role="img"
            aria-label={meta?.label ?? symbol}
            title={meta?.label ?? symbol}
            className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-0.5 align-middle font-mono text-xs font-semibold shadow-sm"
            style={{ background: meta?.color ?? '#cbc7bc', color: '#25221e' }}
          >
            {Icon ? <Icon size={13} strokeWidth={2.5} /> : symbol}
          </span>
        );
      })}
    </>
  );
}
export function TcgCardTile({
  card,
  quick = true,
  pocket = false,
  controlsOnly = false,
  wishlist = false,
}: {
  card: TcgCard;
  quick?: boolean;
  pocket?: boolean;
  controlsOnly?: boolean;
  wishlist?: boolean;
}) {
  const { module, state, save, remove, readOnly, busy } = useGame();
  const removeWishlist = () => remove('wishlist', card.id);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const money = useMoney();
  const [face, setFace] = useState(0);
  const entries = state.entries.filter((e) => e.cardId === card.id);
  const owned =
    entries.reduce((n, e) => n + e.quantity, 0) +
    state.graded.filter((g) => g.cardId === card.id).length;
  const wanted = state.wishlist.includes(card.id);
  const image = card.faces[face]?.image || card.image;
  return (
    <article className="group min-w-0 space-y-2">
      {!controlsOnly && (
        <div className="relative">
          <Link
            to={`/${module.id}/card/${encodeURIComponent(card.id)}`}
            className="block"
          >
            <div
              className={`aspect-[0.716] overflow-hidden rounded-[4.5%] bg-surface-2 shadow-card transition-transform duration-200 group-hover:-translate-y-1 ${pocket && !owned ? 'opacity-40 saturate-50 hover:opacity-100' : ''}`}
            >
              <CardImage
                id={card.id}
                src={image ?? ''}
                name={card.printedName ?? card.name}
                alt={card.printedName ?? card.name}
                number={card.number}
                setName={card.setName}
              />
            </div>
          </Link>
          {owned > 0 && (
            <span className="absolute bottom-2 left-2 rounded-full bg-canvas/95 px-2 py-1 font-mono text-[10px] shadow-sm">
              {owned} owned
            </span>
          )}
          {card.faces.filter((f) => f.image).length > 1 && (
            <button
              className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-canvas/95"
              aria-label={`Flip ${card.name}`}
              onClick={() => setFace((face + 1) % card.faces.length)}
            >
              <RotateCw size={14} />
            </button>
          )}
          {!pocket && quick && !readOnly && (
            <div className="absolute right-2 top-2">
              <WishlistButton card={card} wanted={wanted} />
            </div>
          )}
        </div>
      )}
      {!pocket && (
        <>
          {!controlsOnly && (
            <>
              <div className="flex items-start justify-between gap-2">
                <Link
                  to={`/${module.id}/card/${encodeURIComponent(card.id)}`}
                  className="truncate text-sm font-medium hover:text-accent"
                  title={card.printedName ?? card.name}
                >
                  {card.printedName ?? card.name}
                </Link>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {money(cardValue(card, card.finishes[0], currentRates().EUR))}
                </span>
              </div>
              <p
                className="truncate font-mono text-[10px] uppercase tracking-wide text-faint"
                title={card.setName}
              >
                {card.setCode} · #{card.number} · {card.language}
              </p>
            </>
          )}
          {quick && !readOnly && (
            <div className="flex flex-wrap gap-1 border-t border-line pt-2">
              {card.finishes.map((finish) => {
                const e = entries.find((e) => e.finish === finish);
                const quantity = e?.quantity ?? 0;
                const price = cardValue(card, finish, currentRates().EUR);
                const adjust = (delta: number) => {
                  void save([
                    {
                      kind: 'entry',
                      id: holdingId(card.id, finish),
                      data: {
                        ...e,
                        id: holdingId(card.id, finish),
                        cardId: card.id,
                        finish,
                        quantity: Math.max(0, quantity + delta),
                        addedAt: e?.addedAt ?? new Date().toISOString(),
                      },
                    },
                  ]).then((ok) => {
                    if (ok && delta < 0)
                      toast(`Removed one ${finish} ${card.name}`, {
                        action: {
                          label: 'Undo',
                          run: () => {
                            const current = latest.current.entries.find(
                              (entry) =>
                                entry.cardId === card.id &&
                                entry.finish === finish,
                            );
                            void save([
                              {
                                kind: 'entry',
                                id: holdingId(card.id, finish),
                                data: {
                                  ...current,
                                  id: holdingId(card.id, finish),
                                  cardId: card.id,
                                  finish,
                                  quantity: (current?.quantity ?? 0) + 1,
                                  addedAt:
                                    current?.addedAt ??
                                    new Date().toISOString(),
                                },
                              },
                            ]);
                          },
                        },
                      });
                  });
                };
                return (
                  <div
                    key={finish}
                    className="flex min-w-[110px] flex-1 items-center justify-between rounded-md bg-surface-2 text-[11px]"
                  >
                    <button
                      disabled={busy || !quantity}
                      aria-label={`Remove ${finish} ${card.name}`}
                      className="px-2 py-2"
                      onClick={() => adjust(-1)}
                    >
                      −
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => adjust(1)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (quantity) adjust(-1);
                      }}
                      className="whitespace-nowrap px-1 py-2"
                      title={
                        price === undefined ? 'Price unavailable' : money(price)
                      }
                    >
                      {finish === 'nonfoil'
                        ? 'Normal'
                        : finish === 'foil'
                          ? 'Foil'
                          : finish}{' '}
                      {quantity}
                    </button>
                    <button
                      disabled={busy}
                      aria-label={`Add ${finish} ${card.name}`}
                      className="px-2 py-2"
                      onClick={() => adjust(1)}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {controlsOnly && !readOnly && (
            <WishlistButton card={card} wanted={wanted} />
          )}
          {wishlist && !readOnly && (
            <button
              className="btn btn-ghost w-full !text-xs"
              disabled={busy}
              onClick={() => {
                const finish = card.finishes[0];
                const entry = entries.find((e) => e.finish === finish);
                void save([
                  {
                    kind: 'entry',
                    id: holdingId(card.id, finish),
                    data: {
                      ...entry,
                      id: holdingId(card.id, finish),
                      cardId: card.id,
                      finish,
                      quantity: (entry?.quantity ?? 0) + 1,
                      addedAt: entry?.addedAt ?? new Date().toISOString(),
                    },
                  },
                ]).then((ok) => {
                  if (ok) void removeWishlist();
                });
              }}
            >
              Got it · add to collection
            </button>
          )}
        </>
      )}
    </article>
  );
}
export function WishlistButton({
  card,
  wanted,
}: {
  card: TcgCard;
  wanted: boolean;
}) {
  const { save, remove, busy } = useGame();
  return (
    <button
      disabled={busy}
      className={`grid h-8 w-8 place-items-center rounded-full bg-canvas/95 shadow-sm ${wanted ? 'text-wish' : 'text-muted hover:text-wish'}`}
      aria-label={wanted ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={wanted}
      onClick={() =>
        void (wanted
          ? remove('wishlist', card.id)
          : save([{ kind: 'wishlist', id: card.id, data: { id: card.id } }]))
      }
    >
      <Heart size={15} fill={wanted ? 'currentColor' : 'none'} />
    </button>
  );
}
export function TcgGrid({
  cards,
  binder = false,
  wishlist = false,
}: {
  cards: TcgCard[];
  binder?: boolean;
  wishlist?: boolean;
}) {
  const key = cards.map((c) => c.id).join('|');
  const [pagination, setPagination] = useState({ key, page: 0 });
  const page = pagination.key === key ? pagination.page : 0;
  const setPage = (page: number) => setPagination({ key, page });
  const pocketSize = useSettings((s) => s.pocketSize);
  const size = 48;
  if (binder)
    return (
      <BinderBook
        slots={cards}
        pocketSize={pocketSize}
        renderPocket={(card) =>
          card ? (
            <div className="rounded-lg bg-black/15 p-[3%] shadow-inner">
              <TcgCardTile card={card} pocket />
            </div>
          ) : (
            <div
              className="aspect-[0.716] rounded-lg border border-dashed border-line bg-black/10"
              aria-label="Empty binder pocket"
            />
          )
        }
      />
    );
  const max = Math.max(0, Math.ceil(cards.length / size) - 1);
  const current = Math.min(page, max);
  const visible = cards.slice(current * size, (current + 1) * size);
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {visible.map((c) => (
          <TcgCardTile
            card={c}
            key={c.id}
            pocket={binder}
            wishlist={wishlist}
          />
        ))}
      </div>
      {cards.length > size && (
        <div className="my-4 flex justify-center gap-4">
          <button
            className="btn btn-ghost"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="self-center text-sm">
            Page {current + 1} of {max + 1}
          </span>
          <button
            className="btn btn-ghost"
            disabled={current >= max}
            onClick={() => setPage(current + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </>
  );
}
export function GradedForm({
  card,
  copy,
  trigger = true,
  onDone,
  children,
}: {
  card: TcgCard;
  copy?: Slab;
  trigger?: boolean;
  onDone?: () => void;
  children?: ReactNode;
}) {
  const { save, busy, readOnly } = useGame();
  const [open, setOpen] = useState(!trigger);
  const close = () => {
    setOpen(false);
    onDone?.();
  };
  const [company, setCompany] = useState(copy?.company ?? 'PSA'),
    [grade, setGrade] = useState(copy?.grade ?? '10'),
    [finish, setFinish] = useState(copy?.finish ?? card.finishes[0] ?? ''),
    [cert, setCert] = useState(copy?.certNumber ?? ''),
    [value, setValue] = useState(copy?.valueUsd?.toString() ?? ''),
    [counts, setCounts] = useState(copy?.countsTowardSet ?? true);
  if (readOnly) return null;
  return (
    <>
      {trigger && (
        <button
          className="btn btn-ghost !h-9 !text-xs"
          onClick={() => setOpen(true)}
        >
          <Plus size={14} /> Add graded copy
        </button>
      )}
      {open && (
        <Modal
          title={copy ? 'Edit graded copy' : 'Add graded copy'}
          onClose={close}
        >
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const slab: Slab = {
                ...copy,
                id: copy?.id ?? crypto.randomUUID(),
                cardId: card.id,
                finish,
                company,
                grade,
                certNumber: cert,
                countsTowardSet: counts,
                valueUsd: value === '' ? undefined : Number(value),
                addedAt: copy?.addedAt ?? new Date().toISOString(),
              };
              void save([{ kind: 'graded', id: slab.id, data: slab }]).then(
                (ok) => {
                  if (ok) close();
                },
              );
            }}
          >
            <label>
              Finish
              <select
                className="input block"
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
              >
                {card.finishes.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              Grader
              <input
                className="input block w-28"
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </label>
            <label>
              Grade
              <input
                className="input block w-24"
                required
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </label>
            <label>
              Certificate
              <input
                className="input block w-36"
                value={cert}
                onChange={(e) => setCert(e.target.value)}
              />
            </label>
            <label>
              Manual value (USD)
              <input
                className="input block w-32"
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={counts}
                onChange={(e) => setCounts(e.target.checked)}
              />{' '}
              Counts toward completion
            </label>
            <button className="btn btn-primary" disabled={busy}>
              {copy ? 'Save details' : 'Add slab'}
            </button>
          </form>
          {children}
        </Modal>
      )}
    </>
  );
}
