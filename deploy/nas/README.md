# PokéTracker on NAS boxes and home servers

| Box | Template |
| --- | --- |
| Unraid | [`unraid-poketracker.xml`](unraid-poketracker.xml) |
| Synology Container Manager, Portainer, CasaOS (generic) | [`stack.yml`](stack.yml) |
| TrueNAS SCALE 24.10+ | [`truenas/`](truenas/) |
| CasaOS (AppStore-flavoured, with `x-casaos` metadata) | [`casaos/`](casaos/) |

All of them run the same single container on port 3000 with one `/data` volume. See the root
[README's Configuration table](../../README.md#configuration) for every environment variable.

## Unraid

Add [`unraid-poketracker.xml`](unraid-poketracker.xml) as a template: *Docker → Add Container →
Template*. Data goes to `/mnt/user/appdata/poketracker`, owned by `nobody:users` (99:100) like
your other apps.

### Using it before it's listed in Community Applications

Either:

- **Docker tab → Add Container → Template**, paste the template's raw GitHub URL
  (`https://raw.githubusercontent.com/jamesbmarshall/pokemon-tcg-tracker/main/deploy/nas/unraid-poketracker.xml`)
  directly into the template field, or
- Save the file to `/boot/config/plugins/dockerMan/templates-user/my-PokeTracker.xml` over SSH or
  the NAS's file share, then it appears under *Add Container → Template* without any URL at all.

Both skip Community Applications entirely, so they work the moment the repository (and so the
container image) is public.

### Submitting to Community Applications

This is a manual step for the maintainer, done once the project is ready to be listed publicly.
As of the current [CA submission docs](https://ca.unraid.net/submit/help/repository-xml), the
process is:

1. Host the template XML in a public GitHub repository (this one already qualifies) — CA reads
   templates directly from repositories, there's no separate "fork Unraid's templates" step for
   third-party apps.
2. Go to [ca.unraid.net/submit/new](https://ca.unraid.net/submit/new), sign in and register the
   repository. CA's scanner finds every `*.xml` template in it.
3. Run **Validate** and then **Scan** on the submission for `unraid-poketracker.xml` and fix
   anything it flags — in particular, confirm the `<Category>` value against the live
   `CategoryList` the scanner normalises it into (the exact valid set isn't published as a static
   file, so the Scan step is the source of truth).
4. Once scanning passes, the app appears in Community Applications for every Unraid user; new
   commits to `main` that touch the template are picked up automatically on CA's next refresh.

Don't invent or skip these steps yourself — only the repository owner can register it with CA,
and only after the repository and image are public.

## Synology, Portainer, generic Container Manager

Create a project or stack from [`stack.yml`](stack.yml) (Portainer: *Stacks → Add stack*; Synology:
*Container Manager → Project → Create*). See the comments at the top of that file for exact menu
steps and how to swap the named volume for a bind-mounted folder.

## TrueNAS SCALE

See [`truenas/README.md`](truenas/README.md).

## CasaOS

See [`casaos/README.md`](casaos/README.md).
