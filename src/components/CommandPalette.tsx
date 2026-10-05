import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CornerDownLeft, Layers, LoaderCircle, Search } from 'lucide-react';
import { useSets } from '../api/hooks';
import { searchCards } from '../api/client';
import { useDebounced } from '../hooks/useDebounced';
import { useCollectionStore } from '../store/collectionStore';
import CardImage from './CardImage';
import { SetSymbol } from './SetArt';

type Item =
  | { kind: 'card'; id: string; title: string; sub: string; image: string; owned: boolean }
  | { kind: 'set'; id: string; title: string; sub: string; image: string }
  | { kind: 'action'; id: string; title: string; sub: string };

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim(), 220);
  const { data: sets } = useSets();
  const byCard = useCollectionStore((s) => s.byCard);
  const slabs = useCollectionStore((s) => s.gradedByCard);

  const cards = useQuery({
    queryKey: ['palette', dq],
    queryFn: ({ signal }) => searchCards({ name: dq, sort: 'newest' }, 1, signal),
    enabled: open && dq.length >= 2,
    staleTime: 5 * 60 * 1000,
  });


  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const needle = q.trim().toLowerCase();
    if (needle.length >= 1 && sets) {
      for (const s of sets) {
        if (s.name.toLowerCase().includes(needle) || s.ptcgoCode?.toLowerCase() === needle || s.id === needle) {
          out.push({ kind: 'set', id: s.id, title: s.name, sub: `${s.series} · ${s.releaseDate.slice(0, 4)}`, image: s.images.symbol });
          if (out.length >= 4) break;
        }
      }
    }
    for (const c of cards.data?.data.slice(0, 8) ?? []) {
      out.push({ kind: 'card', id: c.id, title: c.name, sub: `${c.set.name} · #${c.number}`, image: c.images.small, owned: byCard.has(c.id) || slabs.has(c.id) });
    }
    if (needle.length >= 2) out.push({ kind: 'action', id: 'search', title: `Search all cards for “${q.trim()}”`, sub: 'Open advanced search' });
    return out;
  }, [q, sets, cards.data, byCard, slabs]);

  const go = (it: Item) => {
    onClose();
    if (it.kind === 'card') navigate(`/card/${it.id}`);
    else if (it.kind === 'set') navigate(`/sets/${it.id}`);
    else navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-3 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-xl animate-rise overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_40px_120px_-20px_rgb(0_0_0/0.9)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-muted" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === 'Enter' && items[active]) go(items[active]);
            }}
            placeholder="Search cards and sets…"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
          {cards.isFetching && <LoaderCircle size={16} className="animate-spin text-muted" />}
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-faint">
              {q.trim().length < 2 ? 'Try “Charizard”, “151” or “Umbreon VMAX”' : cards.isFetching ? 'Searching…' : 'Nothing found'}
            </p>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.kind}-${it.id}`}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === active ? 'bg-surface-3' : ''}`}
            >
              {it.kind === 'card' && (
                <span className="block h-11 w-8 shrink-0 overflow-hidden rounded-[3px]">
                  <CardImage id={it.id} src={it.image} name={it.title} />
                </span>
              )}
              {it.kind === 'set' && (
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2">
                  <SetSymbol src={it.image} className="h-5 w-5 object-contain" />
                </span>
              )}
              {it.kind === 'action' && (
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-volt">
                  <ArrowRight size={16} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{it.title}</span>
                <span className="block truncate text-xs text-muted">{it.sub}</span>
              </span>
              {it.kind === 'set' && <Layers size={14} className="text-faint" />}
              {it.kind === 'card' && it.owned && <span className="rounded-full bg-volt/15 px-2 py-0.5 text-[10px] font-semibold text-volt">Owned</span>}
              {i === active && <CornerDownLeft size={14} className="text-faint" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
