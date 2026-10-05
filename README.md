# PokéTracker

A fast, good-looking Pokémon TCG collection tracker that runs entirely in your browser. Tick off cards as you open packs, chase master sets down to the last reverse holo, flip through a virtual binder and watch what it's all worth.

## Features

- **Dashboard**: collection value with a daily history chart, sets in progress, most valuable cards, recent additions and the sets you're closest to finishing.
- **Sets**: every English set, grouped by series, with progress bars. Each set page shows three kinds of completion:
  - **Base**: numbered cards up to the printed total.
  - **Full**: base plus the secret rares.
  - **Master**: every printing, including reverse holos and other variants.
- **Fast entry**: each card shows its printings as chips (N, RH, H, 1st…). Click a chip to add a copy and right-click to remove one. Quick add mode adds a − button for touch screens. Anything you remove can be undone.
- **Binder view**: 9- or 12-pocket pages shown as a two-page spread. Empty pockets show a ghost of the missing card. Arrow keys turn the pages.
- **Card pages**:
  - Browse the set with the arrow keys, or swipe left and right on a phone.
  - A 3D holo-tilt card image.
  - Per-variant quantity and condition.
  - Market prices (low, market and high).
  - The full card text with energy costs.
  - Other printings of the same card.
- **Wishlist**: your chase list with the running cost to buy it all. "Got it" moves a card into your collection.
- **Search**: by name, type, card type, rarity and illustrator, sorted by date, name or price.
- **Command palette**: press `⌘K` or `/` anywhere to jump to a set or card.
- **GBP, EUR or USD**: prices are converted at the daily ECB reference rate.
- **Your data stays yours**: stored in IndexedDB. You can export JSON or CSV, and JSON imports merge into your collection. "Clear everything" needs a typed confirmation and downloads a backup first.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint
```

No API key or `.env` file is needed.

## Data sources

| What | Source |
| --- | --- |
| Cards, sets, images | [TCGdex](https://tcgdex.dev) (free, open source, no key) |
| Prices | TCGplayer (US) and Cardmarket (EU), both supplied by TCGdex |
| Currency conversion | [Frankfurter](https://frankfurter.dev) (ECB reference rates) |

All API access goes through `src/api/client.ts`. It uses TCGdex REST for card detail and search and TCGdex GraphQL for set lists and bulk lookups. Requests retry with backoff, and the set list is cached locally.

The app keeps a local copy of every owned and wishlisted card, including its image, which is stored in IndexedDB. Your collection still renders offline or if TCGdex is unavailable.

### Moving from the Pokémon TCG API

Earlier versions used the [Pokémon TCG API](https://pokemontcg.io), which is deprecated; existing keys stop working on 1 March 2027. On first load, collections saved by those versions are migrated automatically:

- Set ids are mapped through `src/api/legacySets.ts` (`sv3pt5` → `sv03.5`).
- Card numbers are matched against TCGdex (`sv3pt5-6` → `sv03.5-006`).
- Variants are renamed (`unlimitedHolofoil` → `holofoil`).

Imported backups from older versions go through the same migration. If a set can't be reached during migration, the app retries on the next load.

About 1,600 cards, mostly promos and subsets, have no TCGdex scan. For these the app falls back to the old pokemontcg.io image CDN, and then to a styled placeholder.

## Project layout

```
src/
  api/          provider adapter (client.ts), React Query hooks, types
  db/           Dexie schema + migrations
  store/        Zustand stores: collection, settings, toasts
  hooks/        money/FX formatting, collection stats, debounce
  components/   Layout, CardTile, BinderView, HoloCard, ValueChart, CommandPalette, UI primitives
  pages/        Home, Sets, Set, Card, Collection, Wishlist, Search, Settings
  utils/        formatting, variants, progress, energy types, foil effect
```

Built with React 19, Vite, Tailwind CSS 4, TanStack Query, Zustand, Dexie and lucide icons.

Pokémon and all card images are © The Pokémon Company. This is a fan project, not affiliated with or endorsed by The Pokémon Company, Nintendo or Creatures.
