import { useEffect, useRef, useState } from 'react';
import { toast } from '../store/toastStore';
import { Link } from 'react-router-dom';
import type { TcgCard, Holding, Slab } from '@poketracker/shared/tcg/types';
import { cardValue, holdingId } from '@poketracker/shared/tcg/collection';
import { imageSrc } from '../api/client';
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
}: {
  card: TcgCard;
  quick?: boolean;
}) {
  const { module, state, save, readOnly, busy } = useGame();
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
    <article className="min-w-0 space-y-2 rounded-xl border border-line bg-surface p-3">
      <Link
        to={`/${module.id}/card/${encodeURIComponent(card.id)}`}
        className="block"
      >
        {image ? (
          <img
            src={imageSrc(image)}
            alt={card.printedName ?? card.name}
            loading="lazy"
            className="mx-auto aspect-[0.716] w-full rounded-lg object-contain"
          />
        ) : (
          <div className="grid aspect-[0.716] place-items-center rounded-lg bg-surface-2 p-3 text-center">
            {card.name}
          </div>
        )}
        <h3 className="mt-2 truncate font-semibold">
          {card.printedName ?? card.name}
        </h3>
      </Link>
      <p className="truncate text-xs text-muted">
        {card.setName} · {card.number} · {card.language.toUpperCase()}
      </p>
      <div className="flex items-center justify-between text-xs">
        <span>{owned} owned</span>
        {card.faces.filter((f) => f.image).length > 1 && (
          <button
            className="btn btn-ghost !px-2 !py-1"
            onClick={() => setFace((face + 1) % card.faces.length)}
          >
            Flip
          </button>
        )}
      </div>
      {quick && !readOnly && (
        <div className="flex flex-wrap gap-1">
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
                            entry.cardId === card.id && entry.finish === finish,
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
                                current?.addedAt ?? new Date().toISOString(),
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
                className="flex items-center rounded border border-line text-xs"
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
                  className="px-1 py-2"
                  title={
                    price === undefined ? 'Price unavailable' : money(price)
                  }
                >
                  {finish} {quantity}
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
      {quick && !readOnly && <WishlistButton card={card} wanted={wanted} />}
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
      className="btn btn-ghost w-full !text-xs"
      onClick={() =>
        void (wanted
          ? remove('wishlist', card.id)
          : save([{ kind: 'wishlist', id: card.id, data: { id: card.id } }]))
      }
    >
      {wanted ? '♥ On wishlist' : '♡ Add to wishlist'}
    </button>
  );
}
export function TcgGrid({
  cards,
  binder = false,
}: {
  cards: TcgCard[];
  binder?: boolean;
}) {
  const [page, setPage] = useState(0);
  const size = binder ? 18 : 48;
  const max = Math.max(0, Math.ceil(cards.length / size) - 1);
  const current = Math.min(page, max);
  const visible = cards.slice(current * size, (current + 1) * size);
  return (
    <>
      <div
        className={
          binder
            ? 'grid grid-cols-3 gap-2 rounded-xl border-4 border-line bg-surface-2 p-3 md:grid-cols-6'
            : 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'
        }
      >
        {visible.map((c) => (
          <TcgCardTile card={c} key={c.id} />
        ))}
        {binder &&
          Array.from({ length: size - visible.length }, (_, n) => (
            <div
              key={`empty-${n}`}
              className="aspect-[0.716] rounded-lg border border-dashed border-line"
              aria-label="Empty binder pocket"
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
            Previous
          </button>
          <span className="self-center text-sm">
            Page {current + 1} of {max + 1}
          </span>
          <button
            className="btn btn-ghost"
            disabled={current >= max}
            onClick={() => setPage(current + 1)}
          >
            Next
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
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-3"
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
          paid: paid === '' ? undefined : { amount: Number(paid), currency },
          addedAt: entry?.addedAt ?? new Date().toISOString(),
        };
        void save([{ kind: 'entry', id: next.id, data: next }]);
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
  );
}
export function GradedForm({ card }: { card: TcgCard }) {
  const { save, busy, readOnly } = useGame();
  const [company, setCompany] = useState('PSA'),
    [grade, setGrade] = useState('10'),
    [finish, setFinish] = useState(card.finishes[0] ?? ''),
    [cert, setCert] = useState(''),
    [value, setValue] = useState(''),
    [counts, setCounts] = useState(true);
  if (readOnly) return null;
  return (
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
        void save([{ kind: 'graded', id: slab.id, data: slab }]);
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
  );
}
