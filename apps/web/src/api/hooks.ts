import { useEffect } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getCard, getPrintings, getRarities, getSet, getSetCards, getSets, primeSets, searchCards, type SearchFilters } from './client';
import { LANGUAGES, type Lang } from './languages';
import { useCollectionStore } from '../store/collectionStore';
import { cardVariants } from './client';
import type { CardSet } from './types';

const HOUR = 1000 * 60 * 60;

const SETS_CACHE = 'poketracker-sets-v2';
localStorage.removeItem('poketracker-sets'); // pokemontcg.io era

const cacheKey = (lang: Lang) => (lang === 'en' ? SETS_CACHE : `${SETS_CACHE}-${lang}`);

function cachedSets(lang: Lang = 'en'): { at: number; data: CardSet[] } | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(lang));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

for (const { code } of LANGUAGES) primeSets(cachedSets(code)?.data, code);

// The set list rarely changes, so keep a local copy for instant loads and API outages.
export function useSets(lang: Lang = 'en') {
  return useQuery({
    queryKey: ['sets', lang],
    queryFn: async () => {
      const data = await getSets(lang);
      try {
        localStorage.setItem(cacheKey(lang), JSON.stringify({ at: Date.now(), data }));
      } catch {
        /* storage full — non-fatal */
      }
      return data;
    },
    staleTime: 6 * HOUR,
    initialData: () => cachedSets(lang)?.data,
    initialDataUpdatedAt: () => cachedSets(lang)?.at,
  });
}

export function useSet(setId: string) {
  return useQuery({ queryKey: ['set', setId], queryFn: () => getSet(setId), staleTime: 6 * HOUR, enabled: !!setId });
}

export function useSetCards(setId: string) {
  const recordSetStat = useCollectionStore((s) => s.recordSetStat);
  const q = useQuery({
    queryKey: ['setCards', setId],
    queryFn: () => getSetCards(setId),
    staleTime: HOUR,
    enabled: !!setId,
  });
  useEffect(() => {
    if (q.data?.length) {
      void recordSetStat(setId, q.data.reduce((n, c) => n + cardVariants(c).length, 0));
    }
  }, [q.data, setId, recordSetStat]);
  return q;
}

export function useCard(cardId: string) {
  return useQuery({ queryKey: ['card', cardId], queryFn: () => getCard(cardId), staleTime: HOUR, enabled: !!cardId });
}

export function useSearch(filters: SearchFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['search', filters],
    queryFn: ({ pageParam, signal }) => searchCards(filters, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.totalCount ? last.page + 1 : undefined),
    staleTime: 10 * 60 * 1000,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePrintings(name: string, lang: Lang = 'en') {
  return useQuery({ queryKey: ['printings', name, lang], queryFn: () => getPrintings(name, lang), staleTime: HOUR, enabled: !!name });
}

export function useRarities(lang: Lang = 'en') {
  return useQuery({ queryKey: ['rarities', lang], queryFn: () => getRarities(lang), staleTime: 24 * HOUR });
}
