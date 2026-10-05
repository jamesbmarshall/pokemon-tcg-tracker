import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Heart, Layers, LayoutDashboard, RefreshCw, Search, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { computeValue, useCollectionStore } from '../store/collectionStore';
import { useMoney } from '../hooks/useMoney';
import { toast } from '../store/toastStore';
import { relativeTime } from '../utils/format';
import { isAdmin, useAuth } from '../store/authStore';
import { Logo } from './ui';
import CommandPalette from './CommandPalette';
import Toaster from './Toaster';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sets', label: 'Sets', icon: Layers },
  { to: '/collection', label: 'Collection', icon: BookOpen },
  { to: '/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/search', label: 'Search', icon: Search },
];

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
    <div className="rounded-2xl border border-line bg-gradient-to-br from-surface-2 to-surface p-4">
      <p className="eyebrow">Collection value</p>
      <p className="mt-1 font-display text-2xl font-bold tabular">{money(valueUsd)}</p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="tabular">{count.toLocaleString('en-GB')} cards</span>
        <button
          onClick={async () => {
            if ((await syncPrices(true)) < 0) toast("Couldn't reach the card API. Prices weren't refreshed.", { tone: 'error' });
          }}
          disabled={syncing} className="inline-flex items-center gap-1 hover:text-fg" title="Refresh prices">
          <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing' : lastSync ? relativeTime(lastSync) : 'Sync'}
        </button>
      </div>
    </div>
  );
}

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`;

function AccountLink() {
  const user = useAuth((s) => s.user);
  if (!user) return null;
  return (
    <NavLink to="/account" className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${isActive ? 'bg-surface-2' : 'hover:bg-surface'}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-surface-2 font-display text-sm font-semibold uppercase text-volt">
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
  const admin = useAuth((s) => isAdmin(s.user));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]');
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-ink-2/80 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link to="/" className="flex items-center gap-2.5 px-2">
          <Logo size={30} />
          <span className="font-display text-[19px] font-extrabold tracking-tight font-stretch-expanded">
            Poké<span className="holo-text">Tracker</span>
          </span>
        </Link>

        <button
          onClick={() => setPalette(true)}
          className="mt-6 flex h-10 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Quick search</span>
          <kbd className="rounded-md border border-line px-1.5 font-mono text-[10px]">{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <nav className="mt-6 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                  isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface hover:text-fg'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-2.5 h-5 w-[3px] rounded-r-full bg-volt" />}
                  <Icon size={17} className={isActive ? 'text-volt' : ''} />
                  <span className="flex-1">{label}</span>
                  {to === '/wishlist' && wishCount > 0 && <span className="font-mono text-[10px] text-faint">{wishCount}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <ValueBadge />
          <div className="space-y-0.5">
            <NavLink to="/settings" className={sideLink}>
              <Settings size={17} />
              Settings
            </NavLink>
            {admin && (
              <NavLink to="/admin" className={sideLink}>
                <ShieldCheck size={17} />
                Admin
              </NavLink>
            )}
          </div>
          <div className="border-t border-line pt-3">
            <AccountLink />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-ink/80 px-4 backdrop-blur-xl lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={26} />
          <span className="font-display text-lg font-extrabold tracking-tight font-stretch-expanded">
            Poké<span className="holo-text">Tracker</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <button onClick={() => setPalette(true)} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:text-fg" aria-label="Search">
            <Search size={19} />
          </button>
          <Link to="/settings" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:text-fg" aria-label="Settings">
            <Settings size={19} />
          </Link>
          <Link to="/account" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:text-fg" aria-label="Account">
            <UserRound size={19} />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
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
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-medium ${isActive ? 'text-volt' : 'text-muted'}`}
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
