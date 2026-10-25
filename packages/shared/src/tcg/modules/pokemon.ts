import type { GameModule } from '../types';
import { catalogCompletion } from '../collection';
import { LANGUAGES } from '../../languages';

export const pokemonModule: GameModule = {
  id: 'pokemon',
  name: 'Pokémon',
  shortName: 'Pokémon',
  compatibility: { reason: 'Existing Pokémon controllers own deck formats and scan lookup until shared adapters are installed.' },
  languages: LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
  capabilities: { decks: true, scanning: true, sealed: true, graded: true },
  searchFields: [
    { key: 'type', label: 'Type' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'artist', label: 'Artist' },
  ],
  sealedTypes: [
    'booster_box',
    'etb',
    'booster_bundle',
    'tin',
    'collection_box',
    'blister',
    'booster_pack',
    'other',
  ],
  // Existing Pokémon UI and deck validators remain the compatibility implementation.
  formats: [],
  complete: catalogCompletion,
  scan: () => [],
};
