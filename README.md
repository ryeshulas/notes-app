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

   If you'd rather not use SSH, add the same login in Dockhand's registry settings instead
   (registry `ghcr.io`, username `ryeshulas`, the token as the password).

2. **Create the folder for the data.** In the UGOS file manager, create a folder on a share you back up,
   for example `docker/notes/data`, and note its full path on the NAS (for example `/volume1/docker/notes/data`).
   The container sets the folder's permissions itself on first start, so no `chown` is needed.

3. **Create the stack in Dockhand.**
   1. Select the UGREEN environment, then go to **Stacks → Create**.
   2. Name it `notes` and paste in the contents of `docker-compose.yml` from this repo.
   3. If your data folder's path is different, change `/volume1/docker/notes/data` on the `volumes` line to match.
      Use the full path: a relative path like `./data` would end up inside Dockhand's own stack folder.
   4. Under **Environment variables**, add `NOTES_PASSWORD` set to a long, unique password, and mark it as a secret.
   5. Deploy. Dockhand pulls the image and starts the container.

   It listens on port **8787**. Check `http://<nas-ip>:8787` from your laptop and sign in with that password.

4. **Cloudflare tunnel.** Add a public hostname (for example `notes.yourdomain.com`) pointing to
   `http://<nas-ip>:8787`. Don't put Cloudflare Access in front of it: the Android app syncs in the
   background and can't get past an Access login page. The app has its own sign-in (password, then a token per device).

5. **Updating.** After new code lands on `main` and the GitHub Action finishes, open the `notes` stack in
   Dockhand and pull and redeploy it.

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
