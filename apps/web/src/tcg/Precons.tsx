import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Download,
  ExternalLink,
  Layers,
  Search,
} from 'lucide-react';
import type { PreconDetail } from '@poketracker/shared/tcg/precons';
import {
  PageHeader,
  EmptyState,
  ErrorState,
  Segmented,
  Skeleton,
} from '../components/ui';
import { Modal } from '../components/forms';
import CardImage from '../components/CardImage';
import { useDebounced } from '../hooks/useDebounced';
import { useGame } from './context';
import { gameApi } from './api';

export function SearchTypeSwitch() {
  const { module } = useGame();
  const [params, setParams] = useSearchParams();
  if (!module.capabilities.precons) return null;
  return (
    <Segmented
      label="Search catalogue"
      value={params.get('tab') === 'precons' ? 'precons' : 'cards'}
      options={[
        { value: 'cards', label: 'Cards' },
        { value: 'precons', label: 'Precons' },
      ]}
      onChange={(tab) => {
        const next = new URLSearchParams();
        if (params.get('q')) next.set('q', params.get('q')!);
        if (tab === 'precons') next.set('tab', tab);
        setParams(next);
      }}
    />
  );
}
export function PreconSearch() {
  const { module } = useGame();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const debounced = useDebounced(search, 350);
  const q = useQuery({
    queryKey: ['tcg-precons', module.id, debounced],
    queryFn: () => gameApi.precons(module.id, debounced),
    staleTime: 3600_000,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={module.shortName}
        title="Search precons"
        actions={<SearchTypeSwitch />}
      >
        {module.preconCatalogue?.description ??
          'Published preconstructed decks'}
        . Search by name, set code or release year.
      </PageHeader>
      <label className="relative block">
        <Search size={18} className="absolute left-3 top-3.5 text-muted" />
        <span className="sr-only">Precon name or set</span>
        <input
          className="input w-full !pl-10"
          placeholder="Search precons…"
          value={search}
          maxLength={200}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('q', e.target.value);
            else next.delete('q');
            setParams(next, { replace: true });
          }}
        />
      </label>
      {q.isPending ? (
        <div role="status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
          <span className="sr-only">Loading precons…</span>
        </div>
      ) : q.error ? (
        <ErrorState
          title="Couldn't load precons"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : (
        q.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <p role="status">
                {q.data.decks.length} precon
                {q.data.decks.length === 1 ? '' : 's'}
                {q.isFetching ? ' · Updating…' : ''}
              </p>
              <a
                className="inline-flex items-center gap-1 hover:text-accent"
                href={module.preconCatalogue?.url}
                target="_blank"
                rel="noreferrer"
              >
                Decklists from{' '}
                {module.preconCatalogue?.name ?? 'catalogue provider'}{' '}
                <ExternalLink size={11} />
              </a>
            </div>
            {q.data.stale && (
              <p role="status" className="text-sm text-muted">
                Showing the saved catalogue while the provider is unavailable.
              </p>
            )}
            {q.data.decks.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {q.data.decks.map((deck) => (
                  <Link
                    key={deck.id}
                    to={`/${module.id}/precons/${encodeURIComponent(deck.id)}`}
                    className="group rounded-lg border border-line bg-surface p-5 transition-colors hover:border-accent"
                  >
                    <div className="mb-4 flex items-center justify-between text-muted">
                      <Layers size={22} />
                      <span className="eyebrow">
                        {deck.setCode} · {deck.releaseDate.slice(0, 4)}
                      </span>
                    </div>
                    <h2 className="font-display text-xl font-medium group-hover:text-accent">
                      {deck.name}
                    </h2>
                    <p className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>
                        {module.formats.find((f) => f.id === deck.format)
                          ?.name ?? deck.format}{' '}
                        · {deck.releaseDate}
                      </span>
                      <ArrowRight size={14} />
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Layers size={28} />} title="No precons found">
                Try the deck name, set code or release year. This catalogue
                includes published preconstructed decks.
              </EmptyState>
            )}
          </>
        )
      )}
    </div>
  );
}
function SavePrecon({
  deck,
  onClose,
}: {
  deck: PreconDetail;
  onClose: () => void;
}) {
  const { module, save, busy } = useGame();
  const navigate = useNavigate();
  const [name, setName] = useState(deck.name);
  const [id] = useState(() => crypto.randomUUID());
  const resolved = useQuery({
    queryKey: ['tcg-precon-cards', module.id, deck.id],
    queryFn: () => gameApi.preconCards(module.id, deck.id),
    staleTime: 3600_000,
  });
  const total = resolved.data?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;
  const complete =
    !!resolved.data && !resolved.data.unresolved.length && total === deck.total;
  return (
    <Modal title="Save precon as deck" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!complete || !resolved.data) return;
          void save([
            {
              kind: 'list',
              id,
              data: {
                id,
                game: module.id,
                name: name.trim(),
                kind: 'deck',
                format: deck.format,
                description: `Based on the ${deck.name} preconstructed deck. ${deck.sourceUrl ?? deck.catalogueUrl}`,
                items: resolved.data.items,
                addedAt: new Date().toISOString(),
              },
            },
          ]).then((ok) => {
            if (ok) navigate(`/${module.id}/lists/${id}`);
          });
        }}
      >
        <label className="block text-sm">
          Deck name
          <input
            autoFocus
            className="input mt-1 w-full"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="text-sm text-muted">
          Create an editable copy of this decklist. Your card holdings and
          sealed products stay as they are.
        </p>
        {resolved.isPending && (
          <p role="status" className="text-sm text-muted">
            Loading the exact card printings…
          </p>
        )}
        {resolved.error && (
          <p role="alert" className="text-sm text-loss">
            {resolved.error.message}{' '}
            <button
              type="button"
              className="text-accent"
              onClick={() => void resolved.refetch()}
            >
              Retry
            </button>
          </p>
        )}
        {resolved.data && !complete && (
          <div role="alert" className="text-sm text-loss">
            <p>
              Some printings could not be resolved. The deck has not been saved.
            </p>
            <ul className="mt-2 list-inside list-disc">
              {resolved.data.unresolved.map((c, i) => (
                <li key={i}>
                  {c.quantity} × {c.name} ({c.setCode} {c.number})
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-2 text-accent"
              onClick={() => void resolved.refetch()}
            >
              Retry loading printings
            </button>
          </div>
        )}
        {complete && (
          <p role="status" className="text-sm text-gain">
            All {total} cards resolved · ready to save
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim() || !complete || resolved.isFetching}
          >
            Save deck
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PreconPage({ id }: { id: string }) {
  const { module, readOnly } = useGame();
  const [saving, setSaving] = useState(false);
  const q = useQuery({
    queryKey: ['tcg-precon', module.id, id],
    queryFn: () => gameApi.precon(module.id, id),
    staleTime: 3600_000,
  });
  const back = (
    <Link
      className="inline-flex items-center gap-2 text-sm text-muted hover:text-accent"
      to={`/${module.id}/search?tab=precons`}
    >
      ← Precons
    </Link>
  );
  if (q.isPending)
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-80" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="space-y-6">
        {back}
        <ErrorState
          title="Couldn't load this precon"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  const deck = q.data;
  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow={`${deck.setCode} · ${deck.releaseDate} · Preconstructed deck`}
        title={deck.name}
        actions={
          !readOnly && (
            <button className="btn btn-primary" onClick={() => setSaving(true)}>
              <Download size={15} />
              Save as deck
            </button>
          )
        }
      >
        {deck.total} cards ·{' '}
        {module.formats.find((f) => f.id === deck.format)?.name ?? deck.format}{' '}
        · original decklist
      </PageHeader>
      {saving && <SavePrecon deck={deck} onClose={() => setSaving(false)} />}
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <a
          href={deck.catalogueUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-accent"
        >
          {module.preconCatalogue?.name ?? 'Catalogue'}{' '}
          <ExternalLink size={12} />
        </a>
        {deck.sourceUrl && (
          <a
            href={deck.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-accent"
          >
            Publisher decklist <ExternalLink size={12} />
          </a>
        )}
        <span>
          Display commanders and tokens are excluded from the playable deck.
        </span>
      </div>
      {deck.stale && (
        <p role="status" className="text-sm text-muted">
          Showing the saved decklist while the provider is unavailable.
        </p>
      )}
      {(['commander', 'main'] as const)
        .filter((zone) => deck.cards.some((card) => card.zone === zone))
        .map((zone) => (
          <section key={zone}>
            <h2 className="eyebrow mb-3 border-b border-line pb-3">
              {zone === 'commander' ? 'Commander' : 'Main deck'}{' '}
              <span className="ml-2 text-faint">
                {deck.cards
                  .filter((c) => c.zone === zone)
                  .reduce((n, c) => n + c.quantity, 0)}
              </span>
            </h2>
            <div className="grid gap-x-8 lg:grid-cols-2">
              {deck.cards
                .filter((c) => c.zone === zone)
                .map((card, i) => (
                  <div
                    className="flex items-center gap-3 border-b border-line py-2.5"
                    key={`${card.providerId}:${i}`}
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded">
                      <CardImage
                        id={card.cardId ?? `${deck.id}:${i}`}
                        src={card.image ?? ''}
                        name={card.name}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-center font-mono text-xs text-muted">
                      {card.quantity}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {card.cardId ? (
                          <Link
                            className="hover:text-accent"
                            to={`/${module.id}/card/${encodeURIComponent(card.cardId!)}`}
                          >
                            {card.name}
                          </Link>
                        ) : (
                          card.name
                        )}
                      </p>
                      <p className="mt-1 font-mono text-[10px] uppercase text-muted">
                        {card.setCode} · #{card.number}
                        {card.finish !== 'nonfoil' ? ` · ${card.finish}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))}
      <p className="border-t border-line pt-4 text-xs text-faint">
        {deck.attribution}
      </p>
    </div>
  );
}
