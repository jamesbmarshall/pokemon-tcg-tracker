# PokéTracker Home Assistant add-on

[`config.yaml`](config.yaml) packages PokéTracker as a Home Assistant add-on, running the
published `ghcr.io/jamesbmarshall/pokemon-tcg-tracker` image directly (no local build). See
[`DOCS.md`](DOCS.md) for the end-user documentation Home Assistant shows on the add-on's own
**Documentation** tab — in particular, read the note there about why **Ingress is off and must
stay off**.

## Schema reference

Written against the current Home Assistant add-on configuration schema
(<https://developers.home-assistant.io/docs/apps/configuration>, "apps" being Home Assistant's
newer name for what used to be called "add-ons" — both terms are used interchangeably here and
in `config.yaml`'s comments, matching the current docs).

## Known limitation: no Options panel

The published PokéTracker image reads environment variables, not Supervisor's
`/data/options.json`. This packaging supplies no wrapper to translate options, so it
sets `schema: false` and has no Options panel. To change configuration beyond the
fixed `environment:` block in `config.yaml`, fork the packaging and edit that block.
Adding an Options panel would also require an image or entrypoint that reads those options.

## Trying this add-on before it's published

A Home Assistant add-on repository (the thing you paste a URL for in Supervisor's **Add-on Store**)
must have `repository.yaml` at the **root** of the git repository, not in a subfolder. Because this
project is a monorepo, `repository.yaml` lives at [`../repository.yaml`](../repository.yaml) —
one level up from this add-on folder — but that still isn't the root of the whole
`pokemon-tcg-tracker` repository, so **the main repository URL cannot be added directly in Home
Assistant today**. To actually install this add-on via Supervisor, the maintainer needs to publish
`deploy/home-assistant/` (this folder and its parent) as — or mirrored into — the root of its own
dedicated git repository first (e.g. with `git subtree split`), then share that repository's URL.
See [`../README.md`](../README.md) for the add-user steps once that exists.

In the meantime, anyone who wants to run this without Supervisor can still just use the plain
Docker image directly (see the project's main README) — this add-on packaging is purely for
Home Assistant users who'd rather manage it from Supervisor.
