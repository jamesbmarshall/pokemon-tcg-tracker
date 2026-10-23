import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TcgSearch } from '@poketracker/shared/tcg/types';
import { collectionValue, cardValue } from '@poketracker/shared/tcg/collection';
import { useGame } from './context';
import { gameApi } from './api';
import {
  TcgGrid,
  TcgCardTile,
  ManaText,
  GradedForm,
  HoldingForm,
} from './Cards';
import { useMoney } from '../hooks/useMoney';
import { currentRates } from '../utils/fx';
import { api } from '../api/http';
import { AssetTools } from './extras';
import ValueChart from '../components/ValueChart';
export function GameDashboard() {
  const { module, state } = useGame();
  const money = useMoney();
  const value = collectionValue(
    state.cards,
    state.entries,
    state.graded,
    state.sealed,
    currentRates().EUR,
  );
  const owned = new Set([
    ...state.entries.filter((e) => e.quantity > 0).map((e) => e.cardId),
    ...state.graded.map((g) => g.cardId),
  ]);
  const top = state.cards
    .filter((c) => owned.has(c.id))
    .sort(
      (a, b) =>
        (cardValue(b, b.finishes[0], currentRates().EUR) ?? 0) -
        (cardValue(a, a.finishes[0], currentRates().EUR) ?? 0),
    );
  const sets = [...new Set(top.map((c) => c.setId))];
  const { collectionId } = useGame();
  const movers = useQuery({
    queryKey: ['tcg-movers', collectionId, module.id, state.revision],
    queryFn: () =>
      api<
        {
          cardId: string;
          name: string;
          finish: string;
          valueUsd: number;
          changeUsd: number;
          changePct: number | null;
        }[]
      >(`/api/collections/${collectionId}/games/${module.id}/movers`),
  });
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Your collection</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          {module.name}
        </h1>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [money(value.valueUsd), 'Collection value'],
          [String(value.cards), 'Cards & slabs'],
          [String(sets.length), 'Sets collected'],
          [String(state.wishlist.length), 'Wishlist cards'],
        ].map(([n, label]) => (
          <div key={label} className="rounded-xl border border-line p-4">
            <p className="font-display text-2xl font-semibold">{n}</p>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </div>
        ))}
      </div>
      {state.history.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Value history</h2>
          <div
            className="flex h-40 items-end gap-1 rounded-xl border border-line p-3"
            role="img"
            aria-label="Daily collection value history"
          >
            {state.history.slice(-60).map((p) => (
              <div
                key={p.date}
                title={`${p.date}: ${money(p.valueUsd)}`}
                className="min-w-1 flex-1 rounded-t bg-accent/70"
                style={{
                  height: `${Math.max(1, (100 * p.valueUsd) / Math.max(1, ...state.history.slice(-60).map((p) => p.valueUsd)))}%`,
                }}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {state.history.at(-60)?.date ?? state.history[0].date} –{' '}
            {state.history.at(-1)?.date}
          </p>
        </section>
      )}
      {!owned.size && (
        <p className="rounded-xl border border-line p-6 text-muted">
          Start with{' '}
          <Link className="text-accent" to={`/${module.id}/sets`}>
            a set checklist
          </Link>{' '}
          or{' '}
          <Link className="text-accent" to={`/${module.id}/search`}>
            find a card
          </Link>
          .
        </p>
      )}
      {!!movers.data?.length && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Biggest movers · 7 days</h2>
          {movers.data.map((m) => (
            <Link
              className="flex flex-wrap justify-between gap-2 rounded-lg border border-line p-3 text-sm"
              key={`${m.cardId}:${m.finish}`}
              to={`/${module.id}/card/${encodeURIComponent(m.cardId)}`}
            >
              <span>
                {m.name} · {m.finish}
              </span>
              <span>
                {money(m.valueUsd)} · {m.changeUsd >= 0 ? '+' : ''}
                {money(m.changeUsd)}{' '}
                {m.changePct === null ? '' : `(${m.changePct.toFixed(1)}%)`}
              </span>
            </Link>
          ))}
        </section>
      )}
      {!!top.length && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Most valuable cards</h2>
          <TcgGrid cards={top.slice(0, 8)} />
        </section>
      )}
      {!!sets.length && (
        <section className="space-y-2">
          <h2 className="font-semibold">Sets in progress</h2>
          {sets.map((id) => (
            <Link
              key={id}
              className="mr-3 inline-block rounded-lg border border-line p-3 text-accent"
              to={`/${module.id}/sets/${encodeURIComponent(id)}`}
            >
              {top.find((c) => c.setId === id)?.setName}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
export function GameSearch() {
  const { module, language } = useGame();
  const [fields, setFields] = useState<Record<string, string>>({}),
    [query, setQuery] = useState<TcgSearch>({ language, q: '' }),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['tcg-search', module.id, query, page],
    queryFn: () => gameApi.search(module.id, { ...query, language, page }),
  });
  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold">
        Search {module.shortName}
      </h1>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery({ ...fields, language });
        }}
      >
        <label className="sm:col-span-3">
          Name or query
          <input
            className="input mt-1 w-full"
            value={fields.q ?? ''}
            onChange={(e) => setFields({ ...fields, q: e.target.value })}
            placeholder={module.searchHint ?? 'Card name'}
            maxLength={500}
          />
        </label>
        {[
          { key: 'set', label: 'Set code' },
          { key: 'number', label: 'Collector number' },
          ...module.searchFields,
        ].map((f) => (
          <label className="text-sm" key={f.key}>
            {f.label}
            {'options' in f && f.options ? (
              <select
                className="input mt-1 w-full"
                value={fields[f.key] ?? ''}
                onChange={(e) =>
                  setFields({ ...fields, [f.key]: e.target.value })
                }
              >
                <option value="">Any</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input mt-1 w-full"
                value={fields[f.key] ?? ''}
                onChange={(e) =>
                  setFields({ ...fields, [f.key]: e.target.value })
                }
                maxLength={200}
              />
            )}
          </label>
        ))}
        <button className="btn btn-primary self-end" disabled={q.isFetching}>
          Search
        </button>
      </form>
      {q.isPending && <p role="status">Searching…</p>}
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data && (
        <>
          <p className="text-sm text-muted">
            {q.data.total.toLocaleString()} printings
          </p>
          <TcgGrid cards={q.data.cards} />
          <div className="flex gap-3">
            <button
              className="btn btn-ghost"
              disabled={page === 1 || q.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous results
            </button>
            <button
              className="btn btn-ghost"
              disabled={!q.data.hasMore || q.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next results
            </button>
          </div>
        </>
      )}
    </div>
  );
}
export function GameSets({ id }: { id?: string }) {
  const { module, state, language } = useGame();
  const [filter, setFilter] = useState('');
  const sets = useQuery({
    queryKey: ['tcg-sets', module.id],
    queryFn: () => gameApi.sets(module.id),
    staleTime: 6 * 3600_000,
  });
  const detail = useQuery({
    queryKey: ['tcg-set', module.id, id, language],
    queryFn: () => gameApi.set(module.id, id!, language),
    enabled: !!id,
  });
  const [binder, setBinder] = useState(false);
  if (!id)
    return (
      <div className="space-y-5">
        <h1 className="font-display text-3xl font-semibold">Sets</h1>
        <label className="block">
          Filter sets
          <input
            className="input mt-1 w-full"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        {sets.isPending && <p role="status">Loading sets…</p>}
        {sets.error && <p role="alert">{sets.error.message}</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sets.data
            ?.filter((s) =>
              `${s.name} ${s.code}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
            .map((s) => (
              <Link
                key={s.id}
                className="rounded-xl border border-line p-4 hover:border-accent"
                to={`/${module.id}/sets/${encodeURIComponent(s.id)}`}
              >
                <h2 className="font-semibold">{s.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {s.code.toUpperCase()} · {s.releaseDate} · {s.total}{' '}
                  catalogued cards
                </p>
                <p className="mt-1 text-xs text-muted">
                  {s.type.replaceAll('_', ' ')}
                </p>
              </Link>
            ))}
        </div>
      </div>
    );
  const cards = detail.data?.cards ?? [],
    regular = cards.filter((c) => !c.extra),
    extras = cards.filter((c) => c.extra);
  const completion = module.complete(
    regular,
    state.entries,
    state.graded,
    detail.data?.complete ?? false,
  );
  return (
    <div className="space-y-5">
      <Link className="text-accent" to={`/${module.id}/sets`}>
        ← Sets
      </Link>
      <h1 className="font-display text-3xl font-semibold">
        {sets.data?.find((s) => s.id === id)?.name ?? id}
      </h1>
      {detail.isPending && (
        <p role="status">Loading the complete language checklist…</p>
      )}
      {detail.error && <p role="alert">{detail.error.message}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.entries(completion)
          .filter(([k]) => k !== 'complete')
          .map(([k, v]) => {
            const p = v as { owned: number; total: number };
            return (
              <div className="rounded-lg border border-line p-4" key={k}>
                <p className="font-semibold">
                  {k === 'cards'
                    ? 'Distinct cards'
                    : k === 'printings'
                      ? 'All printings'
                      : 'Every finish'}
                </p>
                <p>
                  {p.owned}/{p.total} ·{' '}
                  {p.total ? Math.round((100 * p.owned) / p.total) : 0}%
                </p>
                <progress
                  className="mt-2 w-full"
                  value={p.owned}
                  max={p.total || 1}
                />
              </div>
            );
          })}
      </div>
      {!completion.complete && (
        <p className="text-sm text-muted">
          Catalogue coverage is incomplete or may be out of date. Completion
          refers only to the current catalogue.
        </p>
      )}
      <button className="btn btn-ghost" onClick={() => setBinder(!binder)}>
        {binder ? 'Grid view' : 'Binder view'}
      </button>
      <TcgGrid cards={regular} binder={binder} />
      {!!extras.length && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Tokens & extras</h2>
          <TcgGrid cards={extras} />
        </section>
      )}
    </div>
  );
}
export function GameCollection({ wishlist = false }: { wishlist?: boolean }) {
  const { state, save, remove, busy, readOnly } = useGame();
  const money = useMoney();
  const [binder, setBinder] = useState(false),
    [filter, setFilter] = useState('');
  const ids = new Set(
    wishlist
      ? state.wishlist
      : [
          ...state.entries.filter((e) => e.quantity > 0).map((e) => e.cardId),
          ...state.graded.map((g) => g.cardId),
        ],
  );
  const cards = state.cards.filter(
    (c) => ids.has(c.id) && c.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const cost = cards.reduce(
    (n, c) => n + (cardValue(c, c.finishes[0], currentRates().EUR) ?? 0),
    0,
  );
  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold">
        {wishlist ? 'Wishlist' : 'Collection'}
      </h1>
      {wishlist && (
        <p className="text-muted">
          Estimated cost: {money(cost)} · unavailable quotes excluded
        </p>
      )}
      <div className="flex gap-3">
        <label className="flex-1">
          Filter cards
          <input
            className="input mt-1 w-full"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <button
          className="btn btn-ghost self-end"
          onClick={() => setBinder(!binder)}
        >
          {binder ? 'Grid' : 'Binder'}
        </button>
      </div>
      <TcgGrid cards={cards} binder={binder} />
      {wishlist &&
        !readOnly &&
        cards.map((c) => (
          <button
            className="btn btn-ghost mr-2"
            key={c.id}
            disabled={busy}
            onClick={() =>
              void save([
                {
                  kind: 'entry',
                  id: `${c.id}::${c.finishes[0]}`,
                  data: {
                    id: `${c.id}::${c.finishes[0]}`,
                    cardId: c.id,
                    finish: c.finishes[0],
                    quantity:
                      (state.entries.find(
                        (e) => e.cardId === c.id && e.finish === c.finishes[0],
                      )?.quantity ?? 0) + 1,
                    addedAt: new Date().toISOString(),
                  },
                },
              ]).then((ok) => {
                if (ok) void remove('wishlist', c.id);
              })
            }
          >
            Got {c.name}
          </button>
        ))}
    </div>
  );
}
export function GameCard({ id }: { id: string }) {
  const money = useMoney();
  const [priceSeries, setPriceSeries] = useState('');
  const { module, state, save, busy, readOnly } = useGame();
  const [selectedList, setSelectedList] = useState(''),
    [zone, setZone] = useState('main'),
    [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['tcg-card', module.id, id],
    queryFn: () => gameApi.card(module.id, id),
  });
  const history = useQuery({
    queryKey: ['tcg-prices', module.id, id],
    queryFn: () =>
      api<
        {
          finish: string;
          source: string;
          date: string;
          price: number;
          currency: string;
        }[]
      >(`/api/games/${module.id}/cards/${encodeURIComponent(id)}/prices`),
  });
  const printings = useQuery({
    queryKey: ['tcg-reprints', module.id, id],
    queryFn: () =>
      gameApi.search(module.id, {
        q: `oracleid:${String(q.data?.details.oracleId ?? '')}`,
      }),
    enabled: !!q.data?.details.oracleId,
  });
  const c = q.data;
  if (!c)
    return (
      <p role={q.error ? 'alert' : 'status'}>
        {q.error?.message ?? 'Loading card…'}
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <TcgCardTile card={c} />
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-semibold">
            {c.printedName ?? c.name}
          </h1>
          <Link
            className="text-accent"
            to={`/${module.id}/sets/${encodeURIComponent(c.setId)}`}
          >
            {c.setName} · {c.number}
          </Link>
          {c.faces.map((f, n) => (
            <section
              className="space-y-2 rounded-lg border border-line p-4"
              key={n}
            >
              <h2 className="font-semibold">
                {f.name} <ManaText text={f.manaCost ?? ''} />
              </h2>
              <p className="text-sm text-muted">{f.typeLine}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                <ManaText text={f.text} />
              </p>
              <p>
                {[
                  f.power !== undefined ? `${f.power}/${f.toughness}` : '',
                  f.loyalty ? `Loyalty ${f.loyalty}` : '',
                  f.defense ? `Defense ${f.defense}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </section>
          ))}
          <p className="text-sm text-muted">
            {c.rarity} · {c.artist} · {c.treatments.join(', ')}
          </p>
          <p className="text-xs text-muted">
            Catalogue refreshed {new Date(c.fetchedAt).toLocaleString()}
          </p>
        </div>
      </div>
      {!!module.cardFacts && (
        <dl className="flex flex-wrap gap-5">
          {module.cardFacts(c).map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Market prices</h2>
        {c.finishes.map((finish) => (
          <div key={finish} className="rounded-lg border border-line p-3">
            <strong>
              {finish} · {money(cardValue(c, finish, currentRates().EUR))}
            </strong>
            {(c.prices[finish] ?? []).map((quote) => (
              <p key={quote.source} className="mt-1 text-xs text-muted">
                {quote.source} · {quote.currency} {quote.amount.toFixed(2)} ·
                retrieved {new Date(quote.at).toLocaleDateString()}
              </p>
            ))}
          </div>
        ))}
      </section>
      {!readOnly && (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Owned copies</h2>
            {c.finishes.map((f) => (
              <HoldingForm key={`${c.id}:${f}`} card={c} finish={f} />
            ))}
          </section>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save([
                {
                  kind: 'note',
                  id: c.id,
                  data: {
                    id: c.id,
                    text:
                      note ??
                      state.notes.find((n) => n.id === c.id)?.text ??
                      '',
                  },
                },
              ]);
            }}
          >
            <label>
              Card note
              <textarea
                className="input mt-1 min-h-24 w-full"
                value={
                  note ?? state.notes.find((n) => n.id === c.id)?.text ?? ''
                }
                onChange={(e) => setNote(e.target.value)}
                maxLength={5000}
              />
            </label>
            <button className="btn btn-ghost" disabled={busy}>
              Save note
            </button>
          </form>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const list = state.lists.find((l) => l.id === selectedList);
              if (!list) return;
              const section = list.kind === 'list' ? 'main' : zone;
              const existing = list.items.find(
                (i) => i.cardId === c.id && i.zone === section,
              );
              const items = existing
                ? list.items.map((i) =>
                    i === existing
                      ? {
                          ...i,
                          quantity: list.kind === 'list' ? 1 : i.quantity + 1,
                        }
                      : i,
                  )
                : [...list.items, { cardId: c.id, quantity: 1, zone: section }];
              void save([
                { kind: 'list', id: list.id, data: { ...list, items } },
              ]);
            }}
          >
            <label>
              Add to list or deck
              <select
                className="input block"
                value={selectedList}
                onChange={(e) => setSelectedList(e.target.value)}
              >
                <option value="">Choose list</option>
                {state.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Section
              <select
                className="input block"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              >
                {['main', 'commander', 'companion', 'maybeboard'].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !selectedList}
              className="btn btn-primary"
            >
              Add card
            </button>
            <Link className="btn btn-ghost" to={`/${module.id}/lists`}>
              Create deck or list
            </Link>
          </form>
        </>
      )}
      {module.capabilities.graded && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Graded slabs</h2>
          <GradedForm card={c} />
          {state.graded
            .filter((g) => g.cardId === c.id)
            .map((g) => (
              <div
                key={g.id}
                className="space-y-2 rounded-xl border border-line p-4"
              >
                <p>
                  {g.company} {g.grade} · {g.finish} · {g.certNumber}
                </p>
                <AssetTools kind="graded" item={g} />
              </div>
            ))}
        </section>
      )}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Price history</h2>
        {!!history.data?.length && (
          <div className="mb-4 space-y-3">
            <label>
              Printing finish and source
              <select
                className="input ml-2"
                value={
                  priceSeries ||
                  `${history.data[0].finish}:${history.data[0].source}`
                }
                onChange={(e) => setPriceSeries(e.target.value)}
              >
                {[
                  ...new Set(
                    history.data.map((p) => `${p.finish}:${p.source}`),
                  ),
                ].map((series) => (
                  <option key={series} value={series}>
                    {series.replace(':', ' · ')}
                  </option>
                ))}
              </select>
            </label>
            <ValueChart
              points={history.data.filter(
                (p) =>
                  `${p.finish}:${p.source}` ===
                  (priceSeries ||
                    `${history.data![0].finish}:${history.data![0].source}`),
              )}
              value={(p) =>
                p.currency === 'EUR' ? p.price / currentRates().EUR : p.price
              }
              format={money}
              emptyMessage="Price history builds daily from the first quote observed by this instance."
            />
          </div>
        )}
        {history.data?.length ? (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Finish</th>
                  <th>Source</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((p, n) => (
                  <tr key={n}>
                    <td>{p.date}</td>
                    <td>{p.finish}</td>
                    <td>{p.source}</td>
                    <td>
                      {p.currency} {p.price.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">
            History begins when this instance first observes a quote.
          </p>
        )}
      </section>
      {!!printings.data?.cards.length && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Other printings</h2>
          <TcgGrid cards={printings.data.cards.filter((p) => p.id !== c.id)} />
        </section>
      )}
    </div>
  );
}
