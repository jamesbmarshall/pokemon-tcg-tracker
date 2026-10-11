import { createPortal } from 'react-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Award, Copy, ExternalLink, ImageIcon, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { GradedCopy, PokemonCard } from '../api/types';
import { gradedValue, useCollectionStore, useGradedFor, useReadOnly } from '../store/collectionStore';
import { useGradedPhotos } from '../db/gradedPhotos';
import { useFx, useMoney } from '../hooks/useMoney';
import { Gain } from './Paid';
import { paidUsd } from '../utils/fx';
import { relativeTime } from '../utils/format';
import { companyName, verifyLink } from '../utils/grading';
import { variantLabel } from '../utils/variants';
import { toast } from '../store/toastStore';

const GradedForm = lazy(() => import('./GradedForm'));

/** Slab label strip colours, loosely after each grader's own labels. */
const STRIP: Record<string, string> = {
  PSA: 'bg-[#c8202b] text-white',
  BGS: 'bg-gradient-to-r from-[#c9ced6] to-[#9aa3ae] text-onyx',
  CGC: 'bg-[#1f4f8f] text-white',
  SGC: 'bg-[#141414] text-white ring-1 ring-inset ring-white/20',
  TAG: 'bg-[#f2f2f2] text-onyx',
  ACE: 'bg-[#e6b422] text-onyx',
};

