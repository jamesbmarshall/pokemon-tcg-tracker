import type {
  GameRecord,
  GameState,
  TcgCard,
  TcgPage,
  TcgSearch,
  TcgSet,
} from '@poketracker/shared/tcg/types';
import { api } from '../api/http';
export const gameStateKey = (collectionId: string | null, game: string) =>
  ['game-state', collectionId, game] as const;
export const gameApi = {
  state: (id: string, game: string) =>
    api<GameState>(`/api/collections/${id}/games/${game}/state`, {
      acceptRevision: 'initial',
    }),
  save: (id: string, game: string, records: GameRecord[]) =>
    api(`/api/collections/${id}/games/${game}/records`, {
      method: 'PUT',
      body: { records },
    }),
  remove: (id: string, game: string, kind: string, recordId: string) =>
    api(
      `/api/collections/${id}/games/${game}/records/${kind}/${encodeURIComponent(recordId)}`,
      { method: 'DELETE' },
    ),
  sets: (game: string) => api<TcgSet[]>(`/api/games/${game}/sets`),
  set: (game: string, id: string, language: string) =>
    api<{ cards: TcgCard[]; complete: boolean }>(
      `/api/games/${game}/sets/${encodeURIComponent(id)}?language=${language}`,
    ),
  card: (game: string, id: string) =>
    api<TcgCard>(`/api/games/${game}/cards/${encodeURIComponent(id)}`),
  search: (game: string, query: TcgSearch) =>
    api<TcgPage>(
      `/api/games/${game}/search?${new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== '' && v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      )}`,
    ),
};
export function download(
  name: string,
  content: string,
  type = 'application/json',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
