import type { GameModule } from './types';
import { pokemonModule } from './modules/pokemon';
import { magicModule } from './modules/magic';
export { pokemonModule, magicModule };

export type GameCapability = keyof GameModule['capabilities'];
export class GameCapabilityError extends Error {
  readonly code = 'unsupported_capability';
  readonly game: string;
  readonly capability: GameCapability;
  constructor(game: string, capability: GameCapability) {
    super(`${game} does not support ${capability}`);
    this.name = 'GameCapabilityError';
    this.game = game;
    this.capability = capability;
  }
}

function unique(values: string[], label: string, game: string) {
  if (values.some((v) => !v.trim()) || new Set(values).size !== values.length)
    throw new Error(`${game}: empty or duplicate ${label}`);
}

/** Validate source-owned configuration; external provider payload validation is separate. */
function validateModule(module: GameModule) {
  if (!module.languages.length) throw new Error(`${module.id}: no supported languages`);
  unique(module.languages.map((l) => l.code), 'language', module.id);
  unique(module.formats.map((f) => f.id), 'format', module.id);
  unique(module.searchFields.map((f) => f.key), 'search field', module.id);
  if (typeof module.complete !== 'function') throw new Error(`${module.id}: missing completion policy`);
  if (module.completionReport !== undefined && typeof module.completionReport !== 'function')
    throw new Error(`${module.id}: invalid completion report policy`);
  if (module.compatibility && !module.compatibility.reason.trim())
    throw new Error(`${module.id}: compatibility requires a reason`);
  if (module.formats.some((f) => typeof f.validate !== 'function'))
    throw new Error(`${module.id}: missing format validator`);
  if (module.capabilities.scanning && typeof module.scan !== 'function')
    throw new Error(`${module.id}: scanning requires a parser`);
  if (module.capabilities.sealed && !module.sealedTypes.length)
    throw new Error(`${module.id}: sealed requires product types`);
  if (module.capabilities.precons && !module.preconCatalogue)
    throw new Error(`${module.id}: precons requires catalogue attribution`);
  if (module.capabilities.decks && !module.compatibility) {
    const tools = module.deckTools;
    if (!module.formats.length || !tools ||
      [tools.parse, tools.format, tools.ownership, tools.analyze].some((tool) => typeof tool !== 'function'))
      throw new Error(`${module.id}: decks requires formats and complete deck tools`);
  }
}

/** Registry is injectable in tests; extensions never mutate a process-wide singleton. */
export function createGameRegistry(modules: GameModule[]) {
  const registry = new Map<string, GameModule>();
  for (const module of modules) {
    if (!/^[a-z][a-z0-9-]*$/.test(module.id) || registry.has(module.id))
      throw new Error(`Invalid or duplicate game: ${module.id}`);
    validateModule(module);
    registry.set(module.id, module);
  }
  return {
    all: () => [...registry.values()],
    get: (id: string) => registry.get(id),
    requireCapability: (id: string, capability: GameCapability) => {
      const module = registry.get(id);
      if (!module) throw new Error(`Unsupported game: ${id}`);
      if (!module.capabilities[capability]) throw new GameCapabilityError(id, capability);
      return module;
    },
    require: (id: string) => {
      const module = registry.get(id);
      if (!module) throw new Error(`Unsupported game: ${id}`);
      return module;
    },
  };
}
export const games = createGameRegistry([pokemonModule, magicModule]);