export default function GradedSection({ card }: { card: PokemonCard }) {
  const slabs = useGradedFor(card.id);
  const [editing, setEditing] = useState<GradedCopy | 'new' | null>(null);
  const readOnly = useReadOnly();
  if (readOnly && !slabs.length) return null;

  return (
    <section className="border-t border-line-strong" aria-labelledby="graded-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <div>
          <p className="eyebrow">Graded</p>
          <h2 id="graded-heading" className="mt-1 font-display text-2xl font-medium">
            {slabs.length ? `${slabs.length} slab${slabs.length > 1 ? 's' : ''}` : <span className="text-muted">No graded copies</span>}
          </h2>
        </div>
        {!readOnly && (
          <button onClick={() => setEditing('new')} className="btn btn-ghost !h-9 !text-xs">
            <Plus size={14} /> Add graded copy
          </button>
        )}
      </div>

      {slabs.length ? (
        <ul className="divide-y divide-line">
          {slabs.map((g) => (
            <Slab key={g.id} card={card} copy={g} onEdit={() => setEditing(g)} />
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted">Got this card in a slab? Record the grader, grade and cert number, and add photos of the case.</p>
      )}

      {editing && (
        <Suspense fallback={null}>
          <GradedForm card={card} copy={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
        </Suspense>
      )}
    </section>
  );
}

function Slab({ card, copy: g, onEdit }: { card: PokemonCard; copy: GradedCopy; onEdit: () => void }) {
  const cards = useCollectionStore((s) => s.cards);
  const saveGraded = useCollectionStore((s) => s.saveGraded);
  const removeGraded = useCollectionStore((s) => s.removeGraded);
  const restoreGraded = useCollectionStore((s) => s.restoreGraded);
  const readOnly = useReadOnly();
  const photos = useGradedPhotos(g.id);
  const money = useMoney();
  const { rates } = useFx();
  const paidCost = paidUsd(g.paid, rates);
  const [viewer, setViewer] = useState<number | null>(null);
  const verify = verifyLink(g);
  const name = companyName(g);
  const subs = g.subgrades && Object.entries(g.subgrades).filter(([, v]) => v != null);

  const copyCert = async () => {
    try {
      await navigator.clipboard.writeText(g.certNumber!);
      toast('Cert number copied');
    } catch {
      toast(`Cert ${g.certNumber}`);
    }
  };

  return (
    <li className="flex gap-4 py-4">
      <button
        onClick={() => photos.length && setViewer(0)}
        disabled={!photos.length}
        aria-label={photos.length ? `View ${photos.length} photo${photos.length > 1 ? 's' : ''}` : undefined}
        className="relative h-[104px] w-[74px] shrink-0 overflow-hidden rounded-lg border border-line-strong bg-surface-2 enabled:cursor-zoom-in"
      >
        {photos[0] ? (
          <img src={photos[0].url} alt={`${name} ${g.grade} slab`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full flex-col">
            <span className={`px-1 py-1 text-center font-mono text-[9px] font-bold leading-none ${STRIP[g.company] ?? 'bg-surface-3 text-fg'}`}>
              {name}
              <span className="block text-[13px]">{g.grade === 'Authentic' ? 'AUTH' : g.grade}</span>
            </span>
            <span className="grid flex-1 place-items-center text-faint">
              <ImageIcon size={16} />
            </span>
          </span>
        )}
        {photos.length > 1 && <span className="absolute bottom-1 right-1 rounded bg-onyx/80 text-paper px-1 font-mono text-[9px]">{photos.length}</span>}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${STRIP[g.company] ?? 'bg-surface-3 text-fg'}`}>{name}</span>
          <span className="font-display text-2xl font-semibold tabular leading-none">{g.grade === 'Authentic' ? 'Authentic' : g.grade}</span>
          {g.label && g.label !== 'Authentic' && <span className="text-sm text-muted">{g.label}</span>}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {variantLabel(g.variant)}
          {subs?.length ? <span className="font-mono"> · {subs.map(([k, v]) => `${k[0].toUpperCase()}${v}`).join(' ')}</span> : null}
        </p>
        {g.certNumber && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-mono text-faint">
              Cert <span className="text-fg">{g.certNumber}</span>
            </span>
            <button onClick={copyCert} className="inline-flex items-center gap-1 text-muted hover:text-accent" aria-label="Copy cert number">
              <Copy size={11} /> Copy
            </button>
            {verify && (
              <a
                href={verify.url}
                target="_blank"
                rel="noreferrer"
                onClick={verify.deepLink ? undefined : () => void copyCert()}
                className="inline-flex items-center gap-1 text-muted hover:text-accent"
                title={verify.deepLink ? `Look up on ${name}` : `Opens ${name}'s lookup; the cert number is copied for pasting`}
              >
                Verify <ExternalLink size={11} />
              </a>
            )}
          </p>
        )}
        {g.notes && <p className="mt-1.5 line-clamp-2 text-xs text-faint">{g.notes}</p>}

        {!readOnly && (
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={g.countsTowardSet}
              onChange={async (e) => {
                const on = e.target.checked;
                await saveGraded(card, { ...g, countsTowardSet: on });
                toast(on ? 'Now counts towards set completion' : 'Kept out of set completion');
              }}
              className="peer sr-only"
            />
            <span aria-hidden className="relative h-4 w-7 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-3 peer-checked:after:bg-on-accent" />
            Counts towards set
          </label>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <div className="text-right">
          <p className="font-mono text-sm font-semibold tabular">{money(gradedValue(g, cards))}</p>
          <p className="text-[10px] text-faint">
            {g.valueUsd != null ? 'your value' : g.pcPrice != null ? `PriceCharting · ${name} ${g.grade}${g.pcUpdatedAt ? ` · updated ${relativeTime(g.pcUpdatedAt)}` : ''}` : 'raw price'}
          </p>
          {paidCost != null && <Gain valueUsd={gradedValue(g, cards)} costUsd={paidCost} className="text-[10px]" />}
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <button onClick={onEdit} className="btn btn-ghost !h-8 !w-8 !p-0" aria-label={`Edit ${name} ${g.grade}`} title="Edit">
              <Pencil size={13} />
            </button>
            <button
              onClick={async () => {
                const removed = await removeGraded(g.id);
                if (removed) toast(`Removed ${name} ${g.grade}`, { action: { label: 'Undo', run: () => restoreGraded(removed.copy, removed.photos) } });
              }}
              className="btn btn-ghost !h-8 !w-8 !p-0 hover:!text-loss"
              aria-label={`Remove ${name} ${g.grade}`}
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {viewer !== null && photos[viewer] && <Lightbox photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} title={`${card.name} · ${name} ${g.grade}`} />}
    </li>
  );
}

function Lightbox({ photos, index, onIndex, onClose, title }: { photos: { id: string; url: string }[]; index: number; onIndex: (i: number) => void; onClose: () => void; title: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onIndex, onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-black/90 p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close">
        <X size={16} />
      </button>
      <img src={photos[index].url} alt={`${title}, photo ${index + 1}`} className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <p className="flex items-center gap-2 text-xs text-muted">
        <Award size={12} /> {title}
        {photos.length > 1 && <span className="font-mono">· {index + 1}/{photos.length}</span>}
      </p>
      {photos.length > 1 && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => onIndex(i)} aria-label={`Photo ${i + 1}`} className={`h-14 w-10 overflow-hidden rounded ring-2 ${i === index ? 'ring-accent' : 'ring-transparent opacity-60'}`}>
              <img src={p.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
