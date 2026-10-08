# PokéTracker on Umbrel

[`poketracker/umbrel-app.yml`](poketracker/umbrel-app.yml) is the app store manifest and
[`poketracker/docker-compose.yml`](poketracker/docker-compose.yml) is the Compose file Umbrel
actually runs, in the dialect [Umbrel's app store](https://github.com/getumbrel/umbrel-apps)
uses: Umbrel injects its own `app_proxy` container in front of the app, so the Compose file only
overrides that proxy's `APP_HOST`/`APP_PORT` and defines PokéTracker itself, writing data under
`${APP_DATA_DIR}`, Umbrel's per-app data directory. Both files were modelled on an existing
single-container Umbrel app (`syncthing`) in that repository, since PokéTracker has the same
shape: one image, one port, one data volume.

## Trying it before it's listed

Umbrel doesn't currently offer a "paste a Compose file" install path for end users the way some
other NAS UIs do — community apps normally arrive either pre-installed from an added community app
store, or via the official store once merged. To try PokéTracker on Umbrel ahead of time:

1. Add this repository as an [Umbrel Community App Store](https://github.com/getumbrel/umbrel-community-app-store)
   (Umbrel → App Store → ⋮ → **Community App Stores** → paste this repository's URL) — which also
   means the `poketracker/` folder here is structured to work as a community app store entry once
   that repository is public, not only as a draft for the official store.
2. Install PokéTracker from the community store page that appears.

## Submitting to the official Umbrel App Store

A manual step for the maintainer, later:

1. Fork [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps).
2. Add a `poketracker/` folder with these two files, plus gallery screenshots (`1.jpg`, `2.jpg`,
   `3.jpg` are referenced in the manifest but not included here — those need capturing from a
   real instance, not invented).
3. Open a pull request. Umbrel's own `README.md` and `CONTRIBUTING` in that repository describe
   their current review checklist; follow whatever that says at submission time rather than this
   note, since app store requirements do change.

## Caveats

- `category: files` is a reasonable guess based on similar self-hosted collection/tracking apps in
  the Umbrel store; the exact current category taxonomy isn't published as a flat list, so confirm
  it against `getumbrel/umbrel-apps`' other entries (or ask during PR review) before submitting.
- `umbrel-app.yml` omits `defaultUsername`/`defaultPassword`-style fields some Umbrel apps use for
  apps with a fixed default login — PokéTracker doesn't have one, it uses its own setup-token flow
  instead, so none of those fields apply here.
- As with every PokéTracker deployment: one instance only. Umbrel doesn't offer a way to scale an
  app's container count, so this isn't a risk here, but don't point a second manual Compose stack
  at the same `${APP_DATA_DIR}`.
