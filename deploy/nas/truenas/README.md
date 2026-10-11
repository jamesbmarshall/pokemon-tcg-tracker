# PokéTracker on TrueNAS SCALE

TrueNAS SCALE 24.10 ("Dragonfish") replaced the old Kubernetes/k3s-based "custom app" system with
plain Docker. The Apps UI can now install a container straight from a Docker Compose file, which
is what [`docker-compose.yml`](docker-compose.yml) in this folder is for.

## Before you start

Create the folder PokéTracker will use for its data, on whichever pool you keep app data on, e.g.:

```
storage filesystem mkdir path="/mnt/tank/apps/poketracker"
```

(or use the Storage screen in the UI). The installer doesn't let you create datasets or
directories partway through, so do this first.

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
- This was verified against TrueNAS's published Apps documentation as of writing; the exact wizard
  wording may have moved by the time you read this; if the menu names in the steps above don't
  match what you see, the nearest reasonably-named buttons are almost certainly it.
