# PokéTracker on Umbrel

This folder contains an Umbrel packaging template:

- [`poketracker/umbrel-app.yml`](poketracker/umbrel-app.yml): app listing metadata.
- [`poketracker/docker-compose.yml`](poketracker/docker-compose.yml): the server and configuration for Umbrel's app proxy. Data is mounted at `${APP_DATA_DIR}/data`.

## Installation status

**The main PokéTracker repository cannot be added directly as an Umbrel Community App Store.**
It has no root `umbrel-app-store.yml`, and the app folder is nested under `deploy/umbrel/`.
The gallery images referenced by the manifest are also absent.

To publish a community store, follow the [official Umbrel Community App Store template](https://github.com/getumbrel/umbrel-community-app-store):

1. Create a store repository with `umbrel-app-store.yml` at its root.
2. Copy this app into a root-level folder whose name and manifest ID start with the store ID, for example `cards-poketracker` for a store named `cards`.
3. Update `APP_HOST` in the Compose file to match the renamed app's server container, and add the gallery screenshots referenced in the manifest.
4. Publish the store repository, then add **that repository's URL** through Umbrel's Community App Stores menu and install PokéTracker.

After installation, read the setup token from the app's logs and use it to create the owner account.
Run one instance per data directory.

## Official store submission

For an official listing, submit the app folder to [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps)
with screenshots and release metadata. Follow that repository's current contribution requirements;
these files are packaging templates, not confirmation of a published or tested store listing.

For immediate self-hosting outside Umbrel, use the [Docker quick start](../../README.md#quick-start-in-2-minutes).
