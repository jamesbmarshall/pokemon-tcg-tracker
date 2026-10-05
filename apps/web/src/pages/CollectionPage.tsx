import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRememberedParams } from '../hooks/useViewPrefs';
import { langOf, language } from '../api/languages';
import { Gain } from '../components/Paid';
import { LanguageBadge } from '../components/Language';
import { ArrowUpDown, Award, BookOpen, Grid3x3, LayoutGrid, NotebookPen, Rows3, Search, X } from 'lucide-react';
import { useCollectionStats, type OwnedCard } from '../hooks/useCollectionStats';
import { useCollectionStore } from '../store/collectionStore';
import { useSettings } from '../store/settingsStore';
import { useMoney } from '../hooks/useMoney';
import CardGrid from '../components/CardGrid';
import CardImage from '../components/CardImage';
import BinderView from '../components/BinderView';
import { EmptyState, PageHeader, Segmented, Skeleton } from '../components/ui';
import { formatGrade } from '../utils/grading';
import { variantShort, isFoil, variantLabel } from '../utils/variants';
import { relativeTime } from '../utils/format';

type View = 'grid' | 'list' | 'binder';
type Sort = 'added' | 'value' | 'name' | 'set' | 'gain';

const SORTERS: Record<Sort, (a: OwnedCard, b: OwnedCard) => number> = {
  added: (a, b) => b.addedAt.localeCompare(a.addedAt),
  value: (a, b) => b.valueUsd - a.valueUsd,
  name: (a, b) => a.card.name.localeCompare(b.card.name),
  // Cards with a recorded price first, biggest gain first.
  gain: (a, b) => Number(b.cost.costed > 0) - Number(a.cost.costed > 0) || b.cost.valueUsd - b.cost.costUsd - (a.cost.valueUsd - a.cost.costUsd),
  set: (a, b) =>
    b.card.releaseDate.localeCompare(a.card.releaseDate) || a.card.number.localeCompare(b.card.number, undefined, { numeric: true }),
};

