# PokéTracker as a Home Assistant add-on

This folder is laid out as a Home Assistant add-on repository: [`repository.yaml`](repository.yaml)
describes the repository, and [`poketracker/`](poketracker/) is the add-on itself
([`config.yaml`](poketracker/config.yaml), [`DOCS.md`](poketracker/DOCS.md) shown to end users,
and this folder's own [`poketracker/README.md`](poketracker/README.md) for maintainers).

## Adding this as a repository, once it's published at a repository root

Home Assistant Supervisor requires `repository.yaml` at the **root** of whatever git repository
you add — it will not look inside a subfolder of a larger repository. Because
`pokemon-tcg-tracker` is a monorepo, this folder needs to be published as (or mirrored into) the
root of its own dedicated repository before anyone can add it directly; see
[`poketracker/README.md`](poketracker/README.md) for why, and what the maintainer needs to do
first.

Once that exists, in Home Assistant:

1. **Settings → Add-ons → Add-on Store**.
2. **⋮** (top right) → **Repositories**.
3. Paste the dedicated repository's URL and **Add**.
4. PokéTracker appears in the store list; click it, then **Install**.

A ready-made "add this repository" link can also be generated at
<https://my.home-assistant.io/create-link/> once the dedicated repository exists, for a one-click
version of the same steps.

## What's in here

- [`repository.yaml`](repository.yaml) — repository metadata (name, URL, maintainer).
- [`poketracker/config.yaml`](poketracker/config.yaml) — the add-on definition: references the
  published `ghcr.io/jamesbmarshall/pokemon-tcg-tracker` image, port 3000, and a fixed
  `environment:` block. Ingress is deliberately off — see the caveat in that file and in
  [`poketracker/DOCS.md`](poketracker/DOCS.md).
- [`poketracker/DOCS.md`](poketracker/DOCS.md) — shown on the add-on's own Documentation tab in
  Home Assistant once installed.
- [`poketracker/README.md`](poketracker/README.md) — maintainer-facing notes, including the
  Options-panel limitation and the repository-root caveat above.
