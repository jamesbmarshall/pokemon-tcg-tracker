/**
 * Signed-in app chrome: desktop sidebar, mobile top and tab bars, collection switcher, value
 * badge, and the command palette shortcut. Pages render into the <Outlet />.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Eye, Heart, Info, Layers, LayoutDashboard, ListChecks, RefreshCw, Search, Settings, Share2, ShieldCheck, UserRound, X } from 'lucide-react';
import { computeValue, useCollectionStore } from '../store/collectionStore';
import { useMoney } from '../hooks/useMoney';
import { toast } from '../store/toastStore';
import { relativeTime } from '../utils/format';
import { isAdmin, useAuth } from '../store/authStore';
import { getBackend } from '../api/backend';
import { Logo } from './ui';
import CommandPalette from './CommandPalette';
import ThemeToggle from './ThemeToggle';
import Toaster from './Toaster';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sets', label: 'Sets', icon: Layers },
  { to: '/collection', label: 'Collection', icon: BookOpen },
  { to: '/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/search', label: 'Search', icon: Search },
];

/**
 * Sidebar collection value. Refresh asks the server for fresh prices; for members the server
 * refuses that part and the store just reloads the latest prices it already has.
 */
function ValueBadge() {
  const entries = useCollectionStore((s) => s.entries);
  const cards = useCollectionStore((s) => s.cards);
  const graded = useCollectionStore((s) => s.graded);
  const syncing = useCollectionStore((s) => s.syncing);
  const lastSync = useCollectionStore((s) => s.lastSync);
  const syncPrices = useCollectionStore((s) => s.syncPrices);
  const money = useMoney();
  const { valueUsd, count } = useMemo(() => computeValue(entries.values(), cards, graded.values()), [entries, cards, graded]);
  return (
    <div className="border-t border-line px-3 pt-4">
      <p className="eyebrow">Collection value</p>
      <p className="mt-1 font-display text-[1.75rem] font-medium leading-none tabular">{money(valueUsd)}</p>
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted">
        <span className="tabular">{count.toLocaleString('en-GB')} cards</span>
        <button
          onClick={async () => {
            if ((await syncPrices(true)) < 0) toast(useCollectionStore.getState().syncError ?? "Prices weren't refreshed.", { tone: 'error' });
          }}
          disabled={syncing} className="inline-flex items-center gap-1 hover:text-fg" title="Refresh prices">
          <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing' : lastSync ? relativeTime(lastSync) : 'Sync'}
        </button>
      </div>
    </div>
  );
}

/** Picks which collection the whole app shows. Hidden until there's more than one. */
function CollectionSwitcher({ className = '' }: { className?: string }) {
  const collections = useCollectionStore((s) => s.collections);
  const current = useCollectionStore((s) => s.collectionId);
  const readOnly = useCollectionStore((s) => s.readOnly);
  const load = useCollectionStore((s) => s.load);
  if (collections.length < 2) return null;
  return (
    <div className={className}>
      <label className="relative block">
        <span className="sr-only">Collection</span>
        <select
          value={current ?? ''}
          onChange={(e) => void load(e.target.value)}
          className="input !h-9 w-full truncate !pr-8 !text-sm font-medium"
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind === 'personal' && c.mine ? `${c.name} (yours)` : c.mine ? c.name : `${c.name} · ${c.ownerName}`}
            </option>
          ))}
        </select>
      </label>
      {readOnly && (
        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted">
          <Eye size={11} /> View only
        </p>
      )}
    </div>
  );
}

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors ${isActive ? 'bg-accent/10 font-semibold text-accent' : 'font-medium text-muted hover:bg-surface-2 hover:text-fg'}`;

/** Dismissible for the tab (not persisted), since a demo server shows it to every new visitor anyway. */
function DemoBanner() {
  const { data: status } = useQuery({ queryKey: ['system', 'status'], queryFn: () => getBackend().status(), staleTime: 60_000 });
  const [dismissed, setDismissed] = useState(false);
  if (!status?.demoMode || dismissed) return null;
  return (
    <div className="flex items-center gap-2.5 bg-accent/10 px-4 py-2 text-xs text-accent lg:pl-[17.5rem]">
      <Info size={14} className="shrink-0" />
      <p className="flex-1">You're viewing a demo — changes are disabled and the collection resets nightly.</p>
      <button onClick={() => setDismissed(true)} className="shrink-0 rounded p-0.5 hover:bg-accent/15" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

function AccountLink() {
  const user = useAuth((s) => s.user);
  if (!user) return null;
  return (
    <NavLink to="/account" className={({ isActive }) => `flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${isActive ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong font-display text-[15px] font-medium uppercase text-fg">
        {user.displayName.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{user.displayName}</span>
        <span className="block truncate font-mono text-[11px] text-faint">{user.username}</span>
      </span>
    </NavLink>
  );
}

