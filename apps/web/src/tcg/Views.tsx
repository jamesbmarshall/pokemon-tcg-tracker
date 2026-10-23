import { useState } from 'react';
import { Search, SlidersHorizontal, Layers, ArrowRight } from 'lucide-react';
import {
  PageHeader,
  EmptyState,
  ErrorState,
  CardSkeletonGrid,
  Segmented,
  ProgressBar,
} from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { useViewPref } from '../hooks/useViewPrefs';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TcgSearch } from '@poketracker/shared/tcg/types';
import { collectionValue, cardValue } from '@poketracker/shared/tcg/collection';
import { useGame } from './context';
import { gameApi } from './api';
import { PreconSearch, SearchTypeSwitch } from './Precons';
import { TcgGrid } from './Cards';
import { useMoney } from '../hooks/useMoney';
import { currentRates } from '../utils/fx';
import { api } from '../api/http';
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
      <PageHeader
        eyebrow="Your collection"
        title={module.name}
        actions={
          <Link className="btn btn-primary" to={`/${module.id}/search`}>
            Find cards <ArrowRight size={14} />
          </Link>
        }
      >
        Your cards, sets and decks, all in one place.
      </PageHeader>
      <div className="grid grid-cols-2 gap-6 border-b border-line pb-8 md:grid-cols-4">
        {[
          [money(value.valueUsd), 'Collection value'],
          [String(value.cards), 'Cards & slabs'],
          [String(sets.length), 'Sets collected'],
          [String(state.wishlist.length), 'Wishlist cards'],
        ].map(([n, label]) => (
          <div key={label} className="space-y-2">
            <p className="font-display text-3xl font-medium">{n}</p>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </div>
        ))}
      </div>
      {state.history.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Value history</h2>
          <ValueChart
            points={state.history}
            value={(p) => p.valueUsd}
            format={money}
          />
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
  const { module } = useGame();
  const [params] = useSearchParams();
  return module.capabilities.precons && params.get('tab') === 'precons' ? (
    <PreconSearch />
  ) : (
    <GameCardSearch />
  );
}
function GameCardSearch() {
  const { module, language } = useGame();
  const [params, setParams] = useSearchParams();
  const fields = Object.fromEntries(
    [...params.entries()].filter(([key]) => key !== 'tab'),
  );
  const [filters, setFilters] = useState(false);
  const debounced = useDebounced(new URLSearchParams(fields).toString(), 350);
  const query = Object.fromEntries(new URLSearchParams(debounced)) as TcgSearch;
  const page = Number(fields.page) || 1;
  const active = Object.entries(query).some(([k, v]) => k !== 'page' && !!v);
  const q = useQuery({
    queryKey: ['tcg-search', module.id, language, debounced],
    queryFn: () =>
      gameApi.search(module.id, {
        ...query,
        language,
        page: Number(query.page) || 1,
      }),
    enabled: active,
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const count = Object.entries(fields).filter(
    ([k, v]) => k !== 'q' && k !== 'page' && v,
  ).length;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={module.shortName}
        title="Search cards"
        actions={<SearchTypeSwitch />}
      >
        Find a particular printing, or explore the catalogue.
      </PageHeader>
      <form
        onSubmit={(e) => e.preventDefault()}
        className="sticky top-0 z-10 space-y-3 bg-canvas/95 py-3 backdrop-blur"
      >
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <Search size={18} className="absolute left-3 top-3.5 text-muted" />
            <span className="sr-only">Name or query</span>
            <input
              className="input w-full !pl-10"
              value={fields.q ?? ''}
              onChange={(e) => update('q', e.target.value)}
              placeholder={module.searchHint ?? 'Card name'}
              maxLength={500}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={filters}
            onClick={() => setFilters(!filters)}
          >
            <SlidersHorizontal size={16} />
            <span className="hidden sm:inline">Filters</span>
            {count > 0 && <span>{count}</span>}
          </button>
          {active && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setParams({})}
            >
              Clear
            </button>
          )}
        </div>
        {filters && (
          <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-3">
            {[
              { key: 'set', label: 'Set code' },
              { key: 'number', label: 'Collector number' },
              ...module.searchFields,
            ].map((f) => (
              <label className="text-xs text-muted" key={f.key}>
                {f.label}
                {'options' in f && f.options ? (
                  <select
                    className="input mt-1 w-full"
                    value={fields[f.key] ?? ''}
                    onChange={(e) => update(f.key, e.target.value)}
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
                    onChange={(e) => update(f.key, e.target.value)}
                    maxLength={200}
                  />
                )}
              </label>
            ))}
          </div>
        )}
      </form>
      {!active ? (
        <EmptyState
          icon={<Search size={28} />}
          title="What are you looking for?"
        >
          Search by name, set, collector number or card characteristics.
        </EmptyState>
      ) : q.isPending ? (
        <CardSkeletonGrid count={12} />
      ) : q.error ? (
        <ErrorState
          title="Couldn't search cards"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : (
        q.data && (
          <>
            <p role="status" className="eyebrow">
              {q.data.total.toLocaleString()} printings{' '}
              {q.isFetching ? '· Updating…' : ''}
            </p>
            {q.data.cards.length ? (
              <TcgGrid cards={q.data.cards} />
            ) : (
              <EmptyState
                icon={<Search size={28} />}
                title="No cards found"
                action={
                  module.capabilities.precons && (
                    <Link
                      className="btn btn-ghost"
                      to={`/${module.id}/search?${new URLSearchParams({ tab: 'precons', q: fields.q ?? '' })}`}
                    >
                      Search precons for this name <ArrowRight size={14} />
                    </Link>
                  )
                }
              >
                Try a different name or remove a filter.
              </EmptyState>
            )}
            <div className="flex items-center justify-center gap-4">
              <button
                className="btn btn-ghost"
                disabled={page === 1 || q.isFetching}
                onClick={() => setParams({ ...fields, page: String(page - 1) })}
              >
                Previous results
              </button>
              <span className="font-mono text-xs">Page {page}</span>
              <button
                className="btn btn-ghost"
                disabled={!q.data.hasMore || q.isFetching}
                onClick={() => setParams({ ...fields, page: String(page + 1) })}
              >
                Next results
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
export function GameSets({ id }: { id?: string }) {
  const { module, state, language } = useGame();
  const [filter, setFilter] = useState('');
  const [setStatus, setSetStatus] = useState('all');
  const [checklist, setChecklist] = useState('');
  const [ownership, setOwnership] = useState('all');
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
  const [view, setView] = useViewPref<'grid' | 'binder'>(
    `${module.id}.set`,
    'grid',
    ['grid', 'binder'],
  );
  const binder = view === 'binder';
  if (!id)
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={module.shortName} title="Sets">
          Explore releases and build your checklists.
        </PageHeader>
        <Segmented
          value={setStatus}
          onChange={setSetStatus}
          options={[
            { value: 'all', label: 'All sets' },
            { value: 'started', label: 'Started' },
          ]}
        />
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
            ?.filter(
              (s) =>
                setStatus === 'all' ||
                state.entries.some(
                  (e) =>
                    e.quantity > 0 &&
                    state.cards.some(
                      (c) => c.id === e.cardId && c.setId === s.id,
                    ),
                ) ||
                state.graded.some((g) =>
                  state.cards.some(
                    (c) => c.id === g.cardId && c.setId === s.id,
                  ),
                ),
            )
            .filter((s) =>
              `${s.name} ${s.code}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
            .map((s) => (
              <Link
                key={s.id}
                className="group flex items-center gap-4 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-accent"
                to={`/${module.id}/sets/${encodeURIComponent(s.id)}`}
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-surface-2 font-mono text-xs uppercase text-muted group-hover:text-accent">
                  {s.code}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-medium">{s.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {s.code.toUpperCase()} · {s.releaseDate} · {s.total}{' '}
                    catalogued cards
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {s.type.replaceAll('_', ' ')}
                  </p>
                </div>
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
      <PageHeader
        eyebrow="Set checklist"
        title={sets.data?.find((s) => s.id === id)?.name ?? id}
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'binder', label: 'Binder' },
            ]}
          />
        }
      >
        {regular.length} printings · {language.toUpperCase()}
      </PageHeader>
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
              <div className="space-y-2 border-b border-line py-4" key={k}>
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
                <ProgressBar value={p.owned} total={p.total} />
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
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-line bg-canvas/95 py-3 backdrop-blur">
        <label className="min-w-40 flex-1">
          <span className="sr-only">Filter checklist</span>
          <input
            className="input w-full"
            placeholder="Filter checklist…"
            value={checklist}
            onChange={(e) => setChecklist(e.target.value)}
          />
        </label>
        <Segmented
          label="Ownership"
          value={ownership}
          onChange={setOwnership}
          options={[
            { value: 'all', label: 'All' },
            { value: 'owned', label: 'Owned' },
            { value: 'missing', label: 'Missing' },
          ]}
        />
      </div>
      <TcgGrid
        cards={regular.filter((c) => {
          const owned =
            state.entries.some((e) => e.cardId === c.id && e.quantity > 0) ||
            state.graded.some((g) => g.cardId === c.id && g.countsTowardSet);
          return (
            `${c.name} ${c.number}`
              .toLowerCase()
              .includes(checklist.toLowerCase()) &&
            (ownership === 'all' || (ownership === 'owned' ? owned : !owned))
          );
        })}
        binder={binder}
      />
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
  const { module, state } = useGame();
  const money = useMoney();
  const [view, setView] = useViewPref<'grid' | 'binder'>(
    `${module.id}.${wishlist ? 'wishlist' : 'collection'}`,
    'grid',
    ['grid', 'binder'],
  );
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('name');
  const [set, setSet] = useState('');
  const ids = new Set(
    wishlist
      ? state.wishlist
      : [
          ...state.entries.filter((e) => e.quantity > 0).map((e) => e.cardId),
          ...state.graded.map((g) => g.cardId),
        ],
  );
  const all = state.cards.filter((c) => ids.has(c.id));
  const cards = all
    .filter(
      (c) =>
        (!set || c.setId === set) &&
        `${c.name} ${c.number} ${c.setName}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'value'
        ? (cardValue(b, b.finishes[0], currentRates().EUR) ?? 0) -
          (cardValue(a, a.finishes[0], currentRates().EUR) ?? 0)
        : sort === 'set'
          ? a.setName.localeCompare(b.setName) ||
            a.number.localeCompare(b.number, undefined, { numeric: true })
          : a.name.localeCompare(b.name),
    );
  const cost = all.reduce(
    (n, c) => n + (cardValue(c, c.finishes[0], currentRates().EUR) ?? 0),
    0,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={module.shortName}
        title={wishlist ? 'Wishlist' : 'Collection'}
        actions={
          <Link className="btn btn-ghost" to={`/${module.id}/search`}>
            Find cards <ArrowRight size={14} />
          </Link>
        }
      >
        {all.length} unique printings
        {wishlist
          ? ` · ${money(cost)} estimated cost`
          : ` · ${state.entries.reduce((n, e) => n + e.quantity, 0)} copies`}
      </PageHeader>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-canvas/95 py-3 backdrop-blur">
        <label className="relative min-w-40 flex-1">
          <Search size={16} className="absolute left-3 top-3 text-muted" />
          <span className="sr-only">Filter cards</span>
          <input
            className="input w-full !pl-9"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter cards…"
          />
        </label>
        <select
          className="input !w-auto max-w-48"
          aria-label="Filter by set"
          value={set}
          onChange={(e) => setSet(e.target.value)}
        >
          <option value="">All sets</option>
          {[...new Map(all.map((c) => [c.setId, c.setName])).entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
        </select>
        <select
          className="input !w-auto"
          aria-label="Sort cards"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">Name</option>
          <option value="value">Highest value</option>
          <option value="set">Set & number</option>
        </select>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'binder', label: 'Binder' },
          ]}
        />
      </div>
      {cards.length ? (
        <TcgGrid cards={cards} binder={view === 'binder'} wishlist={wishlist} />
      ) : (
        <EmptyState
          icon={<Layers size={28} />}
          title={
            all.length
              ? 'No matching cards'
              : wishlist
                ? 'Your wishlist is empty'
                : 'Your collection starts here'
          }
          action={
            <Link className="btn btn-primary" to={`/${module.id}/search`}>
              Find cards
            </Link>
          }
        >
          {all.length
            ? 'Try a different filter.'
            : 'Browse a set or search for a card to get started.'}
        </EmptyState>
      )}
    </div>
  );
}
export { GameCard } from './CardPage';
