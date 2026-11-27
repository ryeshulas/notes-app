# Changelog

The version shows in the app under the folder menu. Each change gets a new number.

## 0.19.0
- Text and drawing now share one page, like Samsung Notes: write or draw right over and around your typed text.
- The page has a fixed width and scales to the screen, so handwriting stays lined up with the text on the phone, tablet and laptop (text is larger on bigger screens, up to a limit).
- New **Type / Write** switch above the toolbar replaces the divider and "Hide drawing". Touching the page with the S Pen switches to Write automatically; with a pen in use, a finger tap on the text switches back to typing at that spot.
- The page grows as you type, and zoom now enlarges the whole page.
- Older notes are converted the first time they're opened: the drawing is moved just below the text so nothing overlaps.
- Printing uses the combined page.

## 0.18.0
- **Resize text and drawing areas**: drag the divider between the text and the drawing to give the text more
  room, or tap **Hide drawing** for notes that are mostly text (tap **Show drawing area** to bring it back).
  Each note remembers its layout, and new notes start with the layout you used last.
- Tapping empty space in the text area puts the cursor at the end of the text.
- Bigger rows in the compact list view, especially on touch screens (tablet).
- Fixed: notes without a pinned setting (e.g. some imported notes) could sort above the Pinned section.

## 0.17.0
- **Select several notes**: tap **☑ Select** above the notes (or long-press a note on the phone/tablet,
  Ctrl+click on the laptop; Shift+click selects a range). Then move them to a folder, change their color,
  pin/unpin, or delete them together. **Select all** picks every note in the current view/search.
  In the Trash you can restore or delete forever several at once.

## 0.16.0
- **Lasso** tool (dashed loop): circle handwriting to select it, drag inside the box to move it, or use
  Duplicate / Delete. Works with undo.
- **Zoom** the drawing area: pinch with two fingers, Ctrl + scroll on the laptop, or the − / 100% / + buttons.
  Drawing while zoomed lands in the right place; zoom resets when you open another note.
- The option bars for shapes, labels/images and lasso selections now float over the top of the drawing
  instead of pushing it down, so the drawing never moves under the pen.

## 0.15.0
- **Dark mode**: at the bottom of the folder menu choose Appearance: automatic (follows the phone/PC setting),
  Light or Dark. Notes get darker versions of their colors; black ink, shapes and labels show as light ink
  in dark mode (they're still black when printed or shown in light mode).
- Shapes now always sit above photos (and below the ink), so a photo added later can't cover them.
- Toolbar icons follow the light/dark text color.

## 0.14.0
- **Keep on top** (⋯ menu, laptop with Chrome/Edge): opens the note in a small window that stays above all
  other windows, like Sticky Notes. One at a time; ⧉ pop-out windows still work for more.
- **Undo / redo for text**: ↶ ↷ buttons above the text, or Ctrl+Z / Ctrl+Y. Covers typing (grouped), lists,
  formatting and line changes.
- **Sorting**: Last edited, Date created or Title A–Z. **Compact list view** on the laptop (toggle next to the sort).
- Import merges folders with the same name as an existing folder instead of creating duplicates.

## 0.13.0
- **Version history** (⋯ menu in a note → Version history). The server keeps earlier copies of each note:
  before an edit from another device, before a delete or restore, every 10 minutes while editing, and any
  edit that arrived late and lost to a newer one (so a sync conflict never silently loses work).
  Restore any version; the current one is kept too. Kept 90 days, up to 50 per note.
- **Print / Save as PDF** (⋯ menu) prints just the note, with its drawing, labels and photos.
- **Export all notes** / **Import notes** in the folder menu. Export can include images. Import keeps
  original dates and skips notes that are already up to date (so importing twice is safe).
- **Automatic backups**: the server writes a consistent copy of the database every day to `data/backups`
  (last 14 kept) for restic/Backrest.
- **Cleanup**: Trash is emptied after 30 days; images no note uses are removed after a week (server) and
  from each device's offline cache.
- Devices are named (e.g. "Windows PC", "Android phone") so history shows where an edit came from.
  Devices signed in before this version show as their old name.

## 0.12.0
- White added to the text colors and label colors.
- Adding an image now offers **Take photo**, **Photos** or **Browse files**. Browse files opens the
  device's file browser (Downloads, file shares, etc.). Take photo appears on phones and tablets.
- The eraser now works like a pen: it removes only the ink under it (splitting lines as needed) and
  leaves labels, images and shapes alone. Its size follows the Fine/Medium/Bold picker, and a circle
  shows its size.
- New **Shapes** tool: rectangle, ellipse, triangle, line and arrow. Drag to draw (a tap makes a
  default-size shape). Outline only or filled with a color. The line uses the pen color and size.
  Select a shape with the arrow tool to move or resize it, or change its line color, thickness and fill.
- HEIC photos show a clear message (browsers can't open them).

## 0.11.0
- The toolbar for a selected label or image now sits just under the drawing toolbar, so it never
  runs off the screen.
- Image size controls: a size slider, − / + buttons and "Full width", shown as soon as an image is
  added and whenever you select one with the arrow tool. The corner resize handle is bigger.
- Labels near the right edge slide left as you type instead of wrapping.
- Larger back button for leaving a note.

## 0.10.0
- **🖼 Picture** button in the text toolbar inserts a photo into the note text, after the line you're on.
  Tap a picture to make it small, medium or full width, or remove it.
- Note cards count pictures in the text too.

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
