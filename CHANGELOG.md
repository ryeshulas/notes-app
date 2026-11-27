# Changelog

The version shows in the app under the folder menu. Each change gets a new number.

## 0.29.0 (Android app 1.1.0)
- **Reminders:** ⋯ → ⏰ Reminder… (quick picks or any date and time). The Android app shows a phone notification at that time, even when closed; in a browser it pops up while the app is open. Reminders show on the note and its card, and in a ⏰ Reminders list in the folder menu.
- **Tags:** type #words in a note (e.g. #car, #receipts). Tags appear under **Tags** in the folder menu; tap a tag in a note for "Show notes tagged…".
- **Text in pictures:** the Android app reads the text in pictures (photos, scans, PDF pages) in the background so search finds it. On a picture, **Aa Text** shows the text to copy or add to the note.
- **Voice memos:** 🎙 in the Type toolbar records into the note.
- **Templates:** 📄 Templates above the list: Meeting notes, Maintenance log, Ruled page (medium), Daily planner, Activity tracker (Date / Time / Note — **Add entry (now)** fills in the date and time). ⋯ → Ruled lines switches any note's paper.
- **Links between notes:** type [[ and pick a note (or make a new one). Tap the link to open it; the linked note shows "Linked from".
- **Checklists:** drag the ⠿ handle to reorder list items (sub-items come along). Checked items move to the bottom (setting in the folder menu).
- **Scan a document** (Android app): Picture → Scan a document uses Google's scanner (edge detection, cleanup, several pages).
- **PDFs:** Picture → PDF to write on (or share a PDF to Notes on Android). Each page becomes a locked page you can write over; 🔓 Unlock to move one.

## 0.28.0
- **Search handwriting:** the Android app reads the handwriting in your notes in the background (on the device) and saves the words for search, on every device. Progress shows in the folder menu the first time. The note itself isn't changed, so its date and order stay the same.
- **Web links** in typed text are underlined links. Put the cursor in one (tap it) and an **↗ Open** button appears; on the laptop Ctrl+click opens it directly.
- **Lists** are now one drop-down (bulleted-list icon with ▾): Bulleted list, Numbered list, Checklist, Plain text.
- Bigger, icon-only **undo / redo** buttons.
- **Folder colors:** a folder's ⋯ menu has a row of colors plus Rename and Delete. The folder icon shows its color in the menu, and notes in All notes / search show a small colored folder tag.
- Dark mode: the note color buttons use strong colors so they're easy to tell apart.

## 0.27.0
- A note's folder picker has **＋ New folder…** at the bottom: name it and the note moves straight into the new folder. (If a folder with that name already exists, the note goes there instead of making a duplicate.)

## 0.26.1
- The pin button is icon-only: a pin when the note isn't pinned, a highlighted crossed-out pin when it is. No pop-up message.
- The folder picker is back in the note header on phones.

## 0.26.0
- The pin button in a note now says what it will do: **Pin** (pin icon) when the note isn't pinned, and a highlighted **Unpin** (crossed-out pin) when it is. A short message confirms "Pinned to the top" / "Unpinned".
- On phones the folder picker sits on the color row so the title has more room.
- The multi-select bar shows **✕ Unpin** when all picked notes are pinned.

## 0.25.0
- The eraser now erases just the part of a shape under it (outline or fill), like handwriting. A shape the eraser has touched becomes regular ink, so afterwards it's selected with the Lasso rather than Select. Undo restores the original shape.

## 0.24.0 (Android app 1.0.1)
- The eraser removes shapes again: touch a shape's outline (or anywhere inside a filled shape) to remove it. Undo brings it back.
- Right-click (laptop) or long-press a shape, picture, label or lasso selection for **Copy, Cut, Duplicate, Delete**; right-click an empty spot in Write mode to **Paste here**.
- Copy / Cut / Paste for drawings: buttons on the selection bars and a **Paste** button in Write mode, plus Ctrl+C / Ctrl+X / Ctrl+V. Works between notes. Pasting a screenshot or copied picture (Ctrl+V) adds it to the drawing.
- Typed text: select several lines by dragging across them, Shift+click or Ctrl+A (or **Select all**), then **Copy, Cut** or **Delete** (or just type to replace them). New **📋 Paste** button. Escape clears the selection instead of closing the note.
- Android app 1.0.1: the Paste button and Copy/Cut use the phone's clipboard.

## 0.23.0
- Android app 1.0.0 (see README → Android app): handwriting to text with the S Pen (Lasso → **Aa To text**), home screen widget, Quick Settings tile, share into Notes, export to Downloads, print / save as PDF, update notices.
- The web app recognises the Android app: shows both versions under the folders, hides the pop-out and keep-on-top buttons there, and the phone's Back button closes things one step at a time.

## 0.22.0
- Pictures are now added only in Write mode, with a labeled **Picture** button, so every picture can be dragged and resized freely. (The Type-mode Picture button is gone; pictures already in a note's text stay where they are.)
- New pictures appear where you can see them: just below the text if it's on screen, otherwise at the top of the view, clear of the picture menu.
- Bigger Type / Write buttons.

## 0.21.0
- Pictures, shapes and labels can be moved again from either mode: press on one (S Pen, finger or mouse) and it switches to Write with Select and picks it up.
- The S Pen lasso works when starting from Type mode.
- In Write mode, a finger tap no longer switches to typing while using Select or Lasso, while something is lasso-selected, or when tapping a picture or shape.

## 0.20.0
- Tap below a drawing, shape or picture to start typing there. Works whether you drew first or typed first, and again after each drawing. (Tapping where there's nothing drawn between the text and your tap just continues the text.)

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
