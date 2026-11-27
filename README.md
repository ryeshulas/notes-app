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

## Android app

The app (in `android/`) runs the same notes web app from your server, so web updates show up in the app
automatically and it works offline the same way. On top of that it adds:

- **Handwriting to text** (S Pen): in Write mode, circle writing with the Lasso, then **Aa To text**. Fix the
  text if needed, then **Replace handwriting** (typed text in the same spot) or **Add to typed text**.
  Uses Google ML Kit on the device; the English model (~20 MB) downloads the first time, then works offline.
- **Home screen widget**: **+ Type** / **✍ Write** buttons and your five most recent notes.
- **Quick Settings tile** "New note": pull down the shade, tap the pencil, then add the tile.
- **Share into Notes**: share text, links or pictures from any app to make a new note.
- Export saves to **Downloads**; Print / PDF uses Android's print screen (choose *Save as PDF*).
- The app checks GitHub for a newer APK twice a day and offers to download it.

### One-time setup: the signing key

The APK is signed so updates install over the top. The key goes in two repository secrets
(GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | the long text from the signing file |
| `ANDROID_KEYSTORE_PASSWORD` | the password from the signing file |

Keep a copy of the signing file somewhere safe (e.g. your password manager). If the key is lost, the app has
to be uninstalled and reinstalled to update (unsynced changes on that device would be lost).

### Building and installing

1. GitHub → **Actions → Build Android app → Run workflow** (it also runs whenever `android/` changes).
2. On the phone or tablet, open **github.com/ryeshulas/notes-app/releases**, tap `notes-app-X.Y.Z.apk`, then
   **Install**. The first time, Android asks to allow your browser to install apps; allow it.
3. Open **Notes**, enter your server address (the tunnel address), and sign in with your password.

To release a new app version, bump the number in `android/VERSION`; the workflow publishes a release named
`android-vX.Y.Z`. Changes to the web app (`web/`) don't need a new APK.

## Backups

Back up the whole data folder (e.g. `/volume1/docker/notes/data`) with restic/Backrest. It contains:

| Path | What |
| --- | --- |
| `notes.db` | The live database (notes, folders, version history). |
| `backups/notes-YYYY-MM-DD.db` | A consistent copy of the database made by the server once a day; the last 14 are kept. These are always safe to restore even if the live file was being written during the backup. |
| `files/` | Images. |

To restore: stop the container, copy a `backups/notes-….db` over `notes.db` (delete `notes.db-wal` and `notes.db-shm`), start it again.

The app also has **Export all notes** (one file, optionally with images) and **Import notes** in the folder menu,
and **Print / Save as PDF** for a single note.

## Housekeeping (automatic)

- Notes in the Trash for more than 30 days are deleted for good.
- Version history is kept for 90 days, up to 50 versions per note.
- Images no note (or saved version) uses are removed after a week.

## Sync model

Each change carries the time it was made; the server keeps the newest version of each note (last write wins).
Clients send pending changes and receive everything that changed since their last sync. Deletes are kept as
"tombstones" so they reach every device.

## Running locally

```bash
NOTES_PASSWORD=devpassword node server/server.js   # Node 22.13+
# open http://localhost:8080
```
