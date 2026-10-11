# PokéTracker on CasaOS

[`docker-compose.yml`](docker-compose.yml) is the same single container and `/data` volume as
[`../stack.yml`](../stack.yml), with the `x-casaos` metadata block CasaOS's App Store reads to
show an icon, title, category and port in its catalogue UI.

## Installing it yourself, before it's in the App Store

CasaOS → **App Store** → the **+** / "Install a customized app" option → paste the contents of
`docker-compose.yml`. Edit `SETUP_TOKEN`, `TZ`, `PUID`/`PGID` as you like, or leave them at their
defaults and read the setup token from the app's logs after it starts.

## Submitting to the CasaOS App Store

This is a step for the maintainer to do later, once the repository and image are public — don't
do this on the user's behalf:

1. Fork [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore).
2. Add a new folder under `Apps/` (e.g. `Apps/PokeTracker/`) containing a `docker-compose.yml`
   in this same format, plus an icon.
3. Open a pull request against that repository. CasaOS's own contribution guide in that repo
   covers the exact checks it runs; follow whatever it currently asks for rather than assuming
   this document is still accurate by then.

## Caveats

- Only English (`en_US`) text is filled in for the `x-casaos` description fields. Real AppStore
  listings localise these into many languages; that's a translation effort for whoever submits
  the listing, not something to invent here.
- `version: "latest"` tracks the `latest` image tag rather than a pinned version, matching how
  `stack.yml` and the Unraid template work. CasaOS AppStore submissions more commonly pin an
  exact version and bump it on each release — the maintainer should decide that policy at
  submission time.
