import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { games } from '@poketracker/shared/tcg/registry';

const universalPages = new Set(['', 'settings', 'sharing', 'shared', 'admin', 'account']);

/** Global pages retain the last game; catalogue URLs explicitly select their game. */
export function useActiveGame() {
  const { pathname } = useLocation();
  const section = pathname.split('/')[1];
  const game = games.get(section)?.id ?? (universalPages.has(section)
    ? games.get(localStorage.getItem('poketracker-game') ?? '')?.id ?? 'pokemon'
    : 'pokemon');

  useEffect(() => {
    localStorage.setItem('poketracker-game', game);
  }, [game]);

  return game;
}
