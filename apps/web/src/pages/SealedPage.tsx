import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Package, PackageOpen, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useSets } from '../api/hooks';
import { getBackend } from '../api/backend';
import type { SealedItem, SealedProductType } from '../api/types';
import { sealedValue, useCollectionStore, useReadOnly, type SealedInput } from '../store/collectionStore';
import { useFx, useMoney } from '../hooks/useMoney';
import { useDebounced } from '../hooks/useDebounced';
import { EmptyState, PageHeader } from '../components/ui';
import { ConfirmDialog, StatusPill } from '../components/forms';
import { ValueInput } from '../components/ValueOverride';
import { parseAmount } from '../components/Paid';
import { addSealedPhotos, removeSealedPhotos, useSealedPhotos } from '../db/sealedPhotos';
import { toast } from '../store/toastStore';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABEL } from '../utils/sealed';

export default function SealedPage() {
  const sealed = useCollectionStore((s) => s.sealed);
  const saveSealed = useCollectionStore((s) => s.saveSealed);
  const removeSealed = useCollectionStore((s) => s.removeSealed);
  const readOnly = useReadOnly();
  const money = useMoney();
  const navigate = useNavigate();
  const { data: sets } = useSets();
  const setName = useMemo(() => new Map(sets?.map((s) => [s.id, s.name]) ?? []), [sets]);

  const [editing, setEditing] = useState<SealedItem | 'new' | null>(null);
  const [opening, setOpening] = useState<SealedItem | null>(null);

  const markSealedOpened = useCollectionStore((s) => s.markSealedOpened);

  const items = useMemo(() => Array.from(sealed.values()).sort((a, b) => b.addedAt.localeCompare(a.addedAt)), [sealed]);

  const restore = (item: SealedItem) =>
    saveSealed({
      id: item.id,
      name: item.name,
      productType: item.productType,
      setId: item.setId,
      language: item.language,
      quantity: item.quantity,
      paid: item.paid,
      valueUsd: item.valueUsd,
      notes: item.notes,
      pcProductId: item.pcProductId,
      pcPrice: item.pcPrice,
      pcUpdatedAt: item.pcUpdatedAt,
    });

  if (items.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Package size={28} />}
          title="No sealed products yet"
          action={
            !readOnly && (
              <button onClick={() => setEditing('new')} className="btn btn-primary">
                <Plus size={16} /> Add sealed product
              </button>
            )
          }
        >
          Track booster boxes, ETBs and other sealed product. Unopened items count towards your collection value; mark them opened once you crack them.
        </EmptyState>
        {editing && <SealedForm item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${items.length} item${items.length > 1 ? 's' : ''}`}
        title="Sealed products"
        actions={
          !readOnly && (
            <button onClick={() => setEditing('new')} className="btn btn-primary">
              <Plus size={16} /> Add sealed product
            </button>
          )
        }
      >
        Booster boxes, ETBs and other sealed product. Unopened items count towards your collection value.
      </PageHeader>

      <ul className="divide-y divide-line border-y border-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{item.name}</p>
                <StatusPill tone={item.status === 'sealed' ? 'warn' : 'muted'}>{item.status === 'sealed' ? 'Sealed' : 'Opened'}</StatusPill>
              </div>
              <p className="mt-1 text-xs text-muted">
                {PRODUCT_TYPE_LABEL[item.productType]} · ×{item.quantity}
                {item.language ? ` · ${item.language}` : ''}
                {item.setId ? ` · ${setName.get(item.setId) ?? item.setId}` : ''}
              </p>
              {item.notes && <p className="mt-1 line-clamp-2 text-xs text-faint">{item.notes}</p>}
            </div>

            <div className="text-right">
              <p className="font-mono text-sm font-semibold tabular">{money(sealedValue(item))}</p>
              {item.paid && (
                <p className="text-[11px] text-faint">
                  Paid {item.paid.currency} {item.paid.amount.toFixed(2)}
                </p>
              )}
            </div>

            {!readOnly && (
              <div className="flex shrink-0 gap-1">
                {item.status === 'sealed' && (
                  <button onClick={() => setOpening(item)} className="btn btn-ghost !h-8 !w-8 !p-0" aria-label={`Mark ${item.name} opened`} title="Mark opened">
                    <PackageOpen size={13} />
                  </button>
                )}
                <button onClick={() => setEditing(item)} className="btn btn-ghost !h-8 !w-8 !p-0" aria-label={`Edit ${item.name}`} title="Edit">
                  <Pencil size={13} />
                </button>
                <button
                  onClick={async () => {
                    const removed = await removeSealed(item.id);
                    if (removed) toast(`Removed ${removed.name}`, { action: { label: 'Undo', run: () => void restore(removed) } });
                  }}
                  className="btn btn-ghost !h-8 !w-8 !p-0 hover:!text-loss"
                  aria-label={`Remove ${item.name}`}
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing && <SealedForm item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}

      {opening && (
        <ConfirmDialog
          title="Mark opened?"
          body="This keeps the item in your history but stops it counting towards your collection value."
          action="Mark opened"
          onClose={() => setOpening(null)}
          onConfirm={async () => {
            const result = await markSealedOpened(opening.id);
            if (result) {
              toast(
                `Marked ${result.name} opened`,
                result.setId
                  ? { action: { label: 'Log pulls', run: () => navigate(`/sets/${result.setId}`) } }
                  : undefined,
              );
            }
          }}
        />
      )}
    </div>
  );
}

const field = 'block text-[11px] font-medium uppercase tracking-[0.12em] text-faint';

function SealedForm({ item, onClose }: { item?: SealedItem; onClose: () => void }) {
  const saveSealed = useCollectionStore((s) => s.saveSealed);
  const linkSealed = useCollectionStore((s) => s.linkSealed);
  const { currency, rate } = useFx();
  const existingPhotos = useSealedPhotos(item?.id);
  const uid = useId();
  const first = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(item?.name ?? '');
  const [productType, setProductType] = useState<SealedProductType>(item?.productType ?? 'booster_box');
  const [setId, setSetId] = useState(item?.setId ?? '');
  const [language, setLanguage] = useState(item?.language ?? '');
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [paid, setPaid] = useState(item?.paid ? item.paid.amount.toFixed(2) : '');
  const [valueUsd, setValueUsd] = useState<number | undefined>(item?.valueUsd);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [dropIds, setDropIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [pcQuery, setPcQuery] = useState(item?.name ?? '');
  const [selectedPc, setSelectedPc] = useState<string | undefined>(item?.pcProductId);
  const debouncedQuery = useDebounced(pcQuery, 300);

  const { data: pcConfigured } = useQuery({
    queryKey: ['sealed-pc-configured'],
    queryFn: () => getBackend().pcConfigured(),
    staleTime: 5 * 60_000,
  });
  const { data: pcResults = [] } = useQuery({
    queryKey: ['sealed-pc-search', debouncedQuery],
    queryFn: () => getBackend().pcSearch(debouncedQuery),
    enabled: pcConfigured === true && debouncedQuery.trim().length > 1,
  });

  const previews = useMemo(() => newFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [newFiles]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const paidAmount = parseAmount(paid);
      const input: SealedInput = {
        id: item?.id,
        name: name.trim(),
        productType,
        setId: setId.trim() || undefined,
        language: language.trim() || undefined,
        quantity: Math.max(1, Math.floor(Number(quantity)) || 1),
        paid: typeof paidAmount === 'number' ? { amount: paidAmount, currency: item?.paid?.currency ?? currency } : undefined,
        valueUsd,
        notes,
        pcProductId: item?.pcProductId,
        pcPrice: item?.pcPrice,
        pcUpdatedAt: item?.pcUpdatedAt,
      };
      const saved = await saveSealed(input);
      if (selectedPc && selectedPc !== item?.pcProductId) await linkSealed(saved.id, selectedPc);
      if (dropIds.length) await removeSealedPhotos(dropIds, saved.id);
      if (newFiles.length) await addSealedPhotos(saved.id, newFiles);
      toast(item ? 'Sealed item updated' : `Added ${saved.name}`, { tone: 'success' });
      onClose();
    } catch (err) {
      console.error(err);
      toast('Could not save the sealed product', { tone: 'error' });
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-onyx/45 sm:items-center sm:p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg animate-rise flex-col overflow-hidden rounded-t-xl border border-line-strong bg-surface shadow-pop sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={`${uid}-title`} className="font-display text-xl font-semibold">
              {item ? 'Edit sealed product' : 'Add a sealed product'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost !h-8 !w-8 !p-0" aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-5">
          <label className="block space-y-1.5">
            <span className={field}>Name</span>
            <input ref={first} value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Obsidian Flames booster box" className="input" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className={field}>Product type</span>
              <select value={productType} onChange={(e) => setProductType(e.target.value as SealedProductType)} className="input">
                {PRODUCT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className={field}>Quantity</span>
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input font-mono" />
            </label>
            <label className="space-y-1.5">
              <span className={field}>Set ID (optional)</span>
              <input value={setId} onChange={(e) => setSetId(e.target.value)} placeholder="e.g. sv03" className="input font-mono" />
            </label>
            <label className="space-y-1.5">
              <span className={field}>Language (optional)</span>
              <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English" className="input" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className={field}>You paid ({item?.paid?.currency ?? currency})</span>
              <input value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" placeholder="Optional" className="input font-mono" />
            </label>
            <label className="space-y-1.5">
              <span className={field}>Your valuation</span>
              <ValueInput value={valueUsd} onCommit={setValueUsd} label="Your valuation" className="!h-10 w-full" />
            </label>
            <p className="col-span-2 -mt-1 text-[11px] leading-snug text-faint">
              Leave the valuation blank to use the linked PriceCharting price, if any. Rate: {rate.toFixed(2)} {currency}/USD.
            </p>
          </div>

          {pcConfigured === true && (
            <fieldset className="space-y-1.5">
              <legend className={field}>Link to PriceCharting</legend>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={pcQuery}
                  onChange={(e) => setPcQuery(e.target.value)}
                  placeholder="Search PriceCharting…"
                  aria-label="Search PriceCharting"
                  className="input !pl-8"
                />
              </div>
              {pcResults.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
                  {pcResults.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedPc(r.id)}
                        aria-pressed={selectedPc === r.id}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                          selectedPc === r.id ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2'
                        }`}
                      >
                        <span className="truncate">{r.name}</span>
                        {r.consoleName && <span className="shrink-0 text-faint">{r.consoleName}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedPc && <p className="text-[11px] text-faint">Linked on save.</p>}
            </fieldset>
          )}

          <label className="block space-y-1.5">
            <span className={field}>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Where you bought it…" className="input !h-auto py-2" />
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
              <label className="grid h-24 w-[68px] cursor-pointer place-items-center rounded-lg border border-dashed border-line-strong text-faint transition-colors hover:border-accent hover:text-accent focus-within:border-accent">
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
            {item ? 'Save changes' : 'Add sealed product'}
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
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-onyx/85 text-paper opacity-90 hover:text-loss"
      >
        <X size={11} />
      </button>
    </span>
  );
}
