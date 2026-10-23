import { useEffect, useRef, useState } from 'react';
import { toast } from '../store/toastStore';
import { Link } from 'react-router-dom';
import type { TcgCard, Holding, Slab } from '@poketracker/shared/tcg/types';
import { cardValue, holdingId } from '@poketracker/shared/tcg/collection';
import CardImage from '../components/CardImage';
import { Modal } from '../components/forms';
import { BinderBook } from '../components/BinderView';
import { useSettings } from '../store/settingsStore';
import { Heart, RotateCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMoney } from '../hooks/useMoney';
import { useGame } from './context';
import { currentRates } from '../utils/fx';
export function ManaText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[^}]+\})/).map((part, n) =>
        part.startsWith('{') ? (
          <span
            key={n}
            aria-label={part.slice(1, -1)}
            className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded-full border border-line-strong bg-surface-2 px-1 font-mono text-xs"
            title={part}
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
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
export function HoldingForm({
  card,
  finish,
}: {
  card: TcgCard;
  finish: string;
}) {
  const { state, save, readOnly, busy } = useGame();
  const [open, setOpen] = useState(false);
  const entry = state.entries.find(
    (e) => e.cardId === card.id && e.finish === finish,
  );
  const [condition, setCondition] = useState(entry?.condition ?? 'NM'),
    [notes, setNotes] = useState(entry?.notes ?? ''),
    [value, setValue] = useState(entry?.valueUsd?.toString() ?? ''),
    [paid, setPaid] = useState(entry?.paid?.amount.toString() ?? ''),
    [currency, setCurrency] = useState<'USD' | 'GBP' | 'EUR'>(
      entry?.paid?.currency ?? 'USD',
    );
  if (readOnly) return null;
  return (
    <>
      <button
        className="flex w-full items-center justify-between gap-3 border-b border-line py-3 text-left text-sm hover:text-accent"
        onClick={() => setOpen(true)}
      >
        <span className="capitalize">
          {finish}{' '}
          <span className="ml-2 text-muted">
            {entry?.quantity ?? 0} owned · {entry?.condition ?? 'No details'}
          </span>
        </span>
        <span className="text-accent">Edit details →</span>
      </button>
      {open && (
        <Modal title={`${finish} copy details`} onClose={() => setOpen(false)}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const next: Holding = {
                ...entry,
                id: holdingId(card.id, finish),
                cardId: card.id,
                finish,
                quantity: entry?.quantity ?? 1,
                condition,
                notes,
                valueUsd: value === '' ? undefined : Number(value),
                paid:
                  paid === '' ? undefined : { amount: Number(paid), currency },
                addedAt: entry?.addedAt ?? new Date().toISOString(),
              };
              void save([{ kind: 'entry', id: next.id, data: next }]).then(
                (ok) => {
                  if (ok) setOpen(false);
                },
              );
            }}
          >
            <strong className="w-full">{finish}</strong>
            <label>
              Condition
              <select
                className="input block"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                {['M', 'NM', 'LP', 'MP', 'HP', 'DMG'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Paid per copy
              <input
                className="input block w-32"
                type="number"
                min="0"
                step="0.01"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
              />
            </label>
            <label>
              Currency
              <select
                className="input block"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof currency)}
              >
                {['USD', 'GBP', 'EUR'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Manual value (USD)
              <input
                className="input block w-36"
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <label>
              Notes
              <input
                className="input block"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={5000}
              />
            </label>
            <button className="btn btn-primary" disabled={busy}>
              Save details
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function GradedForm({ card }: { card: TcgCard }) {
  const { save, busy, readOnly } = useGame();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState('PSA'),
    [grade, setGrade] = useState('10'),
    [finish, setFinish] = useState(card.finishes[0] ?? ''),
    [cert, setCert] = useState(''),
    [value, setValue] = useState(''),
    [counts, setCounts] = useState(true);
  if (readOnly) return null;
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        Add graded slab
      </button>
      {open && (
        <Modal title="Add graded slab" onClose={() => setOpen(false)}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const slab: Slab = {
                id: crypto.randomUUID(),
                cardId: card.id,
                finish,
                company,
                grade,
                certNumber: cert,
                countsTowardSet: counts,
                valueUsd: value === '' ? undefined : Number(value),
                addedAt: new Date().toISOString(),
              };
              void save([{ kind: 'graded', id: slab.id, data: slab }]).then(
                (ok) => {
                  if (ok) setOpen(false);
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
              Add slab
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
