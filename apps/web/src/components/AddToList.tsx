import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ListPlus, Plus } from 'lucide-react';
import type { CardSnapshot, PokemonCard } from '../api/types';
import { useCollectionStore } from '../store/collectionStore';
import { toast } from '../store/toastStore';

/**
 * "Lists" menu: tick the lists this card belongs in, or start a new one. `compact` renders an
 * icon-only trigger for card tiles in a grid.
 */
export default function AddToList({ card, compact = false }: { card: PokemonCard | CardSnapshot; compact?: boolean }) {
  const allLists = useCollectionStore((s) => s.lists);
  // Decks need per-card quantities and legality, which doesn't fit this toggle UI; deck card
  // management happens on the deck page itself via its own "add card"/import flow instead.
  const lists = useMemo(() => allLists.filter((l) => l.kind !== 'deck'), [allLists]);
  const toggleInList = useCollectionStore((s) => s.toggleInList);
  const createList = useCollectionStore((s) => s.createList);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [alignLeft, setAlignLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inCount = lists.filter((l) => l.cards.includes(card.id)).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      // Grid tiles can sit near the left edge of the screen, where a right-aligned menu would be cut off.
      const r = ref.current?.getBoundingClientRect();
      setAlignLeft(!!r && r.right < 272);
    }
    setOpen((o) => !o);
  };

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const list = await createList(n);
    if (!list) return;
    setName('');
    await toggleInList(list.id, card);
    toast(`Added to ${list.name}`, { tone: 'success' });
  };

  return (
    <div ref={ref} className="relative">
      {compact ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={`Add ${card.name} to a list${inCount ? ` (in ${inCount})` : ''}`}
          title={inCount ? `In ${inCount} list${inCount > 1 ? 's' : ''}` : 'Add to a list'}
          className={`relative grid h-6 w-6 place-items-center rounded-md border transition-colors active:scale-90 ${
            inCount ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line bg-surface-2 text-muted hover:border-accent/60 hover:text-fg'
          }`}
        >
          <ListPlus size={12} />
        </button>
      ) : (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true" className="btn btn-ghost !h-9 !text-xs">
          <ListPlus size={14} /> Lists{inCount > 0 && <span className="font-mono text-faint">{inCount}</span>}
        </button>
      )}
      {open && (
        <div
          role="group"
          aria-label="Custom lists"
          className={`absolute z-30 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-pop ${alignLeft ? 'left-0' : 'right-0'} ${compact ? 'top-8' : 'top-11'}`}
        >
          {lists.length > 0 ? (
            <ul className="max-h-60 overflow-y-auto">
              {lists.map((l) => {
                const on = l.cards.includes(card.id);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={async () => {
                        const now = await toggleInList(l.id, card);
                        toast(now ? `Added to ${l.name}` : `Removed from ${l.name}`);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="font-mono text-[10px] text-faint">{l.cards.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-2 text-xs text-muted">Group cards however you like: a deck, trade binder, or cards to grade.</p>
          )}
          <form
            className="mt-1 flex gap-1 border-t border-line pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="New list" aria-label="New list name" className="input !h-8 flex-1 !text-xs" />
            <button type="submit" disabled={!name.trim()} className="btn btn-primary !h-8 !w-8 !p-0" aria-label="Create list">
              <Plus size={14} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
