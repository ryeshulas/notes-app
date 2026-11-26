# Changelog

The version shows in the app under the folder menu. Each change gets a new number.

## 0.9.0
- Drawing area: new **T** tool for text labels. Tap where the label should go and type. Tap on a photo
  to label it (e.g. room measurements).
- New **image** button adds photos from the camera or gallery onto the drawing area. Draw on top of them.
- New **select** tool (arrow): drag labels and images to move them, drag an image's corner to resize,
  and use the small toolbar to change a label's font, size, bold/italic/underline and color, or delete.
- Layers: photo at the bottom, ink above it, labels on top.
- Images are saved on the device first (work offline), stored on the NAS, and downloaded once on other devices.
- Note cards show labels and images in the preview, plus an image count.

## 0.8.0
- Text formatting bar above the note text: font (Default, Serif, Monospace, Handwriting, Rounded),
  **bold**, *italic*, underline, strikethrough, text color and highlight color.
- Select text and tap a button, or tap a button first and then type. Shortcuts on the laptop:
  Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X.
- Fonts are built into the app, so they work offline.

## 0.7.0
- "📌 Keep open" option at the bottom of the folder menu keeps the menu as a column beside your notes
  (on by default on laptops/desktops). ☰ still hides/shows it. Phones always use the slide-out menu.
- Wildcard search: every word must match; `*` = any letters, `?` = one letter, "quotes" for exact phrases.
- Eraser button now shows an eraser icon.
- Harmless browser warnings no longer pop up as errors; real errors can be dismissed.

## 0.6.0
- Indented sub-lists: Tab / Shift+Tab, or the ⇥ / ⇤ buttons. Sub-levels number as 1. → a. → i.
  and bullets as • → ◦ → ▪. Enter on an empty sub-item (or Backspace at its start) steps back out a level.
- New list shortcut: two lines in a row that start with a number and a period ("1. Milk", "2. Eggs")
  become a numbered list when you press Enter; two lines starting with "*" become a bulleted list.
  A single line like that stays plain text. "[] " still starts a checklist item right away.

## 0.5.0
- Bulleted lists, numbered lists and checklists in notes.
  - Buttons above the text, or type `- `, `1. ` or `[] ` at the start of a line.
  - Enter continues the list; Enter on an empty item (or Backspace at its start) ends it.
  - Tick checklist items off; "Clear checked" removes finished items.
  - Note cards show checklist progress (e.g. "2/5 done").

## 0.4.0
- Version number shown under the folder menu.
- "A new version is available" notice with an Update button when the server has been updated.
- Docker images are also tagged with the version (e.g. `ghcr.io/ryeshulas/notes-app:0.4.0`).

## 0.3.0
- Phone: notes shown as a one-per-row list (title, date, preview). Pinned section on all screens.
- Fixed blank screen caused by the browser/Cloudflare mixing old and new files.

## 0.2.0
- ☰ button collapses the folder menu on wide screens; slide-out drawer on narrower ones.
- Content stays inside phone screen cutouts and curved edges.

## 0.1.0
- First release: sync server, offline web app, folders, pen ink, pop-out windows, trash.
