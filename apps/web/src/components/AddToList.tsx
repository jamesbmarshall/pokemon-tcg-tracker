import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ListPlus, Minus, Plus } from 'lucide-react';
import { checkDeckLegality, type DeckCard } from '@poketracker/shared/decks/legality';
import type { CardSnapshot, PokemonCard } from '../api/types';
import { getBackend, type CustomList } from '../api/backend';
import { toSnapshot } from '../api/client';
import { useCollectionStore } from '../store/collectionStore';
import { toast } from '../store/toastStore';

/**
 * "Lists" menu: tick the lists this card belongs in, start a new one, or set the card's quantity
 * in any deck. `compact` renders an icon-only trigger for card tiles in a grid.
 */
export default function AddToList({ card, compact = false }: { card: PokemonCard | CardSnapshot; compact?: boolean }) {
  const allLists = useCollectionStore((s) => s.lists);
  // Plain lists are a tick-to-toggle membership; decks carry a per-card quantity (and legality),
  // so they get their own group below with a stepper instead.
  const lists = useMemo(() => allLists.filter((l) => l.kind !== 'deck'), [allLists]);
  const decks = useMemo(() => allLists.filter((l) => l.kind === 'deck'), [allLists]);
  const toggleInList = useCollectionStore((s) => s.toggleInList);
  const createList = useCollectionStore((s) => s.createList);
  const setDeckCardQty = useCollectionStore((s) => s.setDeckCardQty);
  const cardsById = useCollectionStore((s) => s.cards);
  const cardSnapshot = useMemo<CardSnapshot>(() => ('set' in card ? toSnapshot(card) : card), [card]);
  const { data: deckSettings } = useQuery({ queryKey: ['decks', 'settings'], queryFn: () => getBackend().getDeckSettings(), enabled: decks.length > 0 });
  const legalityOpts = useMemo(() => ({ regulationMarks: deckSettings?.regulationMarks, bannedCardIds: deckSettings?.bannedCardIds }), [deckSettings]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [alignLeft, setAlignLeft] = useState(false);
  const [announcement, setAnnouncement] = useState('');
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

  /**
   * A non-blocking heads-up that this card's name is now over the 4-copy limit in a given deck,
   * reusing checkDeckLegality (rather than re-implementing the basic-Energy exemption and the
   * name-grouping rule here) against the deck's current state, which already reflects the qty
   * change that triggered this render.
   */
  const copyLimitWarning = (deck: CustomList): string | undefined => {
    if ((deck.cardQtys[cardSnapshot.id] ?? 0) <= 0) return undefined;
    const deckCards: DeckCard[] = deck.cards
      .map((id): DeckCard | undefined => {
        const c = id === cardSnapshot.id ? cardSnapshot : cardsById.get(id);
        return c ? { card: c, qty: deck.cardQtys[id] ?? 1 } : undefined;
      })
      .filter((dc): dc is DeckCard => !!dc);
    const result = checkDeckLegality(deckCards, deck.format ?? 'standard', legalityOpts);
    return result.issues.find((i) => i.code === 'copy-limit' && i.cardIds.includes(cardSnapshot.id))?.message;
  };

  const adjustDeckQty = async (deck: CustomList, delta: number) => {
    const qty = deck.cardQtys[cardSnapshot.id] ?? 0;
    const next = Math.max(0, Math.min(60, qty + delta));
    if (next === qty) return;
    await setDeckCardQty(deck.id, card, next);
    setAnnouncement(next === 0 ? `Removed ${cardSnapshot.name} from ${deck.name}` : `${cardSnapshot.name} is now ${next} in ${deck.name}`);
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
          {decks.length > 0 && <p className="eyebrow px-2 pb-1 pt-0.5">Lists</p>}
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
          {decks.length > 0 && (
            <>
              <p className="eyebrow px-2 pb-1 pt-2">Decks</p>
              <ul role="group" aria-label="Decks" className="max-h-60 overflow-y-auto">
                {decks.map((d) => {
                  const qty = d.cardQtys[cardSnapshot.id] ?? 0;
                  const warning = copyLimitWarning(d);
                  return (
                    <li key={d.id} className="rounded-lg px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void adjustDeckQty(d, -1)}
                            disabled={qty <= 0}
                            aria-label={`Decrease ${cardSnapshot.name} in ${d.name}`}
                            className="btn btn-ghost !h-7 !w-7 !p-0"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-5 text-center font-mono text-xs tabular" aria-hidden="true">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => void adjustDeckQty(d, 1)}
                            disabled={qty >= 60}
                            aria-label={`Increase ${cardSnapshot.name} in ${d.name}`}
                            className="btn btn-ghost !h-7 !w-7 !p-0"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                      {warning && <p className="mt-0.5 text-[11px] text-accent">{warning}</p>}
                    </li>
                  );
                })}
              </ul>
            </>
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
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>
      )}
    </div>
  );
}