export default function CollectionPage() {
  const isLoaded = useCollectionStore((s) => s.isLoaded);
  const stats = useCollectionStats();
  const pocketSize = useSettings((s) => s.pocketSize);
  const money = useMoney();
  const { get, update } = useRememberedParams('collection', ['view', 'sort', 'graded']);
  const [q, setQ] = useState('');
  const viewParam = get('view');
  const view: View = viewParam === 'list' || viewParam === 'binder' ? viewParam : 'grid';
  const sortParam = get('sort');
  const sort: Sort = Object.hasOwn(SORTERS, sortParam) ? (sortParam as Sort) : 'added';
  const setFilter = get('set');
  const gradedOnly = get('graded') === '1';
  const holdings = useCollectionStore((s) => s.holdings);
  const notes = useCollectionStore((s) => s.notes);

  const sets = useMemo(() => [...stats.sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)), [stats.sets]);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stats.owned
      .filter((o) => (!setFilter || o.card.setId === setFilter) && (!gradedOnly || o.graded.length > 0) && (!needle || o.card.name.toLowerCase().includes(needle) || o.card.artist?.toLowerCase().includes(needle) || notes.get(o.card.id)?.toLowerCase().includes(needle)))
      .sort(view === 'binder' && sort === 'added' ? SORTERS.set : SORTERS[sort]);
  }, [stats.owned, q, setFilter, gradedOnly, sort, view, notes]);

  const filteredValue = useMemo(() => items.reduce((s, o) => s + o.valueUsd, 0), [items]);
  const slabCount = useMemo(() => stats.owned.reduce((n, o) => n + o.graded.length, 0), [stats.owned]);
  // Binder pages only hold copies that count towards sets; display slabs live elsewhere.
  const binderItems = useMemo(() => items.filter((o) => holdings.has(o.card.id)), [items, holdings]);
  const unsynced = stats.unique - stats.owned.length;

  if (!isLoaded) return <Skeleton className="h-80" />;

  if (stats.count === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Your collection is empty"
        action={
          <Link to="/sets" className="btn btn-primary">
            Browse sets
          </Link>
        }
      >
        Open any set and tap the variant buttons under a card to add it. Your cards will show up here, ready to sort, filter and flip through as binder pages.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${stats.count.toLocaleString('en-GB')} cards · ${stats.unique.toLocaleString('en-GB')} unique · ${stats.sets.length} sets`}
        title="Collection"
        actions={
          <div className="text-right">
            <p className="eyebrow">{setFilter || q ? 'Filtered value' : 'Total value'}</p>
            <p className="font-display text-2xl font-bold tabular">{money(filteredValue)}</p>
          </div>
        }
      />

      <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-ink/85 px-4 py-3 backdrop-blur-xl lg:top-0">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, artist or note" aria-label="Filter collection" className="input !h-9 !w-48 !pl-8 !text-xs" />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint" aria-label="Clear">
              <X size={13} />
            </button>
          )}
        </div>
        <select value={setFilter} onChange={(e) => update('set', e.target.value)} className="input !h-9 !w-auto !max-w-52 !text-xs" aria-label="Set">
          <option value="">All sets</option>
          {sets.map((s) => (
            <option key={s.setId} value={s.setId}>
              {s.setName}
              {langOf(s.setId) === 'en' ? '' : ` · ${language(langOf(s.setId)).short}`} ({s.uniqueOwned})
            </option>
          ))}
        </select>
        <label className="relative inline-flex items-center">
          <ArrowUpDown size={13} className="pointer-events-none absolute left-2.5 text-faint" />
          <select value={sort} onChange={(e) => update('sort', e.target.value)} className="input !h-9 !w-auto !pl-8 !text-xs" aria-label="Sort">
            <option value="added">Recently added</option>
            <option value="value">Value</option>
            <option value="name">Name</option>
            <option value="set">Set &amp; number</option>
            <option value="gain">Gain / loss</option>
          </select>
        </label>
        {slabCount > 0 && (
          <button
            onClick={() => update('graded', gradedOnly ? '' : '1')}
            aria-pressed={gradedOnly}
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
              gradedOnly ? 'border-volt bg-volt/15 text-volt' : 'border-line bg-surface-2 text-muted hover:text-fg'
            }`}
          >
            <Award size={13} /> Graded <span className="font-mono tabular opacity-70">{slabCount}</span>
          </button>
        )}
        <div className="ml-auto">
          <Segmented<View>
            size="sm"
            value={view}
            onChange={(v) => update('view', v === 'grid' ? '' : v)}
            options={[
              { value: 'grid', label: <LayoutGrid size={14} />, title: 'Grid' },
              { value: 'list', label: <Rows3 size={14} />, title: 'List' },
              { value: 'binder', label: <Grid3x3 size={14} />, title: 'Binder pages' },
            ]}
          />
        </div>
      </div>

      {unsynced > 0 && <p className="text-xs text-muted">Fetching details for {unsynced} card{unsynced > 1 ? 's' : ''}…</p>}

      {items.length === 0 ? (
        <p className="panel p-10 text-center text-sm text-muted">No cards match.</p>
      ) : view === 'binder' ? (
        binderItems.length ? (
          <BinderView slots={binderItems.map((o) => ({ card: o.card, owned: true }))} pocketSize={pocketSize} />
        ) : (
          <p className="panel p-10 text-center text-sm text-muted">These graded cards are kept out of your binder.</p>
        )
      ) : view === 'list' ? (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-2 text-left">
              <tr className="eyebrow">
                <th className="px-4 py-2.5 font-normal">Card</th>
                <th className="px-4 py-2.5 font-normal">Set</th>
                <th className="px-4 py-2.5 font-normal">Variants</th>
                <th className="px-4 py-2.5 text-right font-normal">Qty</th>
                <th className="px-4 py-2.5 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((o) => (
                <tr key={o.card.id} className="transition-colors hover:bg-surface">
                  <td className="px-4 py-2">
                    <Link to={`/card/${o.card.id}`} className="flex items-center gap-3 hover:text-volt">
                      <span className="block h-12 w-[34px] shrink-0 overflow-hidden rounded-[3px]">
                        <CardImage id={o.card.id} src={o.card.image} name={o.card.name} types={o.card.types} />
                      </span>
                      <span>
                        <span className="block font-medium">{o.card.name}</span>
                        <span className="block text-[11px] text-faint">{o.card.rarity} · {relativeTime(o.addedAt)}</span>
                        {notes.has(o.card.id) && (
                          <span className="mt-0.5 flex max-w-64 items-center gap-1 text-[11px] text-muted" title={notes.get(o.card.id)}>
                            <NotebookPen size={11} className="shrink-0 text-volt" />
                            <span className="truncate">{notes.get(o.card.id)}</span>
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {o.card.setName} <span className="font-mono text-xs text-faint">#{o.card.number}</span> <LanguageBadge id={o.card.id} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {o.entries.map((e) => (
                        <span
                          key={e.variant}
                          title={`${variantLabel(e.variant)} · ${e.condition ?? 'NM'}`}
                          className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink ${isFoil(e.variant) ? 'holo-bar' : 'bg-volt'}`}
                        >
                          {variantShort(e.variant)}
                          {e.quantity > 1 && `×${e.quantity}`}
                        </span>
                      ))}
                      {o.graded.map((g) => (
                        <span
                          key={g.id}
                          title={`${variantLabel(g.variant)} · ${g.label ?? 'Graded'}${g.certNumber ? ` · cert ${g.certNumber}` : ''}${g.countsTowardSet ? '' : ' · kept out of set progress'}`}
                          className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${g.countsTowardSet ? 'bg-fg text-ink' : 'border border-dashed border-fg/60 text-fg'}`}
                        >
                          {formatGrade(g)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular">{o.quantity}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular">
                    {money(o.valueUsd)}
                    {o.cost.costed > 0 && (
                      <span className="block text-[11px] font-normal" title={`Paid ${money(o.cost.costUsd)}${o.cost.costed < o.quantity ? ` for ${o.cost.costed} of ${o.quantity}` : ''}`}>
                        <Gain valueUsd={o.cost.valueUsd} costUsd={o.cost.costUsd} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <CardGrid cards={items.map((o) => o.card)} showSet />
      )}
    </div>
  );
}
