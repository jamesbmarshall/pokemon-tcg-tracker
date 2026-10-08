import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoaderCircle, Search, SlidersHorizontal, X } from 'lucide-react';
import { useRarities, useSearch } from '../api/hooks';
import type { SearchFilters } from '../api/client';
import { useDebounced } from '../hooks/useDebounced';
import CardGrid from '../components/CardGrid';
import { CardSkeletonGrid, Energy, ErrorState, PageHeader } from '../components/ui';
import { ENERGY_TYPES } from '../utils/energy';
import { LANGUAGES, isLang, language, type Lang } from '../api/languages';
import { useSettings } from '../store/settingsStore';

const SUPERTYPES = ['Pokémon', 'Trainer', 'Energy'];
/** English plus Japanese: an English query also finds the Japanese printings of that Pokémon. */
const DEFAULT_LANGS = 'en,ja';
const SUGGESTIONS = ['Charizard', 'Pikachu', 'Umbreon', 'Mew', 'Gengar', 'Rayquaza', 'Eevee', 'Lugia'];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(params.get('q') ?? '');
  const [artist, setArtist] = useState(params.get('artist') ?? '');
  const [showFilters, setShowFilters] = useState(!!(params.get('artist') || params.get('types') || params.get('rarity') || params.get('supertype')));
  const types = useMemo(() => params.get('types')?.split(',').filter(Boolean) ?? [], [params]);
  const rarity = params.get('rarity') ?? '';
  const supertype = params.get('supertype') ?? '';
  const sortParam = params.get('sort');
  const sort: SearchFilters['sort'] = sortParam === 'oldest' || sortParam === 'name' ? sortParam : 'newest';
  const savedLangs = useSettings((s) => s.viewPrefs['search.langs']);
  const setPref = useSettings((s) => s.setViewPref);
  const langs = useMemo<Lang[]>(() => {
    const list = (params.get('langs') ?? savedLangs ?? DEFAULT_LANGS).split(',').filter(isLang);
    return list.length ? list : ['en'];
  }, [params, savedLangs]);
  const { data: rarities } = useRarities(langs.includes('en') ? 'en' : langs[0]);
  const toggleLang = (l: Lang) => {
    const next = langs.includes(l) ? langs.filter((x) => x !== l) : LANGUAGES.map((x) => x.code).filter((c) => c === l || langs.includes(c));
    if (!next.length) return;
    setPref('search.langs', next.join(','));
    set('langs', next.join(','));
  };

  const dName = useDebounced(name, 350);
  const dArtist = useDebounced(artist, 400);

  const set = (k: string, v: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    set('q', dName.trim());
  }, [dName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    set('artist', dArtist.trim());
  }, [dArtist]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters: SearchFilters = { name: dName.trim(), artist: dArtist.trim(), types, rarity, supertype, sort, langs };
  const hasQuery = dName.trim().length >= 2 || !!dArtist.trim() || types.length > 0 || !!rarity || !!supertype;
  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, error, refetch } = useSearch(filters, hasQuery);
  const cards = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.totalCount ?? 0;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const activeCount = types.length + (rarity ? 1 : 0) + (supertype ? 1 : 0) + (artist ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={langs.length === 1 && langs[0] === 'en' ? 'Every English card since 1999' : `Searching ${langs.map((l) => language(l).name).join(' + ')}`} title="Search" />

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={langs.includes('en') ? 'Card name, e.g. Umbreon VMAX' : 'Card name, e.g. ピカチュウ'}
              className="input !h-12 !rounded-lg !pl-11 !text-base"
            />
            {isFetching && !isFetchingNextPage ? (
              <LoaderCircle size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted" />
            ) : (
              name && (
                <button onClick={() => setName('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-faint hover:text-fg" aria-label="Clear">
                  <X size={16} />
                </button>
              )
            )}
          </div>
          <button onClick={() => setShowFilters((s) => !s)} className={`btn !h-12 !rounded-lg ${showFilters ? 'btn-primary' : 'btn-ghost'}`} aria-expanded={showFilters}>
            <SlidersHorizontal size={16} />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && <span className="rounded-full bg-canvas/20 px-1.5 font-mono text-[10px]">{activeCount}</span>}
          </button>
        </div>

        <div className="scroll-x -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Card languages">
          <span className="eyebrow mr-1 shrink-0">Languages</span>
          {LANGUAGES.map((l) => {
            const on = langs.includes(l.code);
            return (
              <button
                key={l.code}
                onClick={() => toggleLang(l.code)}
                aria-pressed={on}
                aria-label={l.name}
                title={`${l.name}${l.code === 'en' ? '' : ` · ${l.native}`}`}
                className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide transition-colors ${on ? 'border-fg/60 bg-surface-3 text-fg' : 'border-line text-faint hover:text-fg'}`}
              >
                {l.short}
              </button>
            );
          })}
        </div>

        {showFilters && (
          <div className="panel animate-rise space-y-4 p-4">
            <div>
              <p className="eyebrow mb-2">Type</p>
              <div className="flex flex-wrap gap-2">
                {ENERGY_TYPES.map((t) => {
                  const on = types.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => set('types', (on ? types.filter((x) => x !== t) : [...types, t]).join(','))}
                      className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs transition-all ${on ? 'border-fg/60 bg-surface-3 text-fg' : 'border-line text-muted hover:text-fg'}`}
                      aria-pressed={on}
                    >
                      <Energy type={t} size={20} />
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="space-y-1.5">
                <span className="eyebrow">Card type</span>
                <select value={supertype} onChange={(e) => set('supertype', e.target.value)} className="input">
                  <option value="">Any</option>
                  {SUPERTYPES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="eyebrow">Rarity</span>
                <select value={rarity} onChange={(e) => set('rarity', e.target.value)} className="input">
                  <option value="">Any</option>
                  {rarities?.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="eyebrow">Illustrator</span>
                <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Mitsuhiro Arita" className="input" />
              </label>
              <label className="space-y-1.5">
                <span className="eyebrow">Sort</span>
                <select value={sort} onChange={(e) => set('sort', e.target.value)} className="input">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            {activeCount > 0 && (
              <button
                onClick={() => {
                  setArtist('');
                  setParams(name ? { q: name } : {}, { replace: true });
                }}
                className="text-xs text-muted hover:text-fg"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {!hasQuery ? (
        <div className="border-y border-line py-10 text-center">
          <p className="text-sm text-muted">Type at least two letters, or pick a filter. Popular searches:</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setName(s)} className="chip">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : error ? (
        <ErrorState title="Search failed" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <CardSkeletonGrid />
      ) : cards.length === 0 ? (
        <p className="border-y border-line py-12 text-center text-sm text-muted">No cards found. Try a shorter name or fewer filters.</p>
      ) : (
        <>
          <p className="font-mono text-xs text-muted">{total.toLocaleString('en-GB')} cards</p>
          <CardGrid cards={cards} showSet listActions />
          <div ref={sentinel} className="flex h-16 items-center justify-center">
            {isFetchingNextPage && <LoaderCircle size={20} className="animate-spin text-muted" />}
          </div>
        </>
      )}
    </div>
  );
}
