import { useState, useEffect, useRef } from 'react';
import { PageHeader, EmptyState } from '../components/ui';
import { Modal, CopyField, ConfirmDialog } from '../components/forms';
import { Package, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type {
  SealedProduct,
  Slab,
  TcgCard,
} from '@poketracker/shared/tcg/types';
import type Tesseract from 'tesseract.js';
import { api } from '../api/http';
import { toast } from '../store/toastStore';
import { toCsv } from '@poketracker/shared/csv';
import { useGame } from './context';
import { download, gameApi } from './api';
import { TcgGrid } from './Cards';
import { useMoney } from '../hooks/useMoney';
export function AssetTools({
  kind,
  item,
}: {
  kind: 'graded' | 'sealed';
  item: Slab | SealedProduct;
}) {
  const {
    collectionId,
    module,
    readOnly,
    busy,
    remove,
    reload,
    save,
    shareToken,
  } = useGame();
  const base = `/api/collections/${collectionId}/games/${module.id}`;
  const route = `${base}/records/${kind}/${item.id}`;
  const photos = useQuery({
    queryKey: [
      'tcg-photos',
      collectionId,
      module.id,
      kind,
      item.id,
      shareToken,
    ],
    queryFn: () =>
      api<{ id: string }[]>(
        shareToken
          ? `/api/public/${shareToken}/game-photos/${kind}/${item.id}`
          : `${route}/photos`,
      ),
    enabled: collectionId !== 'public' || !!shareToken,
  });
  const pc = useQuery({
    queryKey: ['tcg-pc-status'],
    queryFn: () =>
      api<{ pricecharting: { configured: boolean } }>('/api/integrations'),
    enabled: !readOnly,
  });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false),
    [product, setProduct] = useState(''),
    [paid, setPaid] = useState(item.paid?.amount.toString() ?? ''),
    [currency, setCurrency] = useState(item.paid?.currency ?? 'USD'),
    [notes, setNotes] = useState(item.notes ?? ''),
    [value, setValue] = useState(item.valueUsd?.toString() ?? '');
  if (readOnly)
    return (
      <div className="flex flex-wrap gap-2">
        {photos.data?.map((photo) => (
          <img
            key={photo.id}
            className="h-40 w-40 rounded object-contain"
            alt="Shared collection item photo"
            src={
              shareToken
                ? `/api/public/${shareToken}/game-photo/${photo.id}`
                : `${base}/photos/${photo.id}`
            }
          />
        ))}
      </div>
    );
  const attempt = async (fn: () => Promise<unknown>) => {
    setUploading(true);
    try {
      await fn();
      await reload();
      await photos.refetch();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="space-y-3">
      <button
        className="btn btn-ghost !text-xs"
        onClick={() => setEditing(true)}
      >
        Edit details & photos
        {photos.data?.length ? ` · ${photos.data.length} photos` : ''}
      </button>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${kind === 'graded' ? 'slab' : 'product'}?`}
          body="This item will be removed from your collection."
          action="Delete"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            if (!(await remove(kind, item.id)))
              throw new Error('Could not remove item. Try again.');
          }}
        />
      )}
      {editing && (
        <Modal
          title={kind === 'graded' ? 'Slab details' : 'Product details'}
          onClose={() => setEditing(false)}
          wide
        >
          <div className="space-y-5">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save([
                  {
                    kind,
                    id: item.id,
                    data: {
                      ...item,
                      paid:
                        paid === ''
                          ? undefined
                          : { amount: Number(paid), currency },
                      valueUsd: value === '' ? undefined : Number(value),
                      notes,
                    },
                  },
                ]).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
            >
              <label>
                Paid
                <input
                  className="input block w-28"
                  type="number"
                  min="0"
                  step="0.01"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </label>
              <label>
                Currency
                <select
                  className="input block"
                  value={currency}
                  onChange={(e) =>
                    setCurrency(e.target.value as typeof currency)
                  }
                >
                  {['USD', 'GBP', 'EUR'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Manual value (USD)
                <input
                  className="input block w-32"
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <label>
                Notes
                <input
                  className="input block"
                  maxLength={5000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button className="btn btn-ghost" disabled={busy || uploading}>
                Save details
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm">
                Add photo
                <input
                  className="ml-2 max-w-56 text-xs"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading || busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const form = new FormData();
                      form.append('photo', file);
                      void attempt(() =>
                        api(`${route}/photos`, { method: 'POST', body: form }),
                      );
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                className="btn btn-ghost text-loss"
                disabled={busy || uploading}
                onClick={() => {
                  setEditing(false);
                  setDeleting(true);
                }}
              >
                Delete {kind === 'graded' ? 'slab' : 'product'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {photos.data?.map((p) => (
                <div key={p.id}>
                  <img
                    src={`${base}/photos/${p.id}`}
                    alt="Collection item photo"
                    className="h-32 w-32 rounded object-contain"
                  />
                  <button
                    className="btn btn-ghost !text-xs"
                    onClick={() =>
                      void attempt(() =>
                        api(`${base}/photos/${p.id}`, { method: 'DELETE' }),
                      )
                    }
                  >
                    Remove photo
                  </button>
                </div>
              ))}
            </div>
            {pc.data?.pricecharting.configured && (
              <div className="flex flex-wrap items-end gap-2">
                <label>
                  PriceCharting product ID
                  <input
                    className="input block"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <button
                  className="btn btn-ghost"
                  disabled={busy || uploading || !product}
                  onClick={() =>
                    void attempt(() =>
                      api(`${route}/pricecharting`, {
                        method: 'POST',
                        body: { productId: product },
                      }),
                    )
                  }
                >
                  Link price
                </button>
                {item.pcPrice !== undefined && (
                  <span className="text-sm">
                    Linked price: USD {item.pcPrice.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function GameSealed() {
  const { module, state, save, busy, readOnly } = useGame();
  const money = useMoney();
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState<SealedProduct | null>(null);
  const [name, setName] = useState(''),
    [type, setType] = useState(module.sealedTypes[0]),
    [quantity, setQuantity] = useState(1),
    [value, setValue] = useState('');
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={module.shortName}
        title="Sealed products"
        actions={
          !readOnly && (
            <button
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={15} />
              New product
            </button>
          )
        }
      >
        {state.sealed
          .filter((s) => s.status === 'sealed')
          .reduce((n, s) => n + s.quantity, 0)}{' '}
        sealed items ·{' '}
        {money(
          state.sealed
            .filter((s) => s.status === 'sealed')
            .reduce(
              (n, s) => n + (s.valueUsd ?? (s.pcPrice ?? 0) * s.quantity),
              0,
            ),
        )}
      </PageHeader>
      {opening && (
        <ConfirmDialog
          title={`Open ${opening.name}?`}
          body="This marks the product as opened and removes it from your sealed collection value."
          action="Mark opened"
          onClose={() => setOpening(null)}
          onConfirm={async () => {
            if (
              !(await save([
                {
                  kind: 'sealed',
                  id: opening.id,
                  data: { ...opening, status: 'opened' },
                },
              ]))
            )
              throw new Error('Could not update product. Try again.');
          }}
        />
      )}
      {!readOnly && creating && (
        <Modal title="New sealed product" onClose={() => setCreating(false)}>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const id = crypto.randomUUID();
              void save([
                {
                  kind: 'sealed',
                  id,
                  data: {
                    id,
                    name,
                    productType: type,
                    quantity,
                    status: 'sealed',
                    valueUsd: value === '' ? undefined : Number(value),
                    addedAt: new Date().toISOString(),
                  },
                },
              ]).then((ok) => {
                if (ok) {
                  setName('');
                  setCreating(false);
                }
              });
            }}
          >
            <label>
              Product name
              <input
                className="input block"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                className="input block"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {module.sealedTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                type="number"
                className="input block w-24"
                min="1"
                max="100000"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <label>
              Total manual value (USD)
              <input
                type="number"
                className="input block w-36"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" disabled={busy}>
              Add product
            </button>
          </form>
        </Modal>
      )}
      {!state.sealed.length && (
        <EmptyState icon={<Package size={28} />} title="No sealed products yet">
          Track booster boxes, bundles and preconstructed decks.
        </EmptyState>
      )}
      {(['sealed', 'opened'] as const)
        .filter((status) => state.sealed.some((s) => s.status === status))
        .map((status) => (
          <section className="space-y-3" key={status}>
            <h2 className="text-xl font-semibold capitalize">{status}</h2>
            {state.sealed
              .filter((s) => s.status === status)
              .map((s) => (
                <div
                  className="space-y-3 rounded-xl border border-line p-4"
                  key={s.id}
                >
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                      <Package size={22} />
                    </span>
                    <h3 className="min-w-0 flex-1 font-medium">
                      {s.name}
                      <span className="mt-1 block text-xs text-muted">
                        ×{s.quantity} · {s.productType.replaceAll('_', ' ')}
                      </span>
                    </h3>
                    <span className="font-mono text-sm">
                      {money(s.valueUsd ?? (s.pcPrice ?? 0) * s.quantity)}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {s.productType.replaceAll('_', ' ')}
                  </p>
                  {!readOnly && status === 'sealed' && (
                    <button
                      disabled={busy}
                      className="btn btn-ghost"
                      onClick={() => setOpening(s)}
                    >
                      Mark opened
                    </button>
                  )}
                  <AssetTools kind="sealed" item={s} />
                </div>
              ))}
          </section>
        ))}
    </div>
  );
}
export function GameSettings() {
  const { module, state, collectionId, reload, readOnly } = useGame();
  const [error, setError] = useState(''),
    [importing, setImporting] = useState(false),
    [clear, setClear] = useState(false);
  const base = `/api/collections/${collectionId}/games/${module.id}`;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title={`${module.shortName} data`}>
        Manage your {module.shortName} collection data.
      </PageHeader>
      <section className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <h2 className="font-display text-xl">Import & export</h2>
        <p className="text-muted">
          JSON includes this game's cards, holdings, lists, decks and value
          history. Photo files are included in instance backups, rather than
          JSON exports.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            onClick={() =>
              void api(`${base}/export`)
                .then((data) =>
                  download(
                    `${module.id}-collection.json`,
                    JSON.stringify(data, null, 2),
                  ),
                )
                .catch((e) => setError(e.message))
            }
          >
            Export JSON
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const cards = new Map(state.cards.map((c) => [c.id, c]));
              download(
                `${module.id}-collection.csv`,
                toCsv([
                  [
                    'Game',
                    'Card ID',
                    'Name',
                    'Set',
                    'Number',
                    'Language',
                    'Finish',
                    'Quantity',
                    'Condition',
                    'Manual value USD',
                    'Paid',
                    'Currency',
                    'Notes',
                  ],
                  ...state.entries.map((e) => {
                    const c = cards.get(e.cardId);
                    return [
                      module.id,
                      e.cardId,
                      c?.name,
                      c?.setName,
                      c?.number,
                      c?.language,
                      e.finish,
                      e.quantity,
                      e.condition,
                      e.valueUsd,
                      e.paid?.amount,
                      e.paid?.currency,
                      e.notes,
                    ];
                  }),
                ]),
                'text/csv',
              );
            }}
          >
            Export CSV
          </button>
        </div>
        <label className="block">
          Import JSON
          <input
            type="file"
            accept=".json,application/json"
            className="mt-2 block max-w-full text-sm"
            disabled={importing || readOnly}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 20 * 1024 ** 2) {
                setError('File exceeds 20 MiB');
                return;
              }
              setImporting(true);
              setError('');
              void file
                .text()
                .then((text) =>
                  api(`${base}/import`, {
                    method: 'POST',
                    body: JSON.parse(text),
                  }),
                )
                .then(() => reload())
                .catch((err) => setError(err.message))
                .finally(() => setImporting(false));
              e.target.value = '';
            }}
          />
        </label>
        {importing && <p role="status">Importing…</p>}
        {error && (
          <p role="alert" className="text-loss">
            {error}
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-lg border border-loss/25 p-5">
        <h2 className="font-semibold">Clear {module.shortName} data</h2>
        <label className="block">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />{' '}
          Remove this game's holdings, wishlist, lists, decks and history from
          this collection.
        </label>
        <button
          className="btn btn-ghost text-loss"
          disabled={!clear || state.role !== 'owner'}
          onClick={() =>
            void api(base, { method: 'DELETE' })
              .then(() => reload())
              .then(() => setClear(false))
              .catch((e) => setError(e.message))
          }
        >
          Clear game data
        </button>
      </section>
    </div>
  );
}
export function GameSharing() {
  const { module, state, collectionId, language } = useGame();
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState('collection'),
    [target, setTarget] = useState(''),
    [audience, setAudience] = useState('public'),
    [hidePaid, setHidePaid] = useState(true),
    [hideValue, setHideValue] = useState(false),
    [hideNotes, setHideNotes] = useState(true),
    [days, setDays] = useState(''),
    [users, setUsers] = useState(''),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const shares = useQuery({
    queryKey: ['tcg-shares', collectionId, module.id],
    queryFn: () =>
      api<
        {
          id: string;
          game: string;
          collectionId: string;
          scope: string;
          url: string;
          active: boolean;
        }[]
      >('/api/shares'),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={module.shortName}
        title={`Share ${module.shortName}`}
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            New share link
          </button>
        }
      >
        Share a collection, wishlist, set or deck with the people you choose.
      </PageHeader>
      {creating && (
        <Modal title="New share link" onClose={() => setCreating(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              setSaving(true);
              void api<{ url: string }>('/api/shares', {
                method: 'POST',
                body: {
                  game: module.id,
                  language,
                  collectionId,
                  scope,
                  target,
                  audience,
                  hidePaid,
                  hideValue,
                  hideNotes,
                  expiresInDays: days ? Number(days) : null,
                  userIds: users
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
                .then((s) => {
                  setUrl(s.url);
                  setCreating(false);
                  void shares.refetch();
                })
                .catch((e) => setError(e.message))
                .finally(() => setSaving(false));
            }}
          >
            <label className="block">
              What to share
              <select
                className="input mt-1 block"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setTarget('');
                }}
              >
                {[
                  'collection',
                  'set',
                  'wishlist',
                  'graded',
                  'sealed',
                  'list',
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {scope === 'set' && (
              <label className="block">
                Set
                <select
                  required
                  className="input block"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose set</option>
                  {[...new Set(state.cards.map((c) => c.setId))].map((id) => (
                    <option key={id} value={id}>
                      {state.cards.find((c) => c.setId === id)?.setName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {scope === 'list' && (
              <label className="block">
                List or deck
                <select
                  required
                  className="input block"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose list</option>
                  {state.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              Audience
              <select
                className="input block"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                <option value="public">Anyone with the link</option>
                <option value="instance">Signed-in instance members</option>
                <option value="users">Specific users</option>
              </select>
            </label>
            {audience === 'users' && (
              <label className="block">
                Recipient user IDs, comma separated
                <input
                  className="input block w-full"
                  value={users}
                  onChange={(e) => setUsers(e.target.value)}
                />
              </label>
            )}
            <label className="block">
              Expires after days (blank for no expiry)
              <input
                className="input block w-32"
                type="number"
                min="1"
                max="3650"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-4">
              {[
                ['Hide paid', hidePaid, setHidePaid],
                ['Hide values', hideValue, setHideValue],
                ['Hide notes', hideNotes, setHideNotes],
              ].map(([label, value, set]) => (
                <label key={String(label)}>
                  <input
                    type="checkbox"
                    checked={value as boolean}
                    onChange={(e) =>
                      (set as (v: boolean) => void)(e.target.checked)
                    }
                  />{' '}
                  {label as string}
                </label>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-loss">
                {error}
              </p>
            )}
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create share link'}
            </button>
          </form>
        </Modal>
      )}
      {url && (
        <div className="space-y-2 rounded-lg border border-gain/25 bg-gain/5 p-4">
          <p className="text-sm font-medium">Your share link is ready</p>
          <CopyField value={new URL(url, location.origin).href} />
          <a className="text-xs text-accent" href={url}>
            Open shared view →
          </a>
        </div>
      )}
      {error && (
        <p role="alert" className="text-loss">
          {error}
        </p>
      )}
      {shares.data
        ?.filter((s) => s.game === module.id && s.collectionId === collectionId)
        .map((s) => (
          <div
            className="flex flex-wrap gap-3 rounded-lg border border-line p-3"
            key={s.id}
          >
            <a className="flex-1 break-all text-accent" href={s.url}>
              {s.scope} · {s.active ? 'Active' : 'Revoked'}
            </a>
            {s.active && (
              <button
                className="btn btn-ghost"
                onClick={() =>
                  void api(`/api/shares/${s.id}`, { method: 'DELETE' })
                    .then(() => shares.refetch())
                    .catch((e) => setError(e.message))
                }
              >
                Revoke
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
export function GameScan() {
  const { module, language } = useGame();
  const video = useRef<HTMLVideoElement>(null),
    [status, setStatus] = useState('Camera is off.'),
    [running, setRunning] = useState(false),
    [set, setSet] = useState(''),
    [number, setNumber] = useState(''),
    [cards, setCards] = useState<TcgCard[]>([]);
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let stream: MediaStream | undefined,
      worker: Tesseract.Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const lookup = async (text: string) => {
      const candidate = module.scan(text)[0];
      if (!candidate) return;
      const result = await gameApi.search(module.id, {
        ...candidate,
        language,
      });
      if (!cancelled && result.cards.length) {
        setCards(result.cards);
        setStatus('Match found. Choose the printing and finish.');
        setRunning(false);
      }
    };
    const tick = async () => {
      if (cancelled || !video.current || !worker) return;
      try {
        const v = video.current;
        if (v.readyState >= 2) {
          const canvas = document.createElement('canvas');
          canvas.width = v.videoWidth;
          canvas.height = Math.round(v.videoHeight * 0.35);
          canvas
            .getContext('2d')
            ?.drawImage(
              v,
              0,
              Math.round(v.videoHeight * 0.65),
              v.videoWidth,
              canvas.height,
              0,
              0,
              canvas.width,
              canvas.height,
            );
          const result = await worker.recognize(canvas);
          await lookup(result.data.text);
        }
      } catch {
        /* noisy OCR is retried */
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 1500);
    };
    void (async () => {
      try {
        if (!window.isSecureContext)
          throw new Error('Camera scanning requires HTTPS or localhost.');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        setStatus('Loading on-device text recognition…');
        const { createWorker } = await import('tesseract.js');
        worker = await createWorker('eng', 1, {
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract/core',
          langPath: '/tesseract/lang',
        });
        if (cancelled) {
          await worker.terminate();
          return;
        }
        setStatus('Point the camera at the collector number and set code.');
        await tick();
      } catch (e) {
        if (!cancelled) {
          setStatus((e as Error).message);
          setRunning(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void worker?.terminate();
    };
  }, [running, module, language]);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={module.shortName} title="Scan a card">
        Find your printing using its set code and collector number.
      </PageHeader>
      <p className="text-muted">
        Photos stay on this device. Modern set codes and collector numbers work
        best; use manual lookup for older cards.
      </p>
      <button className="btn btn-ghost" onClick={() => setRunning(!running)}>
        {running ? 'Stop camera' : 'Start camera'}
      </button>
      {running && (
        <video
          ref={video}
          muted
          playsInline
          className="aspect-[4/3] w-full max-w-md rounded-xl bg-surface-2"
          aria-label="Camera preview"
        />
      )}
      <p role="status">{status}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void gameApi
            .search(module.id, { set, number, language })
            .then((r) => {
              setCards(r.cards);
              setStatus(
                r.cards.length
                  ? 'Choose the matching printing and finish.'
                  : 'No matching cards. Try name search.',
              );
            })
            .catch((e) => setStatus(e.message));
        }}
      >
        <label>
          Set code
          <input
            className="input block"
            value={set}
            onChange={(e) => setSet(e.target.value)}
            maxLength={12}
          />
        </label>
        <label>
          Collector number
          <input
            required
            className="input block"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={20}
          />
        </label>
        <button className="btn btn-primary">Look up card</button>
      </form>
      <TcgGrid cards={cards} />
    </div>
  );
}
