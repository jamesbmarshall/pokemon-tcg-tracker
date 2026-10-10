import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Coffee, Download, FileJson, FileSpreadsheet, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { getBackend } from '../api/backend';
import { isAdmin, useAuth } from '../store/authStore';
import UpdatesSection from '../components/UpdatesSection';
import { computeValue, gradedValue, priceOf, useCollectionStore } from '../store/collectionStore';
import { useSettings, type Currency } from '../store/settingsStore';
import { useMoney, useRates } from '../hooks/useMoney';
import { PageHeader, Segmented } from '../components/ui';
import { toast } from '../store/toastStore';
import { relativeTime, todayKey } from '../utils/format';
import { variantLabel } from '../utils/variants';
import { formatGrade } from '../utils/grading';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b border-line py-8 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { currency, setCurrency, pocketSize, setPocketSize } = useSettings();
  const entries = useCollectionStore((s) => s.entries);
  const graded = useCollectionStore((s) => s.graded);
  const cards = useCollectionStore((s) => s.cards);
  const wishlist = useCollectionStore((s) => s.wishlist);
  const notes = useCollectionStore((s) => s.notes);
  const history = useCollectionStore((s) => s.history);
  const syncing = useCollectionStore((s) => s.syncing);
  const lastSync = useCollectionStore((s) => s.lastSync);
  const syncPrices = useCollectionStore((s) => s.syncPrices);
  const importData = useCollectionStore((s) => s.importData);
  const clearAll = useCollectionStore((s) => s.clearAll);
  const lists = useCollectionStore((s) => s.lists);
  const readOnly = useCollectionStore((s) => s.readOnly);
  const role = useCollectionStore((s) => s.role);
  const user = useAuth((s) => s.user);
  const { data: status } = useQuery({ queryKey: ['system', 'status'], queryFn: () => getBackend().status(), staleTime: 60_000 });
  const { data: rates } = useRates();
  const money = useMoney();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmText, setConfirmText] = useState('');
  const value = useMemo(() => computeValue(entries.values(), cards, graded.values()), [entries, cards, graded]);

  const exportJson = () => {
    const payload = {
      app: 'poketracker',
      version: 4,
      exportedAt: new Date().toISOString(),
      collection: Array.from(entries.values()),
      wishlist: Array.from(wishlist.values()),
      // Slab photos stay on the server (and in its backups); only slab details are exported.
      graded: Array.from(graded.values()),
      notes: Array.from(notes, ([cardId, text]) => ({ cardId, text })),
      history,
      lists,
    };
    download(`poketracker-${todayKey()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportCsv = () => {
    const header = ['Card ID', 'Name', 'Set', 'Number', 'Rarity', 'Variant', 'Quantity', 'Condition', `Market (${currency}) each`, 'Added', 'Grade', 'Cert', 'Counts towards set', 'Paid (each)', 'Paid currency', 'Notes'];
    const rate = rates?.[currency] ?? 1;
    const rows = Array.from(entries.values()).map((e) => {
      const c = cards.get(e.cardId);
      const p = priceOf(c, e.variant);
      return [e.cardId, c?.name, c?.setName, c?.number, c?.rarity, variantLabel(e.variant), e.quantity, e.condition ?? '', p ? (p * rate).toFixed(2) : '', e.addedAt.slice(0, 10), '', '', '', e.paid?.amount.toFixed(2) ?? '', e.paid?.currency ?? '', notes.get(e.cardId) ?? ''];
    });
    for (const g of graded.values()) {
      const c = cards.get(g.cardId);
      const v = gradedValue(g, cards);
      rows.push([g.cardId, c?.name, c?.setName, c?.number, c?.rarity, variantLabel(g.variant), 1, g.label ?? '', v ? (v * rate).toFixed(2) : '', g.addedAt.slice(0, 10), formatGrade(g), g.certNumber ?? '', g.countsTowardSet ? 'Yes' : 'No', g.paid?.amount.toFixed(2) ?? '', g.paid?.currency ?? '', notes.get(g.cardId) ?? '']);
    }
    download(`poketracker-${todayKey()}.csv`, [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const n = await importData(JSON.parse(await file.text()));
      toast(`Imported ${n} entries`, { tone: 'success' });
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, { tone: 'error' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" />

      <Section title="Currency" description="Prices come from TCGplayer (USD) and Cardmarket (EUR) and are converted at the latest ECB reference rate.">
        <Segmented<Currency>
          value={currency}
          onChange={setCurrency}
          options={[
            { value: 'GBP', label: '£ GBP' },
            { value: 'EUR', label: '€ EUR' },
            { value: 'USD', label: '$ USD' },
          ]}
        />
        {rates && currency !== 'USD' && <p className="mt-3 font-mono text-xs text-faint">$1 = {rates[currency].toFixed(4)} {currency}</p>}
      </Section>

      <Section title="Binder pages" description="Pocket layout for the binder view.">
        <Segmented
          value={pocketSize}
          onChange={setPocketSize}
          options={[
            { value: 9, label: '9-pocket (3×3)' },
            { value: 12, label: '12-pocket (4×3)' },
          ]}
        />
      </Section>

      <Section title="Prices" description="Your server refreshes prices for every owned and wishlisted card twice a day, even when nobody has the app open. Each day's total is saved to build your value chart.">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={async () => {
              const n = await syncPrices(true);
              if (n < 0) toast(useCollectionStore.getState().syncError ?? "Couldn't refresh prices. Try again in a minute.", { tone: 'error' });
              else toast(`Prices up to date for ${n} card${n === 1 ? '' : 's'}`, { tone: 'success' });
            }} disabled={syncing} className="btn btn-ghost">
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Refreshing…' : 'Refresh now'}
          </button>
          <span className="text-xs text-muted">
            {lastSync ? `Last refreshed ${relativeTime(lastSync)}` : 'Not refreshed yet'} · {history.length} day{history.length === 1 ? '' : 's'} of history
          </span>
        </div>
      </Section>

      <Section
        title="Backup"
        description={
          <>
            Your collection is stored on your PokéTracker server, which also takes nightly backups. Export a copy to keep elsewhere whenever you like. Current total: {entries.size} entries{graded.size ? ` + ${graded.size} graded` : ''}, {money(value.valueUsd)}.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <button onClick={exportJson} disabled={!entries.size && !wishlist.size && !graded.size && !notes.size} className="btn btn-primary">
            <FileJson size={15} /> Export JSON
          </button>
          <button onClick={exportCsv} disabled={!entries.size && !graded.size} className="btn btn-ghost">
            <FileSpreadsheet size={15} /> Export CSV
          </button>
          {!readOnly && (
            <>
              <button onClick={() => fileRef.current?.click()} className="btn btn-ghost">
                <Upload size={15} /> Import JSON
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" onChange={onImport} className="hidden" />
            </>
          )}
        </div>
        {!readOnly && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
            <Download size={12} /> Imports merge with this collection. Matching cards are overwritten. Exports from the older, browser-only PokéTracker work too.
          </p>
        )}
      </Section>

      <Section title="Server" description="This PokéTracker server and who can use it.">
        <p className="text-sm text-muted">
          Version <b className="font-mono text-fg">{status?.version ?? '…'}</b>
          {status?.updateAvailable && status.latest && user?.role !== 'owner' && <> · version {status.latest} is available; the owner can install it.</>}
        </p>
        {isAdmin(user) && (
          <Link to="/admin" className="btn btn-ghost mt-3">
            <ShieldCheck size={15} /> Users, invites, jobs & backups
          </Link>
        )}
      </Section>

      {user?.role === 'owner' && (
        <Section title="Updates" description="Install new versions of PokéTracker from here. Your data is backed up first, and a version that won't start is undone automatically.">
          <UpdatesSection />
        </Section>
      )}

      <Section title="Data source" description="Where card data comes from.">
        <p className="text-sm leading-relaxed text-muted">
          Sets, cards and images come from{' '}
          <a className="text-fg underline underline-offset-2" href="https://tcgdex.dev" target="_blank" rel="noreferrer">
            TCGdex
          </a>
          , a free, open-source card database that needs no API key. Prices are TCGplayer (US) and Cardmarket (EU) figures supplied by TCGdex.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Your server keeps its own copy of every owned and wishlisted card and its image, so your collection still works if a data source changes.
        </p>
        <a
          href="https://ko-fi.com/jamesbmarshall"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-faint underline underline-offset-2 hover:text-muted"
        >
          <Coffee size={14} /> Support PokéTracker on Ko-fi
        </a>
      </Section>

      {role === 'owner' && (
      <Section title="Danger zone" description="Permanently remove every card, slab, note, list, wishlist entry and value history point from this collection.">
        <div className="rounded-2xl border border-loss/30 bg-loss/5 p-4">
          <label className="text-xs text-muted">
            Type <b className="font-mono text-fg">delete</b> to confirm
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="input !w-40" />
            <button
              disabled={confirmText !== 'delete'}
              onClick={async () => {
                exportJson();
                await clearAll();
                setConfirmText('');
                toast('Collection cleared. A backup was downloaded first.');
              }}
              className="btn btn-danger"
            >
              <Trash2 size={15} /> Clear everything
            </button>
          </div>
          <p className="mt-2 text-[11px] text-faint">A JSON backup downloads automatically before anything is deleted.</p>
        </div>
      </Section>
      )}
    </div>
  );
}
