import { configureCatalog } from '@poketracker/shared/catalog';
import { currentRates } from '../utils/fx';

configureCatalog({ eurPerUsd: () => currentRates().EUR });

export * from '@poketracker/shared/catalog';
