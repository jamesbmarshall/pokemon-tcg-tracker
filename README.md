# PokéTracker

[![CI](https://github.com/jamesbmarshall/pokemon-tcg-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/jamesbmarshall/pokemon-tcg-tracker/actions/workflows/ci.yml)
[![Image on GHCR](https://img.shields.io/badge/ghcr.io-pokemon--tcg--tracker-2496ED?logo=docker&logoColor=white)](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pkgs/container/pokemon-tcg-tracker)

A fast, good-looking Pokémon TCG collection tracker you host yourself. Tick off cards as you open packs, chase master sets down to the last reverse holo, flip through a virtual binder and watch what it's all worth. Run it on a VPS, in Azure or on your NAS, invite the rest of the household, and share collections with anyone you like.

Once it's deployed, everything happens in the browser. Prices, set lists and exchange rates refresh on their own in the background, and updates install from **Settings → System** with one click.

> **Beta**: PokéTracker is looking for outside testers. See [BETA.md](BETA.md) for what
> to expect and how to report issues.

If you've enjoyed PokéTracker, you can support its development on Ko-fi:
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jamesbmarshall)

## Quick start in 2 minutes

```bash
docker run -d --name poketracker -p 3000:3000 -v poketracker-data:/data ghcr.io/jamesbmarshall/pokemon-tcg-tracker:latest
docker logs poketracker      # prints your one-time setup token
```

Then open `http://localhost:3000`, enter the setup token and you're in. Prefer Compose? [`deploy/docker/docker-compose.local.yml`](deploy/docker/docker-compose.local.yml) does the same thing with a `.env` file to edit instead of flags.

Running a NAS or home server instead? These deployment templates are available; the linked guides explain installation and any packaging prerequisites:

| Box | Template |
| --- | --- |
| Unraid | [`deploy/nas/unraid-poketracker.xml`](deploy/nas/unraid-poketracker.xml) ([Community Applications guide](deploy/nas/README.md#unraid)) |
| TrueNAS SCALE 24.10+ | [`deploy/nas/truenas/`](deploy/nas/truenas/) |
| CasaOS | [`deploy/nas/casaos/`](deploy/nas/casaos/) |
| Umbrel | [`deploy/umbrel/`](deploy/umbrel/) |
| Home Assistant add-on | [`deploy/home-assistant/`](deploy/home-assistant/) |
| Synology Container Manager, Portainer and anything else that runs Compose | [`deploy/nas/stack.yml`](deploy/nas/stack.yml) |

See [Deploy](#deploy) below for Azure and a bare VPS, or [`deploy/nas/README.md`](deploy/nas/README.md) for details on each NAS option.

## Features

- **Dashboard**: collection value with a daily history chart, biggest movers over the last 7 or 30 days, sets in progress, most valuable cards, recent additions and the sets you're closest to finishing.
- **Sets**: physical-card sets in the supported TCGdex languages, grouped by series, with progress bars. Each set page shows four completion measures:
  - **Base**: numbered cards up to the printed total.
  - **Full**: base plus the secret rares.
  - **Master**: standard expansion printings, including applicable reverse holos.
  - **All printings**: every catalogued printing, including product exclusives, stamps and oversized cards.
  Printings classified as additional or unresolved remain collectible but do not satisfy Base, Full or Master completion. Checklist membership is assessed separately from release origin, using TCGdex data; provisional coverage is labelled. See [printing catalogue rules and migration](docs/printings.md).
- **Fast entry**: each card shows its printings as chips (N, RH, H, 1st…). Click a chip to add a copy and right-click to remove one. Quick add mode adds a − button for touch screens. Anything you remove can be undone.
- **Binder view**: 9- or 12-pocket pages shown as a two-page spread. Empty pockets show a ghost of the missing card. Arrow keys turn the pages.
- **Card pages**: a 3D holo-tilt image, per-variant quantity and condition, market prices with a daily price history chart per source, the full card text and other printings of the same card. Arrow keys or a swipe move through the set.
- **Manual valuations**: set your own value for a card or graded slab when you'd rather trust your own judgement than the market price. Manually valued copies are marked with a "Manual" badge everywhere their value is shown.
- **Graded slabs**: grader, grade, cert number, what you paid and photos of the slab. With a PriceCharting API key configured, link a slab to its product and its graded price is used instead of the raw market price.
- **Sealed product**: booster boxes, ETBs and the like, with photos, what you paid and an optional PriceCharting link for a live price. Unopened items count towards your collection value and daily history; mark one opened to move it into a history section (with an optional jump to the set page to log what you pulled).
- **Wishlist**: your chase list with the running cost to buy it all. "Got it" moves a card into your collection.
- **Custom lists**: binders, trade piles, whatever you need.
- **Decks**: build a 60-card deck, grouped into Pokémon/Trainer/Energy with quantity steppers, a live legality check (Standard, Expanded or Unlimited) with the issues spelled out, and owned-vs-needed counts across every printing of each card. Paste a PTCGL or Limitless decklist to import it, or copy your deck back out as text, and add whatever you're missing straight to your wishlist.
- **Search** by name, type, card type, rarity and illustrator, plus a command palette (`⌘K` or `/`).
- **GBP, EUR or USD**, converted at the daily ECB reference rate.
- **Multi-user**: an owner account, admins and members, invite links and optional two-factor sign-in.
- **Shared collections**: a household collection that several people can edit, alongside everyone's personal one.
- **Sharing**: share a whole collection, one set, your wishlist, your slabs, sealed products or a list. Pick who sees it (anyone with the link, specific people, or everyone on your instance), hide what you paid, values or notes, and set an expiry. Links can be revoked at any time.
- **Your data stays yours**: export JSON or CSV at any time, and the server takes a database backup every day.
- **Installable**: add PokéTracker to your home screen or app list as a PWA. The app shell and previously loaded card images are cached; signing in, loading collections and saving changes require a connection to your server.
- **Scan a card**: point your camera at a card's bottom strip and on-device OCR reads the collector number to look it up — no photo ever leaves your device. Needs HTTPS, since browsers only allow camera access on a secure connection (`localhost` is exempt for local testing). A manual set code/number entry always works too.

## Deploy

PokéTracker is one container with a `/data` volume. Pick whichever home suits you.

| Where | Best for | HTTPS |
| --- | --- | --- |
| [VPS with Docker](#a-vps-with-docker) | A cheap Linux server with your own domain | Let's Encrypt, automatic |
| [Azure Container Apps](#azure) | Hands-off hosting in Azure | Built in |
| [Azure App Service](#azure) | Azure, on a fixed monthly price | Built in |
| [Unraid, Synology, Portainer](#nas-and-home-servers) | A box you already run at home | Your reverse proxy, if you want it |

Whichever you choose, the first visit asks for a **setup token** before it will create the owner account. That stops a stranger who finds your new instance before you do from claiming it. You can choose the token yourself at deploy time (`SETUP_TOKEN`), or leave it blank and read a random one from the container log:

```
Open https://cards.example.com/setup and enter this setup token:

    Kdj7MuopHWLABs-WJWEZGgr-
```

### A VPS with Docker

You need a Linux server with ports 80 and 443 open, and a domain (or subdomain) whose DNS already points at it. Then run:

```bash
curl -fsSL https://raw.githubusercontent.com/jamesbmarshall/pokemon-tcg-tracker/main/deploy/docker/install.sh | sh -s -- cards.example.com
```

The script installs Docker if it's missing, writes the deployment files to `/opt/poketracker`, starts PokéTracker behind [Caddy](https://caddyserver.com) and prints your setup token. Running it again replaces `docker-compose.yml` and `Caddyfile`, updates `DOMAIN` in `.env`, and pulls the configured image. Save any edits to those files first; the data volume is preserved.

Caddy gets a free [Let's Encrypt](https://letsencrypt.org) certificate for your domain on first start and renews it on its own, so there's nothing to schedule. If you're experimenting and might rebuild the server a few times, point it at Let's Encrypt's staging service first, so you don't hit their [rate limits](https://letsencrypt.org/docs/rate-limits/):

```bash
echo 'ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory' >> /opt/poketracker/.env
cd /opt/poketracker && docker compose up -d
```

Browsers will warn about the staging certificate. Remove that line and run `docker compose up -d` again when you're happy, and Caddy swaps in a real one.

Prefer to do it by hand? Copy [`deploy/docker/docker-compose.yml`](deploy/docker/docker-compose.yml) and [`Caddyfile`](deploy/docker/Caddyfile) to the server, create a `.env` with `DOMAIN=cards.example.com`, and run `docker compose up -d`.

**No domain, or already have a reverse proxy?** [`docker-compose.local.yml`](deploy/docker/docker-compose.local.yml) runs plain HTTP on port 3000, which is fine on a home network or behind Nginx Proxy Manager, Traefik or a Cloudflare Tunnel. Set `PUBLIC_URL` to the address people actually use so invite and share links point at it.

### Azure

[![Deploy to Azure Container Apps](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fjamesbmarshall%2Fpokemon-tcg-tracker%2Fmain%2Fdeploy%2Fazure%2Fcontainerapps.json)
&nbsp; **Container Apps**: about the cheapest way to run it in Azure. Data lives on an Azure Files share.

[![Deploy to Azure App Service](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fjamesbmarshall%2Fpokemon-tcg-tracker%2Fmain%2Fdeploy%2Fazure%2Fappservice.json)
&nbsp; **App Service**: a B1 plan, a fixed monthly price, data on App Service's persistent storage.

Both ask for an app name and a setup token, and print the web address when they finish. Open it, enter the token and you're in. Azure handles HTTPS for the `azurecontainerapps.io` or `azurewebsites.net` address, and you can add your own domain in the portal later (set `PUBLIC_URL` to match).

From the command line instead:

```bash
az group create -n poketracker -l uksouth
az deployment group create -g poketracker -f deploy/azure/containerapps.bicep -p setupToken='choose-a-long-phrase'
```

Both templates pin PokéTracker to **one instance**. Don't scale it out: SQLite allows a single writer, and the background jobs and updater assume they're the only copy running. Because Azure's storage is a network share, the templates also switch SQLite from WAL to rollback-journal mode (`SQLITE_JOURNAL_MODE=delete`), which behaves itself on SMB.

### NAS and home servers

**Unraid**: add [`deploy/nas/unraid-poketracker.xml`](deploy/nas/unraid-poketracker.xml) as a template (*Docker → Add Container → Template*). Data goes to `/mnt/user/appdata/poketracker`, owned by `nobody:users` like your other apps.

**Synology Container Manager, Portainer, CasaOS**: create a project or stack from [`deploy/nas/stack.yml`](deploy/nas/stack.yml).

Then open `http://<nas-ip>:3000`. To reach it securely from outside your home network, put it behind your NAS's reverse proxy and set `PUBLIC_URL`.

If you bind-mount a folder rather than using a volume, set `PUID` and `PGID` to the folder owner's ids. The launcher tries to give that user ownership of `/data`, then drops privileges. If the folder remains unwritable by that user, it logs a warning and continues as root. Plain `docker run --user` skips that ownership step; the folder must already be writable by the selected user.

### Moving from the browser-only version

Earlier versions kept everything in your browser. To bring a collection across, open the old app, use **Settings → Export → JSON**, then sign in to the new one and use **Settings → Import**. Backups from versions that used the Pokémon TCG API are migrated as they import.

## Updates

The owner sees **Settings → System**, which shows the running version and, when there's a new release, its notes and an **Update** button. Clicking it:

1. downloads the release and checks its SHA-256 checksum and Ed25519 signature against the key baked into your image, so a tampered download is refused;
2. backs up the database;
3. restarts into the new version and waits for it to report healthy.

If the new version doesn't come up within 90 seconds, PokéTracker puts the previous version back, restores the backup and tells you what happened next time you open Settings. You can also turn on automatic updates there, or roll back to the previous version by hand.

Very occasionally a release needs a newer container image (the small launcher inside it changes). The Update button says so; pull and recreate the container with your deployment tool (`docker compose pull && docker compose up -d` for Compose). On Azure, redeploy with the newer image tag. Restarting a container alone does not guarantee an image refresh.

## Backups

With background jobs enabled, the server backs up its database at 03:00 in the server's time zone to `/data/backups` and keeps the last seven daily backups (`BACKUPS_TO_KEEP`), plus the latest three pre-update backups. Manual backups remain until deleted. The owner can create and download backups from **Admin → Backups** (linked from Settings).

Database backups contain photo metadata, but the image files live separately in `/data/photos` and `/data/sealed-photos`. Back up the whole `/data` volume for a full recovery, including `/data/secret.key`, which decrypts two-factor secrets, saved share links and integration keys. If you supply `SECRET_KEY` through the environment, preserve that value separately. JSON exports are useful for moving a collection, but do not include photo files or instance accounts and settings.

To restore, stop the container, copy a backup over `/data/poketracker.db`, delete any `poketracker.db-wal` and `poketracker.db-shm` files next to it, and start it again.

## Configuration

The variables below are **server environment variables**, read at startup. Where you edit them depends on how you run PokéTracker; there is no shared config file that every deployment reads.

### Where to edit settings

| How you run it | Where to edit | Apply the change |
| --- | --- | --- |
| **Azure Container Apps** | Open your **Container App** resource → **Revisions and replicas → Create new revision**. Edit the `poketracker` container's **Environment variables**. Add names such as `DEMO_MODE` with value `1`. These belong to the app's container, not the shared Container Apps Environment resource. | Save and deploy the new revision. Keep one active revision/replica using the data volume. See [Azure's environment-variable guide](https://learn.microsoft.com/azure/container-apps/environment-variables). |
| **Azure App Service** | Open your **App Service** resource → **Settings → Environment variables → App settings**. Add or edit the variable name and value. | Apply the changes; App Service restarts the app. See [Azure's app-settings guide](https://learn.microsoft.com/azure/app-service/configure-common?tabs=portal). |
| **Docker Compose / VPS installer** | Edit the `poketracker` service's `environment:` block in your Compose file. With the VPS installer, this is `/opt/poketracker/docker-compose.yml`. A `.env` beside the Compose file supplies only variables referenced by that file; see the example below. | Run `docker compose up -d` from that directory (include `-f docker-compose.local.yml` if using that file). Compose recreates the container when its environment changes; `docker compose restart` alone does not apply new values. |
| **Plain `docker run`** | Pass `-e NAME=value` flags or `--env-file /path/to/poketracker.env` when creating the container. The file contains one `NAME=value` per line. | Recreate the container with the same data volume and the updated flags/file. |
| **Local source development** | Create `apps/server/.env`, with one `NAME=value` per line. The server's `npm run dev` script loads this file automatically. Variables already set in the shell take precedence. | Stop and restart the dev command after editing the file. |

**On Azure, use Azure's environment settings; you do not need to upload a `.env` file.** The Bicep templates supply initial values. If you manage deployments through Bicep, also keep your custom settings in the template (`env` in Container Apps, `siteConfig.appSettings` in App Service) so later deployments preserve them.

For Compose, adding a name to `.env` alone does **not** pass it into the container. For example, to make demo mode configurable from `.env`, add this line alongside the existing variables under `services.poketracker.environment`:

```yaml
      DEMO_MODE: ${DEMO_MODE:-0}
```

Then put `DEMO_MODE=1` in the `.env` next to that Compose file and run `docker compose up -d`. The supplied Compose templates do not currently include this mapping. Alternatively, set `DEMO_MODE: "1"` directly in the service's `environment:` block.

A local development file might look like this:

```dotenv
# apps/server/.env (loaded by npm run dev -w @poketracker/server)
WEB_DIR=../web/dist
JOBS=false
DEMO_MODE=0
```

The production container and `npm start` do not automatically load a `.env` file. Supply environment variables through the host/container runtime, or explicitly load a file with Node's `--env-file` option when running the standalone server. Keep files containing secrets out of version control.

### Available settings

These are the settings you're most likely to touch:

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | (from the request) | The address people use, e.g. `https://cards.example.com`. Used for invite and share links and to check where requests come from. |
| `SETUP_TOKEN` | random, in the log | The first-run token for creating the owner account. |
| `PORT` | `3000` | HTTP port inside the server process. With the supplied containers, normally change the published host port instead. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Database, photos, cache, backups and downloaded updates. Relative paths use the server's working directory. |
| `WEB_DIR` | unset (launcher supplies it) | Built web app to serve. Without it, the standalone server serves only the API. |
| `SECRET_KEY` | generated in `DATA_DIR/secret.key` | Optional base64-encoded 32-byte encryption key. Keep it stable and include it in your recovery plan. |
| `TZ` | `UTC` | Time zone for scheduled jobs and logs. |
| `PUID` / `PGID` | `1000` | Who owns `/data` and runs the app. |
| `IMAGE_CACHE_MB` | `2048` | Disk space for cached card images. |
| `BACKUPS_TO_KEEP` | `7` | Nightly database backups to keep. |
| `PRICE_HISTORY_DAYS` | `730` | How many days of daily per-card price history to keep before the cleanup job prunes older rows. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers from a reverse proxy. Use a hop count (`1` for one proxy, as the bundled Caddy and Azure deploys do) or the proxy's IP/CIDR. Avoid `true`: it lets clients pick their own IP and get round rate limits. |
| `SQLITE_JOURNAL_MODE` | `wal` | `delete` for network storage (Azure Files, SMB, NFS). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `JOBS` | `true` | Enables scheduled refreshes, backups and cleanup. Set `false` for isolated development or tests. |
| `DEMO_MODE` | `false` | Seeds a sample collection with one-click read-only sign-in. Allows catalogue-cache writes, blocks collection edits, sign-up and updates, and resets nightly when jobs are enabled. See [Demo mode](#demo-mode). |

## Demo mode

Set the **server environment variable** `DEMO_MODE` to `1` to run a public, read-only showcase instead of your own tracker. On Azure, add it to the Container App's container environment variables or the App Service's app settings. For Compose, add it to the service's `environment:` block (or wire it to `.env` as shown under [Where to edit settings](#where-to-edit-settings)). For local development, put `DEMO_MODE=1` in `apps/server/.env`. Apply the change by restarting/redeploying as described above. Set it to `0` or remove it to disable demo mode; this does not delete the seeded demo account or its data.

Use a **separate instance and data volume/directory** for a demo, with `JOBS=true` (the default) if you want nightly resets. Demo mode is intended for a public "try before you self-host it" link, not everyday collection management.

On first boot the server seeds a sample member account with several hundred cards across four sets — some owned, some graded, a wishlist, a couple of custom lists and a short value history — from [`apps/server/src/demo/seed.ts`](apps/server/src/demo/seed.ts). The login page shows a **Try the demo** button, which signs the visitor straight in as that account.

From there, almost everything is read-only. A single server-side check rejects every mutating request with a 403 and a clear message, except demo sign-in/out and the shared card-data cache (TCGdex lookups, image hydration) that the UI needs to render anything at all. Sign-up, invites, password and two-factor changes, share creation, the updater and admin settings are all disabled outright, and the web app shows a dismissible banner reminding visitors they're looking at a demo. Price and set-data refresh jobs keep running as normal; only the update checker is skipped. A nightly job wipes and re-seeds the collection, so nothing anyone does to it (not that they can do much) sticks around.

`deploy/azure/demo.bicep` deploys a standalone demo instance on Azure Container Apps; see the comments in that file for the `az deployment group create` command. Use a dedicated data directory for demos: collection edits are blocked, and the demo account's collections are rebuilt nightly when jobs are enabled.

### PriceCharting (optional)

Sealed-product pricing and graded-card values can optionally come from [PriceCharting](https://www.pricecharting.com), a paid third-party service. It's entirely opt-in: set a key under **Admin → Integrations** (owner or admin only) to enable it, or leave it unset. With no key configured, nothing in PokéTracker ever contacts PriceCharting — the search box and linking controls simply don't appear. The key is encrypted at rest and never sent back to the browser once saved; **Admin → Integrations** only ever shows whether a key is "Configured", plus a "Test connection" button.

## Resilience

Set lists refresh every six hours. A persistent queue imports full printing catalogues every 15 minutes, up to eight due sets per run; opening a set can also refresh it on demand. Recent sets are queued daily and older sets weekly. The first import can take time because it fetches every card's detailed record. **Admin → Jobs** shows refresh outcomes; [Printing catalogue](docs/printings.md#automatic-lifecycle) explains coverage and retry behaviour.

TCGdex is the only catalogue source, so PokéTracker is built to cope when it's slow or unreachable rather than break pages. Every call retries network errors, 5xx and 429 responses with exponential backoff and jitter (honouring a 429's `Retry-After` header), capped at a few seconds and a handful of attempts; a plain 4xx (e.g. a genuine 404) is never retried. If TCGdex keeps failing, a per-host circuit breaker opens after several failures in a row, so the app stops hammering a service that's already down — it tries again with a single "probe" request after a cool-down, and closes again once that succeeds.

Whether the breaker is open or a single call fails, PokéTracker falls back to whatever it already has rather than erroring: a stale cached catalogue response past its normal refresh window, or the last synced card/set-stats snapshot. Pages still show set lists, card details and collection stats — card data just "may be out of date" until TCGdex recovers. A small, non-sensitive flag on the status endpoint drives a banner for every signed-in user when this is happening; **Admin → Jobs** shows the fuller picture (breaker state, last error, how many requests were served stale) for TCGdex and PriceCharting.

For legacy card data without physical printing records, a configured PriceCharting key can supply a missing variant price after TCGplayer and converted Cardmarket. Detailed printing records do not use this generic ungraded fallback, because it cannot identify a particular treatment. A manual value override takes precedence. The card page identifies PriceCharting when a fallback price was used.

## Security

- **Accounts**: passwords are hashed with Argon2id. Sign-in is rate-limited per IP and per account, and errors don't reveal whether a username exists. Two-factor sign-in uses any authenticator app, with single-use recovery codes. TOTP secrets are encrypted at rest with a per-instance key in `/data/secret.key`.
- **Roles**: the owner manages the instance and updates, admins manage people and invites, members look after their own collections. New people join through single-use invite links that expire.
- **Sessions** use `HttpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS). Every change is checked against the request's origin and a custom header to block cross-site request forgery.
- **Sharing**: share links contain a random 128-bit token. The server stores its hash for lookup and an encrypted copy so the owner can copy the link again. Hidden fields are removed on the server before anything is sent. Share pages ask search engines not to index them.
- **Updates** must be signed by the release key. The launcher normally drops to an unprivileged user; see the storage-permissions fallback under [NAS and home servers](#nas-and-home-servers).
- **Audit log**: sign-ins, admin changes, shares and updates are recorded, and admins can read them under **Admin → Activity**.
- **PriceCharting**: the optional API key is encrypted at rest with the same per-instance key as TOTP secrets, is never returned to the browser, and the service is contacted only when a key is set.

Found a problem? Please open a private security advisory on the repository rather than a public issue.

## Development

You need Node 24 (see `.nvmrc`). Run these commands from the repository root to serve the built web app and API together:

```bash
npm ci
npm run build      # web app + bundled server
WEB_DIR=../web/dist npm run dev -w @poketracker/server
```

Open `http://localhost:3000/setup` and use the token printed by the server. Data goes to `apps/server/data`. The API restarts on server edits; after web changes, rebuild with `npm run build -w @poketracker/web` and reload. Set `JOBS=false` if you want to disable background work locally. Optional server environment settings can go in `apps/server/.env`.

For frontend hot reload, `npm run dev` starts the API on port 3000 and Vite on port 5173. Vite currently has no API proxy configured: a same-origin reverse proxy must send `/api/*` and `/health` to port 3000 and other requests (including Vite's WebSocket) to port 5173. Opening port 5173 directly will not connect the UI to the API.

Validation commands:

```bash
npm test           # every workspace
npm run lint
npm run typecheck
npm run build      # web app + bundled server
npm run validate:deploy
```

To build and run the Docker image locally:

```bash
docker build -t poketracker .
docker run -d --name poketracker -p 3000:3000 -v poketracker-data:/data poketracker
docker logs poketracker      # shows the setup token
```

If your machine uses a company npm mirror and can't reach registry.npmjs.org, the build inside Docker won't see your npm settings. Pass the mirror in:

```bash
docker build --build-arg NPM_REGISTRY="$(npm config get registry)" -t poketracker .
```

If the mirror needs a login, add `--secret id=npmrc,src=$HOME/.npmrc` as well. The file is only mounted for `npm ci` and never stored in the image.

### Project layout

```
apps/
  web/        React SPA: pages, components, stores, API client
  server/     Fastify API, SQLite (node:sqlite), background jobs, updater, image cache
  launcher/   tiny supervisor in the image: runs, health-checks and rolls back versions
packages/
  shared/     types and card logic shared by web and server, TCGdex adapter
deploy/       Docker Compose + Caddy, Azure Bicep, Unraid and NAS templates
scripts/      release bundling/signing, deployment validation, read-only printing audit
docs/         printing standard, catalogue lifecycle and migration notes
```

The server has no native dependencies: SQLite is Node's built-in `node:sqlite`, Argon2 runs in WebAssembly and signatures use Node's `crypto`. A release is therefore one JavaScript file plus the built web app, and the same bundle runs on amd64 and arm64.

### Database migrations

Migrations live in `apps/server/src/migrations.ts` and are append-only: never edit one that has shipped. Keep them **additive** (new tables, new nullable columns), because a manual rollback runs the previous version against the newer database. If a change can't be additive, ship it in two releases: first stop using the old shape, then remove it.

### Releasing

One-off setup:

1. `node scripts/gen-update-key.mjs ~/poketracker-update-key.pem` writes the public key to `deploy/update-public-key.pem` (commit it) and the private key to the path you give.
2. In **Settings → Environments**, create an environment called `release`. Under deployment branches and tags, allow only tags matching `v*`. If your plan allows it, add yourself as a required reviewer.
3. Add the private key as an **environment** secret called `UPDATE_SIGNING_KEY` in `release`, not as a repository secret. Then delete the local copy or keep it somewhere safe offline. Anyone holding it can push updates to every instance.
4. Protect `main` (require pull requests) and add a tag ruleset so only you can create `v*` tags. The workflow refuses to sign a tag that isn't on `main`, so these rules decide who can ship code.

To release, push a tag:

```bash
git tag v2.1.0 && git push origin v2.1.0
```

The [release workflow](.github/workflows/release.yml) tests everything, builds and signs the bundle, publishes a multi-arch image to GHCR and creates the GitHub release. Tags with a suffix (`v2.1.0-beta.1`) become pre-releases, which instances don't offer as updates.

If you change `deploy/azure/*.bicep`, rebuild the JSON the Deploy buttons use with `az bicep build -f deploy/azure/<file>.bicep`. CI fails if you forget.

## Data sources

| What | Source |
| --- | --- |
| Cards, sets, images | [TCGdex](https://tcgdex.dev) (free, open source, no key) |
| Prices | TCGplayer (US) and Cardmarket (EU), supplied by TCGdex; optional [PriceCharting](https://www.pricecharting.com) links for sealed/graded prices and a generic fallback for legacy cards without printing records |
| Currency conversion | [Frankfurter](https://frankfurter.dev) (ECB reference rates) |

The server fetches this data and shares cached responses between users. Card images are cached on disk too, up to `IMAGE_CACHE_MB`. Missing or failed scans fall back to the old pokemontcg.io image CDN where a legacy set mapping exists, then to a styled placeholder.

Built with React 19, Vite, Tailwind CSS 4, TanStack Query, Zustand, Fastify and lucide icons.

## Support, privacy and license

- **Support**: see [SUPPORT.md](SUPPORT.md) for bug reports, security advisories and
  where to ask questions. Beta testers, see [BETA.md](BETA.md) first.
- **Privacy**: see [PRIVACY.md](PRIVACY.md) for what the software stores and sends
  elsewhere, and what it doesn't.
- **Contributing**: see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Release notes**: see [GitHub Releases](https://github.com/jamesbmarshall/pokemon-tcg-tracker/releases)
  for the changelog; each tagged release's notes are the source of truth.
- **License**: [AGPL-3.0-or-later](LICENSE). In short: you can self-host, modify and
  share PokéTracker freely, but if you run a modified version on a server other people
  use, you must also offer them its source.

Pokémon and all card images are © The Pokémon Company. This is a fan project, not affiliated with or endorsed by The Pokémon Company, Nintendo or Creatures.
