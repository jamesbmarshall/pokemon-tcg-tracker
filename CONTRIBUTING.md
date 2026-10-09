# Contributing

Thanks for your interest in PokéTracker. This is a small, self-hosted hobby project —
contributions are welcome, but please open an issue to discuss anything non-trivial
before sending a pull request, so you don't spend time on something that doesn't fit.

## Development setup

See [Development](README.md#development) in the README for the full setup
(`npm install`, `npm run dev`, tests, lint, typecheck, Docker build). In short:

```bash
npm install
npm run dev        # API on :3000, web app on http://localhost:5173
npm test           # every workspace
npm run lint
npm run typecheck
```

You need Node 24 (see `.nvmrc`).

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
