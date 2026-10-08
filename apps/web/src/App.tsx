/**
 * App shell: React Query client, router, and the auth gate.
 *
 * Token links (invites, password resets, public shares) are routed before the gate so they work
 * without a session. Everything else waits for authStore to decide between setup, sign-in and the
 * signed-in app.
 */
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCollectionStore } from './store/collectionStore';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import SetsPage from './pages/SetsPage';
import SetPage from './pages/SetPage';
import CardPage from './pages/CardPage';
import CollectionPage from './pages/CollectionPage';
import WishlistPage from './pages/WishlistPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import { ListPage, ListsPage } from './pages/ListsPage';
import SharingPage from './pages/SharingPage';
import PublicSharePage from './pages/PublicSharePage';
import { AuthShell, InvitePage, LoginPage, ResetPage, SetupPage } from './pages/AuthPages';
import { useAuth } from './store/authStore';
import { Logo } from './components/ui';
import { useThemeSync } from './utils/theme';

// Catalogue queries retry with backoff because upstream TCGdex hiccups are common and transient.
// Focus refetching is off: the data changes rarely and a refetch would hit the server for nothing.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, retryDelay: (n) => Math.min(1000 * 2 ** n, 6000), refetchOnWindowFocus: false },
  },
});

// Old /browse/:setId bookmarks from before the routes were renamed.
function LegacySetRedirect() {
  const { setId } = useParams();
  return <Navigate to={`/sets/${setId}`} replace />;
}

function SignedInApp() {
  const load = useCollectionStore((s) => s.load);
  const userId = useAuth((s) => s.user?.id);
  // Keyed on the user id so signing in as someone else loads their collection, not the cached one.
  useEffect(() => {
    if (userId) void load();
  }, [load, userId]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="sets" element={<SetsPage />} />
        <Route path="sets/:setId" element={<SetPage />} />
        <Route path="card/:cardId" element={<CardPage />} />
        <Route path="collection" element={<CollectionPage />} />
        <Route path="wishlist" element={<WishlistPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="lists/:listId" element={<ListPage />} />
        <Route path="sharing" element={<SharingPage />} />
        <Route path="shared" element={<Navigate to="/sharing" replace />} />
        <Route path="browse" element={<Navigate to="/sets" replace />} />
        <Route path="browse/:setId" element={<LegacySetRedirect />} />
        <Route path="binder" element={<Navigate to="/collection?view=binder" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <div className="animate-pulse">
        <Logo size={40} />
      </div>
    </div>
  );
}

/** Shows whatever the session calls for: first-run setup, sign-in, or the app itself. */
function Gate() {
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const init = useAuth((s) => s.init);
  switch (status) {
    case 'loading':
      return <Splash />;
    case 'offline':
      return (
        <AuthShell title="Can't reach PokéTracker" intro={error ?? 'The server is unavailable.'}>
          <p className="text-sm text-muted">If it's just been updated or restarted, give it a minute.</p>
          <button className="btn btn-primary mt-5 w-full" onClick={() => void init()}>
            Try again
          </button>
        </AuthShell>
      );
    case 'setup':
      return <SetupPage />;
    case 'signed-out':
    case 'mfa':
      return <LoginPage />;
    case 'ready':
      return <SignedInApp />;
  }
}

function AppInner() {
  const init = useAuth((s) => s.init);
  useThemeSync();
  // Guarded so StrictMode's double effect and remounts don't restart an auth check already done.
  useEffect(() => {
    if (useAuth.getState().status === 'loading') void init();
  }, [init]);

  return (
    <Routes>
      <Route path="invite/:token" element={<InvitePage />} />
      <Route path="reset/:token" element={<ResetPage />} />
      <Route path="s/:token" element={<PublicSharePage />} />
      <Route path="*" element={<Gate />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
