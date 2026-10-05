# PokéTracker

A fast, good-looking Pokémon TCG collection tracker you host yourself. Tick off cards as you open packs, chase master sets down to the last reverse holo, flip through a virtual binder and watch what it's all worth. Run it on a VPS, in Azure or on your NAS, invite the rest of the household, and share collections with anyone you like.

Once it's deployed, everything happens in the browser. Prices, set lists and exchange rates refresh on their own in the background, and updates install from **Settings → System** with one click.

## Features

- **Dashboard**: collection value with a daily history chart, sets in progress, most valuable cards, recent additions and the sets you're closest to finishing.
- **Sets**: every set in every TCGdex language, grouped by series, with progress bars. Each set page shows three kinds of completion:
  - **Base**: numbered cards up to the printed total.
  - **Full**: base plus the secret rares.
  - **Master**: every printing, including reverse holos and other variants.
- **Fast entry**: each card shows its printings as chips (N, RH, H, 1st…). Click a chip to add a copy and right-click to remove one. Quick add mode adds a − button for touch screens. Anything you remove can be undone.
- **Binder view**: 9- or 12-pocket pages shown as a two-page spread. Empty pockets show a ghost of the missing card. Arrow keys turn the pages.
- **Card pages**: a 3D holo-tilt image, per-variant quantity and condition, market prices, the full card text and other printings of the same card. Arrow keys or a swipe move through the set.
- **Graded slabs**: grader, grade, cert number, what you paid and photos of the slab.
- **Wishlist**: your chase list with the running cost to buy it all. "Got it" moves a card into your collection.
- **Custom lists**: binders, trade piles, deck lists, whatever you need.
- **Search** by name, type, card type, rarity and illustrator, plus a command palette (`⌘K` or `/`).
- **GBP, EUR or USD**, converted at the daily ECB reference rate.
- **Multi-user**: an owner account, admins and members, invite links and optional two-factor sign-in.
- **Shared collections**: a household collection that several people can edit, alongside everyone's personal one.
- **Sharing**: share a whole collection, one set, your wishlist, your slabs or a list. Pick who sees it (anyone with the link, specific people, or everyone on your instance), hide what you paid, values or notes, and set an expiry. Links can be revoked at any time.
- **Your data stays yours**: export JSON or CSV at any time, and the server takes a database backup every day.

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

> **While this repository is private**, the container image and the update feed need a GitHub login, so the one-click options below won't work for anyone else yet. Making the repository public fixes both.

### A VPS with Docker

You need a Linux server with ports 80 and 443 open, and a domain (or subdomain) whose DNS already points at it. Then run:

```bash
curl -fsSL https://raw.githubusercontent.com/jamesbmarshall/pokemon-tcg-tracker/main/deploy/docker/install.sh | sh -s -- cards.example.com
```

The script installs Docker if it's missing, writes everything to `/opt/poketracker`, starts PokéTracker behind [Caddy](https://caddyserver.com) and prints your setup token. It's safe to run again; it never touches your data.

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

If you bind-mount a folder rather than using a volume, set `PUID` and `PGID` to the folder owner's ids. The container starts as root just long enough to hand the folder to that user, then runs as it. Plain `docker run --user` works too.

### Moving from the browser-only version

Earlier versions kept everything in your browser. To bring a collection across, open the old app, use **Settings → Export → JSON**, then sign in to the new one and use **Settings → Import**. Backups from versions that used the Pokémon TCG API are migrated as they import.

## Updates

The owner sees **Settings → System**, which shows the running version and, when there's a new release, its notes and an **Update** button. Clicking it:

1. downloads the release and checks its SHA-256 checksum and Ed25519 signature against the key baked into your image, so a tampered download is refused;
2. backs up the database;
3. restarts into the new version and waits for it to report healthy.

If the new version doesn't come up within 90 seconds, PokéTracker puts the previous version back, restores the backup and tells you what happened next time you open Settings. You can also turn on automatic updates there, or roll back to the previous version by hand.

