import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, X } from 'lucide-react';
import type { GradedCopy, GradingCompany, PokemonCard, Subgrades } from '../api/types';
import { cardVariants } from '../api/client';
import { useCollectionStore, type GradedInput } from '../store/collectionStore';
import { addPhotos, removePhotos, useGradedPhotos } from '../db/gradedPhotos';
import { useFx } from '../hooks/useMoney';
import { parseAmount } from './Paid';
import { COMPANIES, GRADE_SCALES, SUBGRADE_COMPANIES, SUBGRADE_KEYS, defaultLabel, labelOptions } from '../utils/grading';
import { variantLabel } from '../utils/variants';
import { toast } from '../store/toastStore';

interface Props {
  card: PokemonCard;
  /** Existing slab to edit; omit to add a new one */
  copy?: GradedCopy;
  onClose: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function GradedForm({ card, copy, onClose }: Props) {
  const variants = useMemo(() => cardVariants(card), [card]);
  const byCard = useCollectionStore((s) => s.byCard);
  const saveGraded = useCollectionStore((s) => s.saveGraded);
  const { currency, rate } = useFx();
  const existingPhotos = useGradedPhotos(copy?.id);
  const uid = useId();
  const first = useRef<HTMLSelectElement>(null);

  const [company, setCompany] = useState<GradingCompany>(copy?.company ?? 'PSA');
  const [companyName, setCompanyName] = useState(copy?.companyName ?? '');
  const [grade, setGrade] = useState(copy?.grade ?? '10');
  const [label, setLabel] = useState(copy?.label ?? defaultLabel(copy?.company ?? 'PSA', copy?.grade ?? '10') ?? '');
  const [labelTouched, setLabelTouched] = useState(!!copy);
  const [cert, setCert] = useState(copy?.certNumber ?? '');
  const [variant, setVariant] = useState(copy?.variant ?? variants[0] ?? 'normal');
  const [subs, setSubs] = useState<Subgrades>(copy?.subgrades ?? {});
  const [showSubs, setShowSubs] = useState(!!copy?.subgrades && Object.keys(copy.subgrades).length > 0);
  const [value, setValue] = useState(copy?.valueUsd != null ? String(round2(copy.valueUsd * rate)) : '');
  const [notes, setNotes] = useState(copy?.notes ?? '');
  const [paid, setPaid] = useState(copy?.paid ? copy.paid.amount.toFixed(2) : '');
  // Default: a slab fills the set slot only if there's no raw copy of the same printing already in the binder.
  const smartDefault = (v: string) => !byCard.get(card.id)?.[v];
  const [counts, setCounts] = useState(copy?.countsTowardSet ?? smartDefault(variant));
  const [countsTouched, setCountsTouched] = useState(!!copy);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [dropIds, setDropIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const grades = GRADE_SCALES[company];
  const labels = labelOptions(company, grade);
  const previews = useMemo(() => newFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [newFiles]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickCompany = (c: GradingCompany) => {
    setCompany(c);
    const g = GRADE_SCALES[c].includes(grade) ? grade : GRADE_SCALES[c][0];
    setGrade(g);
    if (!labelTouched) setLabel(defaultLabel(c, g) ?? '');
  };
  const pickGrade = (g: string) => {
    setGrade(g);
    if (!labelTouched) setLabel(defaultLabel(company, g) ?? '');
  };
  const pickVariant = (v: string) => {
    setVariant(v);
    if (!countsTouched) setCounts(smartDefault(v));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (company === 'Other' && !companyName.trim()) return;
    setSaving(true);
    try {
      const parsed = value.trim() === '' ? undefined : Number(value.replace(/[^\d.]/g, ''));
      const paidAmount = parseAmount(paid);
      const cleanSubs = Object.fromEntries(Object.entries(subs).filter(([, n]) => typeof n === 'number' && Number.isFinite(n))) as Subgrades;
      const input: GradedInput = {
        id: copy?.id,
        variant,
        company,
        companyName,
        grade,
        label,
        certNumber: cert,
        subgrades: showSubs && Object.keys(cleanSubs).length ? cleanSubs : undefined,
        countsTowardSet: counts,
        valueUsd: parsed != null && Number.isFinite(parsed) ? round2(parsed / rate) : undefined,
        paid: typeof paidAmount === 'number' ? { amount: paidAmount, currency: copy?.paid?.currency ?? currency } : undefined,
        notes,
      };
      const saved = await saveGraded(card, input);
      if (dropIds.length) await removePhotos(dropIds);
      if (newFiles.length) await addPhotos(saved.id, newFiles);
      toast(copy ? 'Graded copy updated' : `Added ${card.name} · ${company === 'Other' ? companyName : company} ${grade}`, { tone: 'success' });
      onClose();
    } catch (err) {
      console.error(err);
      toast('Could not save the graded copy', { tone: 'error' });
      setSaving(false);
    }
  };

  const field = 'block text-[11px] font-medium uppercase tracking-[0.12em] text-faint';

  // Portalled so ancestor transforms/overflow (panels, page animations) can't clip the overlay.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg animate-rise flex-col overflow-hidden rounded-t-3xl border border-line-strong bg-ink-2 shadow-2xl sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p className="eyebrow">{card.name} · #{card.number}</p>
            <h2 id={`${uid}-title`} className="mt-1 font-display text-xl font-semibold">
              {copy ? 'Edit graded copy' : 'Add a graded copy'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost !h-8 !w-8 !p-0" aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className={field}>Grader</span>
              <select ref={first} value={company} onChange={(e) => pickCompany(e.target.value as GradingCompany)} className="input">
                {COMPANIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className={field}>Grade</span>
              <select value={grade} onChange={(e) => pickGrade(e.target.value)} className="input font-mono">
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            {company === 'Other' && (
              <label className="col-span-2 space-y-1.5">
                <span className={field}>Grading company</span>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required placeholder="e.g. GMA, Mana" className="input" />
              </label>
            )}
            <label className="space-y-1.5">
              <span className={field}>Label</span>
              <input
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setLabelTouched(true);
                }}
                list={`${uid}-labels`}
                placeholder="Gem Mint"
                className="input"
              />
              <datalist id={`${uid}-labels`}>
                {labels.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
            <label className="space-y-1.5">
              <span className={field}>Cert number</span>
              <input value={cert} onChange={(e) => setCert(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="e.g. 81234567" className="input font-mono" />
            </label>
          </div>

          {variants.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className={field}>Printing</legend>
              <div className="flex flex-wrap gap-1.5">
                {variants.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => pickVariant(v)}
                    aria-pressed={variant === v}
                    className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors ${variant === v ? 'border-volt bg-volt/15 text-volt' : 'border-line bg-surface-2 text-muted hover:text-fg'}`}
                  >
                    {variantLabel(v)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            {!showSubs ? (
              <button type="button" onClick={() => setShowSubs(true)} className="text-xs font-medium text-muted underline-offset-4 hover:text-volt hover:underline">
                + Add sub-grades{SUBGRADE_COMPANIES.has(company) ? '' : ' (optional)'}
              </button>
            ) : (
              <fieldset className="space-y-1.5">
                <legend className={field}>Sub-grades</legend>
                <div className="grid grid-cols-4 gap-2">
                  {SUBGRADE_KEYS.map((k) => (
                    <label key={k} className="space-y-1">
                      <span className="block text-[11px] capitalize text-muted">{k}</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        step={0.5}
                        value={subs[k] ?? ''}
                        onChange={(e) => setSubs((s) => ({ ...s, [k]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="input !px-2 text-center font-mono"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-3.5">
            <input
              type="checkbox"
              checked={counts}
              onChange={(e) => {
                setCounts(e.target.checked);
                setCountsTouched(true);
              }}
              className="peer sr-only"
            />
            <span aria-hidden className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-volt peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-volt after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-ink" />
            <span>
              <span className="block text-sm font-medium">Counts towards set completion</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                {counts
                  ? 'This slab fills its slot in the set checklist and binder.'
                  : 'Kept out of the binder (e.g. a display copy). It still adds to your collection value.'}
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className={field}>You paid ({copy?.paid?.currency ?? currency})</span>
              <input value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" placeholder="Optional" className="input font-mono" />
            </label>
            <label className="space-y-1.5">
              <span className={field}>Your valuation ({currency})</span>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Optional" className="input font-mono" />
            </label>
            <p className="col-span-2 -mt-1 text-[11px] leading-snug text-faint">
              Include grading fees in what you paid. Leave the valuation blank to use the raw market price; graded prices aren't in the price feed.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className={field}>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Where you bought it, submission batch…" className="input !h-auto py-2" />
          </label>

          <fieldset className="space-y-2">
            <legend className={field}>Photos</legend>
            <div className="flex flex-wrap gap-2">
              {existingPhotos
                .filter((p) => !dropIds.includes(p.id))
                .map((p) => (
                  <Thumb key={p.id} url={p.url} onRemove={() => setDropIds((d) => [...d, p.id])} />
                ))}
              {previews.map((p, i) => (
                <Thumb key={p.url} url={p.url} onRemove={() => setNewFiles((f) => f.filter((_, j) => j !== i))} />
              ))}
              <label className="grid h-24 w-[68px] cursor-pointer place-items-center rounded-lg border border-dashed border-line-strong text-faint transition-colors hover:border-volt hover:text-volt focus-within:border-volt">
                <ImagePlus size={18} />
                <span className="sr-only">Add photos</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) setNewFiles((f) => [...f, ...files]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <p className="text-[11px] text-faint">Stored on this device only. Not included in JSON exports.</p>
          </fieldset>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {copy ? 'Save changes' : 'Add graded copy'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function Thumb({ url, onRemove }: { url: string; onRemove: () => void }) {
  return (
    <span className="group relative block h-24 w-[68px] overflow-hidden rounded-lg ring-1 ring-line">
      <img src={url} alt="" className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/85 text-fg opacity-90 hover:text-loss"
      >
        <X size={11} />
      </button>
    </span>
  );
}
