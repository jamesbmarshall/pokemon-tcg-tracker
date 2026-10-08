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

Supervisor only forwards user-entered `options` values to an add-on as environment variables when
the add-on supplies its own entrypoint script (`run.sh`) that reads `/data/options.json`, which in
turn requires the add-on to build its own image from a `Dockerfile` rather than reference a
published one with `image:`. Since this add-on intentionally uses `image:` to run PokéTracker
unmodified, there is no such script, so this add-on has no Options panel — configuration beyond
the fixed `environment:` block in `config.yaml` means forking this folder and editing it directly.
This is documented for end users in `DOCS.md` and was double-checked against several reports (both
official and community) before deciding not to implement a schema that would have looked
configurable without actually doing anything.

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
