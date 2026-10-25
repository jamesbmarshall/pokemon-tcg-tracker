import type { GameModule } from '../types';
import { catalogCompletion } from '../collection';
import { LANGUAGES } from '../../languages';
import { pokemonDeckTools, scanPokemon, validatePokemonDeck } from '../pokemonRules';

export const pokemonModule: GameModule = {
  id: 'pokemon',
  name: 'Pokémon',
  shortName: 'Pokémon',
  compatibility: { reason: 'Existing Pokémon controllers and catalogue storage remain until the normalized provider and state adapters are installed.' },
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
  formats: (['standard', 'expanded', 'unlimited'] as const).map((id) => ({
    id, name: id[0].toUpperCase() + id.slice(1), size: 60,
    validate: (items, cards, context) => validatePokemonDeck(items, cards, id, context),
  })),
  deckTools: pokemonDeckTools,
  complete: catalogCompletion,
  scan: scanPokemon,
};