Very occasionally a release needs a newer container image (the small launcher inside it changes). The Update button says so, and you redeploy instead: `docker compose pull && docker compose up -d` on a VPS, *Restart* in the Azure portal, or *Check for updates* in Unraid or Portainer.

## Backups

The server backs up its database every night to `/data/backups` and keeps the last seven (`BACKUPS_TO_KEEP`). Admins can download any of them from **Admin → Backups** (linked from Settings). Your own copies are still worth having: back up the whole `/data` volume with whatever you use for everything else, or take a JSON export now and then.

To restore, stop the container, copy a backup over `/data/poketracker.db`, delete any `poketracker.db-wal` and `poketracker.db-shm` files next to it, and start it again.

## Configuration

Everything has a sensible default. These are the settings you're most likely to touch:

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | (from the request) | The address people use, e.g. `https://cards.example.com`. Used for invite and share links and to check where requests come from. |
| `SETUP_TOKEN` | random, in the log | The first-run token for creating the owner account. |
| `TZ` | `UTC` | Time zone for scheduled jobs and logs. |
| `PUID` / `PGID` | `1000` | Who owns `/data` and runs the app. |
| `IMAGE_CACHE_MB` | `2048` | Disk space for cached card images. |
| `BACKUPS_TO_KEEP` | `7` | Nightly database backups to keep. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers from a reverse proxy. Use a hop count (`1` for one proxy, as the bundled Caddy and Azure deploys do) or the proxy's IP/CIDR. Avoid `true`: it lets clients pick their own IP and get round rate limits. |
| `SQLITE_JOURNAL_MODE` | `wal` | `delete` for network storage (Azure Files, SMB, NFS). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

## Security

- **Accounts**: passwords are hashed with Argon2id. Sign-in is rate-limited per IP and per account, and errors don't reveal whether a username exists. Two-factor sign-in uses any authenticator app, with single-use recovery codes. TOTP secrets are encrypted at rest with a per-instance key in `/data/secret.key`.
- **Roles**: the owner manages the instance and updates, admins manage people and invites, members look after their own collections. New people join through single-use invite links that expire.
- **Sessions** use `HttpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS). Every change is checked against the request's origin and a custom header to block cross-site request forgery.
- **Sharing**: share links contain a random 128-bit token stored only as a hash. Hidden fields are removed on the server before anything is sent, so they can't be dug out of the page. Share pages ask search engines not to index them.
- **Updates** must be signed by the release key, and the container runs as an unprivileged user.
- **Audit log**: sign-ins, admin changes, shares and updates are recorded, and admins can read them under **Admin → Activity**.

Found a problem? Please open a private security advisory on the repository rather than a public issue.

## Development

You need Node 24 (see `.nvmrc`).

```bash
npm install
npm run dev        # API on :3000, web app on http://localhost:5173
npm test           # every workspace
npm run lint
npm run typecheck
npm run build      # web app + bundled server
```

In development the server prints a setup token on first start, and data goes to `apps/server/data`.

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
scripts/      release bundling and signing
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
| Prices | TCGplayer (US) and Cardmarket (EU), both supplied by TCGdex |
| Currency conversion | [Frankfurter](https://frankfurter.dev) (ECB reference rates) |

The server fetches all of this, caches it and shares it between users, so TCGdex sees one request per card rather than one per person. Card images are cached on disk too, up to `IMAGE_CACHE_MB`. About 1,600 older cards, mostly promos, have no TCGdex scan; those fall back to the old pokemontcg.io image CDN, then to a styled placeholder.

Built with React 19, Vite, Tailwind CSS 4, TanStack Query, Zustand, Fastify and lucide icons.

Pokémon and all card images are © The Pokémon Company. This is a fan project, not affiliated with or endorsed by The Pokémon Company, Nintendo or Creatures.
