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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, retryDelay: (n) => Math.min(1000 * 2 ** n, 6000), refetchOnWindowFocus: false },
  },
});

function LegacySetRedirect() {
  const { setId } = useParams();
  return <Navigate to={`/sets/${setId}`} replace />;
}

function AppInner() {
  const load = useCollectionStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

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
        <Route path="browse" element={<Navigate to="/sets" replace />} />
        <Route path="browse/:setId" element={<LegacySetRedirect />} />
        <Route path="binder" element={<Navigate to="/collection?view=binder" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
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
