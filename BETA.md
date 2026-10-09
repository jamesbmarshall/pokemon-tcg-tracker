# Beta testing

PokéTracker's core (collection tracking, sets, binder view, sharing, self-updates) is
stable and well-tested, but it hasn't yet had outside users. This beta period is about
finding the rough edges before a wider release.

## What to expect

- **Things may change quickly.** Expect more frequent releases than normal, including
  fixes for issues found during the beta.
- **Database migrations are additive and backed up automatically** (nightly, plus one
  before every update), so upgrading between beta builds shouldn't lose data — but
  since this is unproven outside the maintainer's own instance, keep your own export
  (Settings → Export → JSON) handy, just in case.
- **Beta releases are tagged `vX.Y.Z-beta.N`** and are *not* offered through the normal
  auto-update feed (suffixed tags are treated as pre-releases, per the README's
  [Releasing](README.md#releasing) section) — so running a beta build is a deliberate
  choice, not something you'll be upgraded into by accident. To try one, deploy or
  redeploy pinned to that tag's release artifact rather than using the in-app updater.

## How to give feedback

- **Bugs**: open a [GitHub issue](https://github.com/jamesbmarshall/pokemon-tcg-tracker/issues/new/choose) — see [SUPPORT.md](SUPPORT.md) for what to include.
- **Everything else** (rough edges, confusing flows, feature ideas): use
  [GitHub Discussions](https://github.com/jamesbmarshall/pokemon-tcg-tracker/discussions).
- **Security issues**: always a private security advisory, never a public issue.

## When does beta end?

There's no fixed date. It ends when there's been enough real-world use across different
deploy methods (VPS/Docker, Azure, NAS) and upgrade paths with no major outstanding
bugs, and the maintainer is confident the signed self-update mechanism behaves
correctly across a run of beta-to-beta and beta-to-stable upgrades.
