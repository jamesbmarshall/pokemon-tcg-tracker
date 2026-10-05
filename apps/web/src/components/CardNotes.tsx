import { useEffect, useId, useRef, useState } from 'react';
import { Check, NotebookPen } from 'lucide-react';
import { NOTE_MAX, useCollectionStore, useNote } from '../store/collectionStore';

const SAVE_DELAY = 700;

/** Free-text note for a card. Saves as you type, and on leaving the page. */
export default function CardNotes({ cardId }: { cardId: string }) {
  const saved = useNote(cardId);
  const setNote = useCollectionStore((s) => s.setNote);
  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const pending = useRef<string | null>(null);
  const id = useId();

  useEffect(() => {
    if (draft.trim() === saved) {
      pending.current = null;
      return;
    }
    pending.current = draft;
    const t = setTimeout(() => {
      pending.current = null;
      void setNote(cardId, draft).then(() => setJustSaved(true));
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, saved, cardId, setNote]);

  // Flush an unsaved edit if the user navigates away mid-typing.
  useEffect(
    () => () => {
      if (pending.current !== null) void setNote(cardId, pending.current);
    },
    [cardId, setNote],
  );

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const left = NOTE_MAX - draft.length;

  return (
    <section className="panel overflow-hidden" aria-labelledby={`${id}-h`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={`${id}-h`} className="flex items-center gap-2 text-sm font-semibold">
          <NotebookPen size={15} className="text-volt" /> Notes
        </h2>
        <span className="text-[11px] text-faint" aria-live="polite">
          {justSaved ? (
            <span className="inline-flex items-center gap-1 text-gain">
              <Check size={12} /> Saved
            </span>
          ) : left <= 80 ? (
            `${left} left`
          ) : (
            'Only you can see this'
          )}
        </span>
      </div>
      <label htmlFor={id} className="sr-only">
        Notes about this card
      </label>
      <textarea
        id={id}
        value={draft}
        maxLength={NOTE_MAX}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (pending.current === null) return;
          pending.current = null;
          void setNote(cardId, draft).then(() => setJustSaved(true));
        }}
        placeholder="Where you got it, what you paid, who traded it to you…"
        className="block w-full resize-y bg-transparent px-5 py-4 text-sm leading-relaxed text-fg placeholder:text-faint focus:outline-none focus-visible:bg-surface/50"
      />
    </section>
  );
}