export default function Layout() {
  const [palette, setPalette] = useState(false);
  const { pathname } = useLocation();
  const wishCount = useCollectionStore((s) => s.wishlist.size);
  // Only hides the link; the admin page and its endpoints check the role again.
  const admin = useAuth((s) => isAdmin(s.user));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]');
      // Cmd/Ctrl+K works even while typing (it has no text meaning); '/' only outside text fields.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The layout persists across routes, so the browser won't reset scroll on navigation by itself.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="min-h-dvh lg:pl-64">
      <DemoBanner />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Link to="/" className="flex items-center gap-2.5 px-2">
          <Logo size={28} />
          <span className="font-display text-[21px] font-medium tracking-tight">
            Poké<span className="holo-text">Tracker</span>
          </span>
        </Link>

        <button
          onClick={() => setPalette(true)}
          className="mt-7 flex h-9 items-center gap-2.5 rounded-md border border-line-strong bg-canvas px-3 text-sm text-faint transition-colors hover:text-muted"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Quick search</span>
          <kbd className="rounded-md border border-line px-1.5 font-mono text-[10px]">{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <CollectionSwitcher className="mt-4" />

        <nav className="mt-7 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={sideLink}>
              <Icon size={16} strokeWidth={1.9} />
              <span className="flex-1">{label}</span>
              {to === '/wishlist' && wishCount > 0 && <span className="font-mono text-[10px] font-normal text-faint">{wishCount}</span>}
            </NavLink>
          ))}
          <NavLink to="/lists" className={sideLink}>
            <ListChecks size={16} strokeWidth={1.9} />
            Lists
          </NavLink>
        </nav>

        <div className="mt-auto space-y-4">
          <ValueBadge />
          <div className="space-y-0.5">
            <NavLink to="/sharing" className={sideLink}>
              <Share2 size={16} strokeWidth={1.9} />
              Sharing
            </NavLink>
            <NavLink to="/settings" className={sideLink}>
              <Settings size={16} strokeWidth={1.9} />
              Settings
            </NavLink>
            {admin && (
              <NavLink to="/admin" className={sideLink}>
                <ShieldCheck size={16} strokeWidth={1.9} />
                Admin
              </NavLink>
            )}
          </div>
          <div className="flex items-center gap-1 border-t border-line pt-3">
            <AccountLink />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur-md lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={26} />
          <span className="font-display text-lg font-medium tracking-tight">
            Poké<span className="holo-text">Tracker</span>
          </span>
        </Link>
        <div className="flex items-center">
          <ThemeToggle className="!h-10 !w-10" />
          <button onClick={() => setPalette(true)} className="grid h-10 w-10 place-items-center rounded-md text-muted hover:text-fg" aria-label="Search">
            <Search size={19} />
          </button>
          <Link to="/sharing" className="grid h-10 w-10 place-items-center rounded-md text-muted hover:text-fg" aria-label="Sharing">
            <Share2 size={19} />
          </Link>
          <Link to="/settings" className="grid h-10 w-10 place-items-center rounded-md text-muted hover:text-fg" aria-label="Settings">
            <Settings size={19} />
          </Link>
          <Link to="/account" className="grid h-10 w-10 place-items-center rounded-md text-muted hover:text-fg" aria-label="Account">
            <UserRound size={19} />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        <CollectionSwitcher className="mb-5 lg:hidden" />
        <Outlet />
        <footer className="mt-20 border-t border-line pt-6 text-xs text-faint">
          Card data, images & prices from{' '}
          <a href="https://tcgdex.dev" target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-muted">
            TCGdex
          </a>{' '}
          (TCGplayer & Cardmarket). Currency rates from{' '}
          <a href="https://frankfurter.dev" target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-muted">
            Frankfurter
          </a>
          . Pokémon and card images © The Pokémon Company.
        </footer>
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-canvas/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] ${isActive ? 'font-semibold text-accent' : 'font-medium text-muted'}`}
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>

      {palette && <CommandPalette open onClose={() => setPalette(false)} />}
      <Toaster />
    </div>
  );
}
