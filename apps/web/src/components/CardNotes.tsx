import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, NotebookPen } from 'lucide-react';
import {
  NOTE_MAX,
  useCollectionStore,
  useNote,
  useReadOnly,
} from '../store/collectionStore';

const SAVE_DELAY = 700;

/** Free-text note for a card. Saves as you type, and on leaving the page. Read-only viewers just see it. */
export default function CardNotes({ cardId }: { cardId: string }) {
  const readOnly = useReadOnly();
  const saved = useNote(cardId);
  const commit = useCallback(
    (text: string) => useCollectionStore.getState().setNote(cardId, text),
    [cardId],
  );
  return (
    <CardNotesField
      key={cardId}
      saved={saved}
      readOnly={readOnly}
      onSave={commit}
    />
  );
}

/** The same autosaving notes field for every game's storage adapter. */
export function CardNotesField({
  saved,
  readOnly = false,
  onSave,
}: {
  saved: string;
  readOnly?: boolean;
  onSave: (text: string) => Promise<boolean | void>;
}) {
  if (readOnly) {
    return saved ? (
      <section className="border-t border-line-strong py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <NotebookPen size={15} className="text-accent" /> Notes
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {saved}
        </p>
      </section>
    ) : null;
  }
  return <NotesEditor saved={saved} onSave={onSave} />;
}

function NotesEditor({
  saved,
  onSave,
}: {
  saved: string;
  onSave: (text: string) => Promise<boolean | void>;
}) {
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);
  const commit = useCallback((text: string) => saveRef.current(text), []);
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
      void commit(draft).then((ok) => setJustSaved(ok !== false));
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, saved, commit]);

  // Flush an unsaved edit if the user navigates away mid-typing.
  useEffect(
    () => () => {
      if (pending.current !== null) void commit(pending.current);
    },
    [commit],
  );

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const left = NOTE_MAX - draft.length;

  return (
    <section
      className="border-t border-line-strong"
      aria-labelledby={`${id}-h`}
    >
      <div className="flex items-center justify-between gap-3 py-3">
        <h2
          id={`${id}-h`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <NotebookPen size={15} className="text-accent" /> Notes
        </h2>
        <span className="text-[11px] text-faint" aria-live="polite">
          {justSaved ? (
            <span className="inline-flex items-center gap-1 text-gain">
              <Check size={12} /> Saved
            </span>
          ) : left <= 80 ? (
            `${left} left`
          ) : (
            'Private unless you share it'
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
          void commit(draft).then((ok) => setJustSaved(ok !== false));
        }}
        placeholder="Where you got it, what you paid, who traded it to you…"
        className="block w-full resize-y rounded-md border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed text-fg transition-colors placeholder:text-faint hover:border-line-strong focus:outline-none focus-visible:border-accent"
      />
    </section>
  );
}
