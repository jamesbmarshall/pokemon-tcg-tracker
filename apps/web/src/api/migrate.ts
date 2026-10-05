export { migrateVariant, resolveLegacyIds, isLegacyId } from '@poketracker/shared/migrate';

const PROVIDER_KEY = 'poketracker-provider';
const PROVIDER = 'tcgdex';

export const needsMigration = () => localStorage.getItem(PROVIDER_KEY) !== PROVIDER;
export const markMigrated = () => localStorage.setItem(PROVIDER_KEY, PROVIDER);
