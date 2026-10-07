import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRememberedParams } from '../hooks/useViewPrefs';
import { isLang, langOf, language } from '../api/languages';
import { LanguagePicker } from '../components/Language';
import { SetLogo, SetSymbol } from '../components/SetArt';
import { Search, X } from 'lucide-react';
import { useSets } from '../api/hooks';
import { useCollectionStats } from '../hooks/useCollectionStats';
import { PageHeader, ProgressBar, Segmented, Skeleton, ErrorState } from '../components/ui';
import { formatDate, pct } from '../utils/format';
import type { CardSet } from '../api/types';

type Filter = 'all' | 'started' | 'complete';

export default function SetsPage() {
  const { get, update } = useRememberedParams('sets', ['filter', 'series', 'lang']);
  const langParam = get('lang');
  const lang = isLang(langParam) ? langParam : 'en';
  const { data: sets, isLoading, error, refetch } = useSets(lang);
  const stats = useCollectionStats();
  const [q, setQ] = useState('');
  const filterParam = get('filter');
  const filter: Filter = filterParam === 'started' || filterParam === 'complete' ? filterParam : 'all';
  const series = get('series');

  const progress = useMemo(() => new Map(stats.sets.map((s) => [s.setId, s])), [stats.sets]);
  const startedHere = useMemo(() => stats.sets.filter((s) => langOf(s.setId) === lang).length, [stats.sets, lang]);
  const allSeries = useMemo(() => Array.from(new Set(sets?.map((s) => s.series))), [sets]);

  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, CardSet[]>();
    for (const s of sets ?? []) {
      if (series && s.series !== series) continue;
      if (needle && !s.name.toLowerCase().includes(needle) && s.ptcgoCode?.toLowerCase() !== needle) continue;
      const p = progress.get(s.id);
      if (filter === 'started' && !p) continue;
      if (filter === 'complete' && !(p && p.baseOwned >= s.printedTotal)) continue;
      const arr = out.get(s.series) ?? [];
      arr.push(s);
      out.set(s.series, arr);
    }
    return out;
  }, [sets, q, series, filter, progress]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={sets ? `${sets.length} ${lang === 'en' ? '' : `${language(lang).name} `}sets · ${allSeries.length} series` : 'Loading catalogue'}
        title="Sets"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LanguagePicker
              value={lang}
              onChange={(l) => update({ series: '', lang: l === 'en' ? '' : l })}
            />
            <Segmented<Filter>
              value={filter}
              onChange={(v) => update('filter', v === 'all' ? '' : v)}
              options={[
                { value: 'all', label: 'All' },
                {
                  value: 'started',
                  label: `Started${startedHere ? ` · ${startedHere}` : ''}`,
                },
                { value: 'complete', label: 'Complete' },
              ]}
            />
          </div>
        }
      />

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sets by name or code (e.g. MEW)" className="input !pl-10" />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-fg" aria-label="Clear">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="scroll-x -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button className="chip shrink-0" data-active={!series} onClick={() => update('series', '')}>
            All series
          </button>
          {allSeries.map((s) => (
            <button key={s} className="chip shrink-0" data-active={series === s} onClick={() => update('series', series === s ? '' : s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && !sets && <ErrorState title="Couldn't load sets" error={error} onRetry={() => refetch()} />}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      )}

      {!isLoading && grouped.size === 0 && (
        <p className="border-y border-line py-12 text-center text-sm text-muted">
          {filter === 'started' ? 'You haven’t started any sets yet — open one and tap a card to begin.' : 'No sets match.'}
        </p>
      )}

      {Array.from(grouped, ([name, list]) => (
        <section key={name}>
          <div className="sticky top-14 z-10 -mx-4 mb-5 flex items-baseline gap-3 border-b border-line bg-canvas/95 px-4 py-2.5 lg:top-0">
            <h2 className="font-display text-2xl font-medium">{name}</h2>
            <span className="font-mono text-xs text-faint">{list.length} sets</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {list.map((s) => {
              const p = progress.get(s.id);
              const done = p && p.baseOwned >= s.printedTotal;
              return (
                <Link
                  key={s.id}
                  to={`/sets/${s.id}`}
                  className={`group relative flex flex-col rounded-lg border bg-surface p-4 transition-colors hover:border-line-strong ${done ? 'border-accent/40' : 'border-line'}`}
                >
                  <div className="grid h-20 place-items-center">
                    <SetLogo
                      src={s.images.logo}
                      name={s.name}
                      className="max-h-16 max-w-[80%] object-contain drop-shadow-logo transition-transform duration-300 group-hover:scale-105"
                      fallbackClassName="px-4 text-center text-lg text-muted"
                    />
                  </div>
                  <div className="mt-3 flex items-start gap-2">
                    <SetSymbol src={s.images.symbol} className="mt-0.5 h-4 w-4 object-contain" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[1.05rem] font-medium leading-snug group-hover:text-accent">{s.name}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {formatDate(s.releaseDate)}
                        {s.printedTotal || s.total ? ` · ${s.printedTotal || s.total}` : ''}
                        {s.printedTotal && s.total > s.printedTotal ? `+${s.total - s.printedTotal}` : ''}
                      </p>
                    </div>
                    {s.ptcgoCode && <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">{s.ptcgoCode}</span>}
                  </div>
                  {p && (
                    <div className="mt-3">
                      <div className="mb-1.5 flex justify-between font-mono text-[11px] tabular">
                        <span className={done ? 'holo-text font-bold' : 'text-muted'}>
                          {done ? 'Base set complete' : `${p.baseOwned}/${s.printedTotal}`}
                          {p.uniqueOwned > p.baseOwned && (
                            <span className="ml-1.5 text-accent" title="Cards numbered above the printed set total">
                              +{p.uniqueOwned - p.baseOwned} secret
                            </span>
                          )}
                        </span>
                        <span className="text-faint">{Math.floor(pct(p.baseOwned, s.printedTotal))}%</span>
                      </div>
                      <ProgressBar value={p.baseOwned} total={s.printedTotal} />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
