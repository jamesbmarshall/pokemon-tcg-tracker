import { createContext, useContext } from 'react';
import type {
  GameModule,
  GameRecord,
  GameState,
} from '@poketracker/shared/tcg/types';
export interface GameContextValue {
  shareToken?: string;
  module: GameModule;
  state: GameState;
  collectionId: string;
  readOnly: boolean;
  busy: boolean;
  language: string;
  setLanguage: (language: string) => void;
  save: (records: GameRecord[]) => Promise<boolean>;
  remove: (kind: string, id: string) => Promise<boolean>;
  reload: () => Promise<unknown>;
}
export const GameContext = createContext<GameContextValue | null>(null);
export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('Game context required');
  return ctx;
}
