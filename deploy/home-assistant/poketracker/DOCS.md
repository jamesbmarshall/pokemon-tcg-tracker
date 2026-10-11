# PokéTracker

Self-hosted Pokémon TCG collection tracker. Track sets, variants, graded slabs and wishlists,
with prices refreshed automatically in the background. Invite other household members and share
collections with read-only links.

## First run

Open the Web UI (the link on this add-on's **Info** tab), which asks for a **setup token** before
it lets you create the owner account. Read the token from this add-on's **Log** tab — look for a
line like:

```
Open https://cards.example.com/setup and enter this setup token:

    Kdj7MuopHWLABs-WJWEZGgr-
```

## ⚠️ Do not enable Ingress

This add-on has **Ingress off on purpose** and does not support turning it on. PokéTracker is a
single-page web app whose built files are served from fixed, absolute paths (`/assets/...`), and
the server assumes it owns its whole address for cookies, CSRF checks and the links it generates
for invites and shares. Home Assistant's Ingress rewrites every request onto a per-session sub-path
(`/api/hassio_ingress/<token>/...`), which breaks all of that — expect a blank page or broken
asset loading if you try it anyway. Use the add-on's own port (shown above, and on the **Network**
tab) instead.

## Configuration

This add-on runs the published `ghcr.io/jamesbmarshall/pokemon-tcg-tracker` image directly rather
than building its own, so it has **no Options panel** — Supervisor can only hand user-configured
options to an add-on's own entrypoint script, which only exists when Supervisor builds the image
itself from a `Dockerfile`. Everything PokéTracker needs is instead set as fixed values in
`config.yaml`'s `environment:` block:

| Variable | Default here | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | (blank — uses the request's own address) | Set this if you put PokéTracker behind another reverse proxy, e.g. `https://cards.example.com`. |
| `TZ` | `UTC` | Time zone for scheduled jobs and logs. |
| `TRUST_PROXY` | `false` | Only needed if you also put another reverse proxy in front of this add-on. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `DEMO_MODE` | `0` | Optional. Enables a read-only public demo that resets nightly. **Do not use this for your own collection** — leave it at `0`/unset for a normal instance. |

To change any of these, fork this add-on folder, edit the `environment:` values in `config.yaml`,
and add your fork as a repository instead (see this folder's `README.md`). If you want to set
different values per instance without editing YAML, use one of PokéTracker's other deployment
options (Docker Compose, Unraid, TrueNAS, a VPS) instead — see the project's main README.

`SETUP_TOKEN` is deliberately not configurable here: leave it unset and read the randomly
generated one from the Log tab on first start, as described above.

## Backups

The add-on's persistent storage (`/data`) holds the database, nightly backups, cached card images
and installed updates, and is included in Home Assistant's normal add-on backups. PokéTracker also
keeps its own last-seven database backups under `/data/backups` regardless.

## Updates

PokéTracker updates itself from **Settings → System** inside the app — that's how new app releases
arrive, independent of this add-on's own version. Only update this add-on itself (via Supervisor)
when a new container image tag is needed, which the in-app updater will tell you if it happens.

## Support

Open an issue at <https://github.com/jamesbmarshall/pokemon-tcg-tracker/issues>.
