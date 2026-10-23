import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { games } from '@poketracker/shared/tcg/registry';
import type { GameRecord, GameState } from '@poketracker/shared/tcg/types';
import { collectionValue } from '@poketracker/shared/tcg/collection';
import { useCollectionStore } from '../store/collectionStore';
import { useAuth } from '../store/authStore';
import { acceptCollectionRevision } from '../api/concurrency';
import { toast } from '../store/toastStore';
import { gameApi, gameStateKey } from './api';
import { GameContext } from './context';
import {
  GameDashboard,
  GameSearch,
  GameSets,
  GameCollection,
  GameCard,
} from './Views';
import { PreconPage } from './Precons';
import { DecksPage } from './Decks';
import {
  GameSealed,
  GameSettings,
  GameSharing,
  GameScan,
  AssetTools,
} from './extras';
import { TcgGrid } from './Cards';
import { useMoney } from '../hooks/useMoney';
import { currentRates } from '../utils/fx';
export default function GamePage({ game, section: pageSection }: { game: string; section?: 'settings' | 'sharing' }) {
  const module = games.require(game),
    collectionId = useCollectionStore((s) => s.collectionId),
    userId = useAuth((s) => s.user?.id);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [language, setLanguage] = useState(
    () => localStorage.getItem(`tcg-language:${game}`) ?? 'en',
  );
  const { pathname, search } = useLocation();
  const client = useQueryClient();
  const q = useQuery({
    queryKey: [...gameStateKey(collectionId, game), userId],
    queryFn: () => gameApi.state(collectionId!, game),
    enabled: !!collectionId && !!userId,
  });
  useEffect(() => {
    if (q.data && collectionId)
      acceptCollectionRevision(collectionId, q.data.revision);
  }, [q.data, collectionId]);
  const reload = async () => {
    const result = await q.refetch();
    if (result.error) throw result.error;
    return result;
  };
  const perform = async (action: () => Promise<unknown>) => {
    if (busy || q.data?.role === 'viewer') return false;
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, { tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (q.error)
    return (
      <div role="alert">
        <p>{q.error.message}</p>
        <button className="btn btn-ghost" onClick={() => void q.refetch()}>
          Retry
        </button>
      </div>
    );
  if (!collectionId || !q.data)
    return <p role="status">Loading {module.shortName} collection…</p>;
  const state = q.data,
    readOnly = state.role === 'viewer';
  const save = (records: GameRecord[]) =>
    perform(() => gameApi.save(collectionId, game, records));
  const remove = async (kind: string, id: string) => {
    const data =
      kind === 'entry'
        ? state.entries.find((r) => r.id === id)
        : kind === 'graded'
          ? state.graded.find((r) => r.id === id)
          : kind === 'sealed'
            ? state.sealed.find((r) => r.id === id)
            : kind === 'list'
              ? state.lists.find((r) => r.id === id)
              : kind === 'wishlist'
                ? { id }
                : state.notes.find((r) => r.id === id);
    const ok = await perform(() =>
      gameApi.remove(collectionId, game, kind, id),
    );
    if (ok && data)
      toast('Removed from collection', {
        action: {
          label: 'Undo',
          run: () => {
            void save([{ kind: kind as GameRecord['kind'], id, data }]);
          },
        },
      });
    return ok;
  };
  const parts = pathname.split('/').filter(Boolean).slice(1),
    section = pageSection ?? parts[0] ?? '',
    id = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  const body =
    section === 'precons' && id ? (
      <PreconPage key={id} id={id} />
    ) : section === 'sets' ? (
      <GameSets id={id} />
    ) : section === 'card' && id ? (
      <GameCard key={id} id={id} />
    ) : section === 'search' ? (
      <GameSearch />
    ) : section === 'collection' ? (
      <GameCollection />
    ) : section === 'wishlist' ? (
      <GameCollection wishlist />
    ) : section === 'sealed' ? (
      <GameSealed />
    ) : section === 'lists' ? (
      <DecksPage listId={id} />
    ) : section === 'scan' ? (
      <GameScan />
    ) : section === 'sharing' ? (
      <GameSharing />
    ) : section === 'settings' ? (
      <GameSettings />
    ) : (
      <GameDashboard />
    );
  return (
    <GameContext.Provider
      value={{
        module,
        state,
        collectionId,
        readOnly,
        busy,
        language,
        setLanguage: (l) => {
          setLanguage(l);
          localStorage.setItem(`tcg-language:${game}`, l);
          void client.invalidateQueries({ queryKey: ['tcg-search', game] });
        },
        save,
        remove,
        reload,
      }}
    >
      {['sets', 'search', 'scan'].includes(section) &&
        !(
          section === 'search' &&
          new URLSearchParams(search).get('tab') === 'precons'
        ) && (
          <div className="mb-5 flex justify-end">
            <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
              Card language
              <select
                className="input !h-8 !w-auto max-w-48 !py-1 !text-xs"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  localStorage.setItem(`tcg-language:${game}`, e.target.value);
                }}
              >
                {module.languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      {busy && (
        <p
          role="status"
          className="fixed bottom-20 right-5 z-30 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted shadow-sm"
        >
          Saving…
        </p>
      )}
      {error && (
        <div role="alert" className="mb-3 text-sm text-loss">
          {error}
          <button
            className="btn btn-ghost ml-2"
            onClick={() => void reload().then(() => setError(''))}
          >
            Reload saved collection
          </button>
        </div>
      )}
      {readOnly && <p className="mb-3 text-sm text-muted">View only</p>}
      {body}
    </GameContext.Provider>
  );
}
export function GameValueBadge({ game }: { game: string }) {
  const id = useCollectionStore((s) => s.collectionId),
    user = useAuth((s) => s.user?.id);
  const money = useMoney();
  const q = useQuery({
    queryKey: [...gameStateKey(id, game), user],
    queryFn: () => gameApi.state(id!, game),
    enabled: !!id && !!user,
  });
  const value = q.data
    ? collectionValue(
        q.data.cards,
        q.data.entries,
        q.data.graded,
        q.data.sealed,
        currentRates().EUR,
      )
    : undefined;
  return (
    <div className="border-t border-line px-3 pt-4">
      <p className="eyebrow">{games.require(game).shortName} value</p>
      <p className="mt-1 font-display text-3xl tabular">
        {money(value?.valueUsd)}
      </p>
      <p className="mt-2 text-xs text-muted">
        {value?.cards ?? 0} cards & slabs
      </p>
    </div>
  );
}
export interface GamePublicData extends GameState {
  share: {
    game: string;
    scope: string;
    target: string | null;
    title: string | null;
    ownerName: string;
    hideValue: boolean;
    hidePaid: boolean;
    hideNotes: boolean;
  };
}
export function GamePublicView({
  data,
  token,
}: {
  data: GamePublicData;
  token?: string;
}) {
  const module = games.require(data.game);
  const money = useMoney();
  const value = collectionValue(
    data.cards,
    data.entries,
    data.graded,
    data.sealed,
    currentRates().EUR,
  );
  const owned = new Set([
    ...data.entries.filter((e) => e.quantity > 0).map((e) => e.cardId),
    ...data.graded.map((g) => g.cardId),
  ]);
  const visible = ['wishlist', 'list', 'set'].includes(data.share.scope)
    ? data.cards
    : data.cards.filter((c) => owned.has(c.id));
  return (
    <GameContext.Provider
      value={{
        module,
        state: data,
        collectionId: 'public',
        readOnly: true,
        busy: false,
        language: 'en',
        setLanguage: () => {},
        save: async () => false,
        remove: async () => false,
        reload: async () => {},
        shareToken: token,
      }}
    >
      <main className="mx-auto max-w-6xl space-y-6 p-5">
        <Link to="/" className="text-accent">
          PokéTracker
        </Link>
        <h1 className="font-display text-3xl font-semibold">
          {data.share.title ??
            `${data.share.ownerName}'s ${module.shortName} collection`}
        </h1>
        <p className="text-sm text-muted">Shared read-only · {module.name}</p>
        {!data.share.hideValue && data.share.scope === 'collection' && (
          <p className="text-xl">
            {money(value.valueUsd)} · {value.cards} cards & slabs
          </p>
        )}
        <TcgGrid cards={visible} />
        {data.notes.map((note) => (
          <p key={note.id} className="whitespace-pre-wrap text-sm">
            {data.cards.find((c) => c.id === note.id)?.name}: {note.text}
          </p>
        ))}
        {data.graded.map((slab) => (
          <section className="rounded-lg border border-line p-3" key={slab.id}>
            <h2>
              {data.cards.find((c) => c.id === slab.cardId)?.name} ·{' '}
              {slab.company} {slab.grade} · {slab.certNumber}
            </h2>
            <AssetTools kind="graded" item={slab} />
          </section>
        ))}
        {data.lists.map((l) => (
          <section key={l.id}>
            <h2 className="text-xl font-semibold">{l.name}</h2>
            {l.description && <p>{l.description}</p>}
            <ul className="mt-2 text-sm">
              {l.items.map((i, n) => (
                <li key={n}>
                  {i.zone} · {i.quantity} ×{' '}
                  {data.cards.find((c) => c.id === i.cardId)?.name ?? i.cardId}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {data.sealed.map((s) => (
          <div className="rounded-lg border border-line p-3" key={s.id}>
            <strong>
              {s.name} ×{s.quantity}
            </strong>{' '}
            · {s.status}
            {s.notes && <p>{s.notes}</p>}
            <AssetTools kind="sealed" item={s} />
          </div>
        ))}
        <p className="text-xs text-muted">{module.attribution}</p>
      </main>
    </GameContext.Provider>
  );
}
