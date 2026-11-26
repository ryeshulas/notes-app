# Notes

A self-hosted notes app: sticky-note-style cards, typed text plus S Pen handwriting and drawings,
folders, and offline sync. One small server runs on the NAS; clients are a web app (laptop, any browser)
and, later, a sideloaded Android app.

## What's here

| Path | What it is |
| --- | --- |
| `server/server.js` | Node server (no dependencies): sign-in, sync API, serves the web app. Data in SQLite at `/data/notes.db`. |
| `web/` | Web app. Works offline, installable from the browser. Notes pop out into their own windows. |
| `Dockerfile`, `docker-compose.yml` | Container for the NAS. |
| `.github/workflows/docker.yml` | Builds the image and publishes it to `ghcr.io/ryeshulas/notes-app` on every push to `main`. |

## Deploy on the UGREEN NAS

1. **Let the NAS pull the private image.** On GitHub: Settings → Developer settings → Personal access tokens →
   Tokens (classic) → generate one with only the `read:packages` scope. Then on the NAS:

   ```bash
   sudo docker login ghcr.io -u ryeshulas    # paste the token as the password
   ```

2. **Create the app folder.** Pick a spot on a share you back up, for example:

   ```bash
   sudo mkdir -p /volume1/docker/notes/data
   sudo chown 1000:1000 /volume1/docker/notes/data   # the container runs as UID 1000
   cd /volume1/docker/notes
   ```

   Copy `docker-compose.yml` into that folder and create a `.env` file next to it:

   ```
   NOTES_PASSWORD=a-long-unique-password
   ```

3. **Start it.**

   ```bash
   sudo docker compose up -d
   ```

   It listens on port **8787**. Check `http://<nas-ip>:8787` from your laptop.

4. **Cloudflare tunnel.** Add a public hostname (for example `notes.yourdomain.com`) pointing to
   `http://<nas-ip>:8787`. Don't put Cloudflare Access in front of it: the Android app syncs in the
   background and can't get past an Access login page. The app has its own sign-in (password, then a token per device).

5. **Updating.** After new code lands on `main` and the GitHub Action finishes:

   ```bash
   cd /volume1/docker/notes && sudo docker compose pull && sudo docker compose up -d
   ```

## Using the web app

- Install it from Chrome/Edge (address bar → Install) so it opens like an app.
- **Pop-out**: the ⧉ button on a note opens it in its own small window. Open as many as you like; they stay in sync with each other.
- **Drawing**: pen, highlighter, stroke eraser, colors, sizes, undo. Once an S Pen is detected, fingers scroll and only the pen draws.
- **Offline**: edits are saved on the device first and sync when the server is reachable (the dot in the sidebar: green synced, amber waiting, red offline).
- **Trash**: deleted notes can be restored, or deleted forever.

## Backups

Everything is in `data/notes.db` (plus `-wal`/`-shm` files while running). Back up the whole `data` folder.
For a guaranteed-consistent copy, `sudo docker compose stop` first, or use `sqlite3 notes.db ".backup copy.db"`.

## Sync model

Each change carries the time it was made; the server keeps the newest version of each note (last write wins).
Clients send pending changes and receive everything that changed since their last sync. Deletes are kept as
"tombstones" so they reach every device.

## Running locally

```bash
NOTES_PASSWORD=devpassword node server/server.js   # Node 22.13+
# open http://localhost:8080
```
