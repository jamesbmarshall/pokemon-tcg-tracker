import { useEffect, useRef, useState } from 'react';
import { Check, ListPlus, Plus } from 'lucide-react';
import type { PokemonCard } from '../api/types';
import { useCollectionStore } from '../store/collectionStore';
import { toast } from '../store/toastStore';

/** "Lists" menu on the card page: tick the lists this card belongs in, or start a new one. */
export default function AddToList({ card }: { card: PokemonCard }) {
  const lists = useCollectionStore((s) => s.lists);
  const toggleInList = useCollectionStore((s) => s.toggleInList);
  const createList = useCollectionStore((s) => s.createList);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
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
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" className="btn btn-ghost !h-9 !text-xs">
        <ListPlus size={14} /> Lists{inCount > 0 && <span className="font-mono text-faint">{inCount}</span>}
      </button>
      {open && (
        <div role="group" aria-label="Custom lists" className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-line bg-surface p-2 shadow-2xl">
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
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-volt bg-volt text-ink' : 'border-line-strong'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
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
