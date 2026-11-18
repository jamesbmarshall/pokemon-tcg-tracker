# Contributing

Thanks for your interest in PokéTracker. This is a small, self-hosted hobby project —
contributions are welcome, but please open an issue to discuss anything non-trivial
before sending a pull request, so you don't spend time on something that doesn't fit.

## Development setup

See [Development](README.md#development) for server configuration, frontend hot reload
requirements and Docker builds. To run the web app and API together:

```bash
npm ci
npm run build
WEB_DIR=../web/dist npm run dev -w @poketracker/server # http://localhost:3000
```

Use the setup token printed by the server to create your local owner account. To validate changes:

```bash
npm test           # every workspace
npm run lint
npm run typecheck
npm run validate:deploy
```

You need Node 24 and the npm 11 that ships with it (see `.nvmrc`; `nvm use` or `fnm use` picks
it up). `npm ci` stops with an "Unsupported engine" error on anything older. This is enforced
because npm 10 and npm 11 write `package-lock.json` differently, so mixing them rewrites the
lockfile on every install.

The lockfile works with any npm registry, including a managed feed or corporate mirror set in
your own `~/.npmrc`. It records integrity hashes but no download URLs, and the project `.npmrc`
tells npm to keep it that way. If CI reports registry URLs in the lockfile, run
`npm run lockfile:fix` and commit the result.

## Before opening a pull request

- Run `npm test`, `npm run lint` and `npm run typecheck` locally — CI runs the same
  checks and won't merge until they pass.
- If you touch `apps/server/src/migrations.ts`, read the
  [Database migrations](README.md#database-migrations) section first: migrations are
  append-only and must stay additive.
- If you touch `deploy/azure/*.bicep`, rebuild the generated JSON with
  `az bicep build -f deploy/azure/<file>.bicep` — CI checks this.
- Keep PRs focused. Small, reviewable changes get merged faster than large ones.

## Reporting bugs or proposing features

See [SUPPORT.md](SUPPORT.md) — bug reports and feature discussions go through GitHub
Issues/Discussions. Security issues go through a private security advisory instead.

## License

By contributing, you agree your contribution is licensed under the project's
[AGPL-3.0-or-later license](LICENSE).
