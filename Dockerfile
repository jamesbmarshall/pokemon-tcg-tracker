# syntax=docker/dockerfile:1.7
# PokéTracker: one container with the launcher, the API server and the web app.
#
#   docker build -t poketracker .
#   docker run -d -p 3000:3000 -v poketracker-data:/data poketracker
#
# The image ships one release bundle (/app/bundle). In-app updates download newer signed bundles
# into /data/app/<version>, and the launcher runs, health-checks and, if needed, rolls them back.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
ENV CI=1 npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
# Manifests first so the npm ci layer is reused until a dependency actually changes.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/launcher/package.json apps/launcher/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG VERSION=""
ARG GIT_SHA=""
# Stage only: the image's own bundle needs no archive or signature, as the image is the trust root.
RUN npm run build \
 && GITHUB_SHA="$GIT_SHA" node scripts/make-bundle.mjs --stage-only ${VERSION:+--version "$VERSION"}

FROM node:${NODE_VERSION}-bookworm-slim
# The runtime stage has no node_modules: server.mjs is a self-contained esbuild bundle and the
# launcher has no dependencies.
ARG VERSION=""
LABEL org.opencontainers.image.title="PokéTracker" \
      org.opencontainers.image.description="Self-hosted Pokémon TCG collection tracker" \
      org.opencontainers.image.source="https://github.com/jamesbmarshall/pokemon-tcg-tracker" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    DATA_DIR=/data \
    BUNDLE_DIR=/app/bundle \
    PORT=3000 \
    UPDATE_PUBLIC_KEY_FILE=/app/update-public-key.pem
WORKDIR /app
COPY --from=build /src/apps/launcher/launcher.mjs /app/launcher.mjs
COPY --from=build /src/release/bundle /app/bundle
# The public key that in-app updates must be signed with. It lives in the image, not /data,
# so nothing that can write to the data volume can swap in its own key.
COPY deploy/update-public-key.pem /app/update-public-key.pem
# The launcher starts as root only long enough to hand /data to PUID:PGID (default 1000:1000,
# the "node" user) and then drops to that user for good. That makes host-folder bind mounts on
# NAS boxes just work. Starting the container with --user also works and skips this step.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
# start-period matches the launcher's default health timeout, so a slow first-boot migration
# isn't reported as unhealthy. fetch keeps this free of curl/wget, which the slim image lacks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/app/launcher.mjs"]
