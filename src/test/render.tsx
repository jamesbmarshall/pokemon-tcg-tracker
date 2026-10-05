import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router-dom';
import { render } from '@testing-library/react';

export function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.search}`}</output>;
}

function Providers({ children, client, route, path }: { children: ReactNode; client: QueryClient; route: InitialEntry; path?: string }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {path ? (
          <Routes>
            <Route path={path} element={children} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        ) : (
          children
        )}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderWithProviders(ui: ReactElement, { route = '/', path }: { route?: InitialEntry; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return { client, ...render(<Providers client={client} route={route} path={path}>{ui}</Providers>) };
}
