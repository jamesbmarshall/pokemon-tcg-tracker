# PokéTracker on TrueNAS SCALE

TrueNAS SCALE 24.10 (Electric Eel) introduced Docker-based Apps. This template uses
the [Install via YAML flow](https://apps.truenas.com/managing-apps/installing-custom-apps/)
to deploy [`docker-compose.yml`](docker-compose.yml).

## Before you start

Create a dataset or directory for app data, for example `/mnt/tank/apps/poketracker`,
using the TrueNAS storage UI. Set `PUID` and `PGID` in the Compose file to a user/group
with write access to that directory.

## Install steps (TrueNAS SCALE 24.10+)

1. **Apps → Discover Apps → Custom App.**
2. Click the **⋮** (more) menu next to *Custom App* and choose **Install via YAML**.
3. Give the app a name, e.g. `poketracker`.
4. Paste the contents of [`docker-compose.yml`](docker-compose.yml) into the editor, editing the
   `volumes:` path to the folder you created above.
5. Install. TrueNAS pulls the image and starts the container.
6. Open `http://<truenas-ip>:3000`, and enter the setup token from the container's log (**Apps →
   poketracker → Logs**) unless you set `SETUP_TOKEN` yourself in the YAML.

## Caveats

- **TrueNAS only checks the YAML for valid syntax**, not whether every Compose key it contains is
  something it actually supports — it doesn't validate the full Docker Compose spec. This file
  sticks to the plain, well-supported subset (`image`, `restart`, `ports`, `environment`,
  `volumes`), which is the same subset TrueNAS's own documented examples use.
- TrueNAS's UI also offers host-path, "ixVolume" (TrueNAS-managed dataset) and SMB-share storage
  options when you use the guided (non-YAML) wizard instead. If you'd rather have TrueNAS manage
  the dataset for you, use the guided **Custom App** flow and point its storage step at `/data`
  instead of pasting this YAML.
- As with every other deployment of PokéTracker: run exactly **one** instance. SQLite allows a
  single writer, so do not point two custom apps at the same data folder or try to scale this
  beyond one replica.
- Menu labels can vary by TrueNAS release; use the linked installation guide for your version.
