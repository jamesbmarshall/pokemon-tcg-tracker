#!/bin/sh
# One-line installer for a fresh Linux VPS:
#
#   curl -fsSL https://raw.githubusercontent.com/jamesbmarshall/pokemon-tcg-tracker/main/deploy/docker/install.sh | sh -s -- cards.example.com
#
# Installs Docker if it's missing, writes /opt/poketracker, and starts PokéTracker behind Caddy, which
# gets a Let's Encrypt certificate for the domain. Then it prints the first-run setup token.
# Safe to run again; it never touches your data.
set -eu

DOMAIN="${1:-${DOMAIN:-}}"
DIR="${POKETRACKER_DIR:-/opt/poketracker}"
RAW="https://raw.githubusercontent.com/jamesbmarshall/pokemon-tcg-tracker/${POKETRACKER_REF:-main}/deploy/docker"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "pass your domain, e.g. sh -s -- cards.example.com (its DNS must already point here)"
case "$DOMAIN" in *[!A-Za-z0-9.-]*|.*|*.) die "\"$DOMAIN\" doesn't look like a domain name" ;; esac

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "run as root or install sudo"
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose …)"

say "Writing $DIR"
$SUDO mkdir -p "$DIR"
for f in docker-compose.yml Caddyfile; do
  curl -fsSL "$RAW/$f" | $SUDO tee "$DIR/$f" >/dev/null
done
# Keep any existing .env (and its setup token), only updating the domain.
if [ -f "$DIR/.env" ]; then
  $SUDO sed -i.bak "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" "$DIR/.env"
else
  TOKEN="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'DOMAIN=%s\nSETUP_TOKEN=%s\n' "$DOMAIN" "$TOKEN" | $SUDO tee "$DIR/.env" >/dev/null
  $SUDO chmod 600 "$DIR/.env"
fi

say "Starting PokéTracker…"
cd "$DIR"
$SUDO docker compose pull --quiet
$SUDO docker compose up -d

printf 'Waiting for the app'
i=0
until $SUDO docker compose exec -T poketracker node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -lt 60 ] || { echo; die "the app didn't start; see: cd $DIR && docker compose logs"; }
  printf '.'; sleep 2
done
echo

TOKEN="$($SUDO sed -n 's/^SETUP_TOKEN=//p' "$DIR/.env")"
say "PokéTracker is running."
echo "Caddy is fetching a Let's Encrypt certificate for $DOMAIN (usually a few seconds; see: docker compose logs caddy)."
echo "Open https://$DOMAIN/setup and enter this setup token to create your owner account:"
echo
echo "    $TOKEN"
echo
echo "(The token only works until the owner account exists. Updates are done from Settings → System.)"
