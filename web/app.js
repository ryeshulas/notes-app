// Notes web client: offline-first (IndexedDB + outbox), syncs with the server, typed text + pen ink.
'use strict';

const NOTE_COLORS = {
  yellow: '#fff6c7', green: '#dff5d8', blue: '#dcecff', pink: '#ffe0ea',
  purple: '#ece2ff', orange: '#ffe6cc', gray: '#eeeeee', white: '#ffffff',
};
const INK_COLORS = ['#1f1f1f', '#1e5bd8', '#d32f2f', '#2e7d32', '#f9a825', '#8e24aa'];
const INK_W = 1000;          // logical canvas width; strokes are stored in these units
const DEFAULT_INK_H = 900;
const SYNC_INTERVAL = 30000;
const APP_VERSION = '__APP_VERSION__';  // filled in by the server

const $ = (sel) => document.querySelector(sel);

// If anything breaks at startup, show the error instead of a blank screen.
function showFatal(msg) {
  let el = document.getElementById('fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99;background:#b3261e;color:#fff;padding:12px 14px;border-radius:10px;font:14px system-ui';
    document.body.append(el);
  }
  el.textContent = `Something went wrong: ${msg}. If it keeps happening, send this message to Claude. `;
  const close = document.createElement('button');
  close.textContent = 'Dismiss';
  close.style.cssText = 'margin-left:8px;background:#fff;color:#b3261e;border:0;border-radius:6px;padding:3px 10px;font-weight:600';
  close.onclick = () => el.remove();
  el.append(close);
  console.error(msg);
}
// Harmless browser warnings that aren't real failures.
const BENIGN = [/ResizeObserver loop/i, /Script error\.?$/i, /AbortError/i, /NetworkError|Failed to fetch|Load failed/i];
const isBenign = (msg) => !msg || BENIGN.some((r) => r.test(msg));
window.addEventListener('error', (e) => { if (!isBenign(e.message)) showFatal(e.message); });
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  if (!isBenign(msg) && e.reason?.name !== 'AbortError') showFatal(msg);
});
const params = new URLSearchParams(location.search);
const isPopout = params.has('popout');

// ---------------------------------------------------------------- storage
const idb = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('notes-app', 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('records', { keyPath: 'key' });
          db.createObjectStore('outbox', { keyPath: 'key' });
          db.createObjectStore('meta', { keyPath: 'k' });
        }
        if (e.oldVersion < 2) db.createObjectStore('files', { keyPath: 'id' });   // images, kept for offline use
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, mode);
      let result;
      const s = Array.isArray(store) ? store.map((n) => t.objectStore(n)) : t.objectStore(store);
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  all(store) { return this.tx(store, 'readonly', (s) => this.req(s.getAll())); },
  get(store, key) { return this.tx(store, 'readonly', (s) => this.req(s.get(key))); },
  put(store, val) { return this.tx(store, 'readwrite', (s) => { s.put(val); }); },
  del(store, key) { return this.tx(store, 'readwrite', (s) => { s.delete(key); }); },
  clear(stores) { return this.tx(stores, 'readwrite', (ss) => { ss.forEach((s) => s.clear()); }); },
};
const meta = {
  async get(k, dflt = null) { const r = await idb.get('meta', k); return r ? r.v : dflt; },
  set(k, v) { return idb.put('meta', { k, v }); },
};

// ---------------------------------------------------------------- state
const state = {
  records: new Map(),   // key -> {key, kind, id, data, updated_at, deleted}
  view: 'all',          // 'all' | 'inbox' | 'trash' | folder id
  query: '',
  openId: null,         // note open in the editor
  draft: null,          // unsaved brand-new note
  token: null,
  syncing: false,
  pending: 0,
  online: navigator.onLine,
  lastSync: 0,
};
const keyOf = (kind, id) => `${kind}:${id}`;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('notes-app') : null;

function notes() { return [...state.records.values()].filter((r) => r.kind === 'note'); }
function folders() {
  return [...state.records.values()].filter((r) => r.kind === 'folder' && !r.deleted)
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}
function getNote(id) {
  if (state.draft && state.draft.id === id) return state.draft;
  return state.records.get(keyOf('note', id));
}

async function save(kind, id, data, deleted = false) {
  const rec = { key: keyOf(kind, id), kind, id, data, updated_at: Date.now(), deleted };
  state.records.set(rec.key, rec);
  await idb.tx(['records', 'outbox'], 'readwrite', ([r, o]) => { r.put(rec); o.put(rec); });
  bc?.postMessage({ type: 'changed', keys: [rec.key] });
  state.pending = (await idb.all('outbox')).length;
  renderSyncStatus();
  scheduleSync(1500);
  return rec;
}

// ---------------------------------------------------------------- image files
// Images are saved on the device first (so they work offline), uploaded to the server on sync,
// and downloaded once on other devices.
const files = {
  urls: new Map(),
  async put(id, blob) {
    await idb.put('files', { id, blob, type: blob.type, pending: true });
    this.urls.set(id, URL.createObjectURL(blob));
    scheduleSync(500);
  },
  async url(id) {
    if (!id) return null;
    if (this.urls.has(id)) return this.urls.get(id);
    const rec = await idb.get('files', id);
    if (rec) { const u = URL.createObjectURL(rec.blob); this.urls.set(id, u); return u; }
    if (!state.token) return null;
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (!res.ok) return null;
      const blob = await res.blob();
      await idb.put('files', { id, blob, type: blob.type, pending: false });
      const u = URL.createObjectURL(blob);
      this.urls.set(id, u);
      return u;
    } catch { return null; }
  },
  async uploadPending() {
    const all = await idb.all('files');
    for (const f of all.filter((x) => x.pending)) {
      const res = await fetch(`/api/files/${encodeURIComponent(f.id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': f.type || 'image/jpeg' },
        body: f.blob,
      });
      if (res.status === 401) throw Object.assign(new Error('Not signed in'), { status: 401 });
      if (res.ok) await idb.put('files', { ...f, pending: false });
    }
  },
};

// Shrink big photos before saving (max 2000px on the long side).
async function prepareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const max = 2000;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const keepPng = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024 && k === 1;
  if (keepPng) return { blob: file, w, h };
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  return { blob, w, h };
}

// ---------------------------------------------------------------- sync
let syncTimer = null;
function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { status: res.status });
  return json;
}

async function sync() {
  if (!state.token) return;
  const run = async () => {
    if (state.syncing) return;
    state.syncing = true;
    try {
      let more = true;
      const changedKeys = [];
      await files.uploadPending().catch((e) => { if (e.status === 401) throw e; });
      let outbox = await idb.all('outbox');
      while (more) {
        const since = await meta.get('since', 0);
        const sent = outbox.map(({ kind, id, data, updated_at, deleted }) => ({ kind, id, data, updated_at, deleted }));
        const resp = await api('/api/sync', { since, changes: sent });
        // Clear outbox entries that weren't edited again while we were syncing.
        const sentAt = new Map(sent.map((s) => [keyOf(s.kind, s.id), s.updated_at]));
        await idb.tx('outbox', 'readwrite', (o) => {
          const r = o.getAll();
          r.onsuccess = () => {
            for (const cur of r.result) if (sentAt.get(cur.key) === cur.updated_at) o.delete(cur.key);
          };
        });
        const pendingNow = new Map((await idb.all('outbox')).map((r) => [r.key, r]));
        const incoming = [];
        for (const c of resp.changes) {
          const key = keyOf(c.kind, c.id);
          const local = state.records.get(key);
          const pend = pendingNow.get(key);
          if (pend && pend.updated_at > c.updated_at) continue;
          if (local && local.updated_at > c.updated_at) continue;
          const rec = { key, kind: c.kind, id: c.id, data: c.data, updated_at: c.updated_at, deleted: c.deleted };
          if (local && local.updated_at === c.updated_at) continue; // our own change echoed back
          state.records.set(key, rec);
          incoming.push(rec);
          changedKeys.push(key);
        }
        if (incoming.length) await idb.tx('records', 'readwrite', (r) => { incoming.forEach((rec) => r.put(rec)); });
        await meta.set('since', resp.rev);
        more = resp.more;
        outbox = [];
      }
      state.online = true;
      state.lastSync = Date.now();
      if (changedKeys.length) { bc?.postMessage({ type: 'changed', keys: changedKeys }); onRemoteChange(changedKeys); }
    } catch (e) {
      if (e.status === 401) { state.token = null; await meta.set('token', null); showLogin(); }
      else state.online = false;
    } finally {
      state.syncing = false;
      state.pending = (await idb.all('outbox')).length;
      renderSyncStatus();
    }
  };
  if (navigator.locks) await navigator.locks.request('notes-sync', run); else await run();
}

function renderSyncStatus() {
  const el = $('#sync-status');
  el.classList.toggle('pending', state.pending > 0);
  el.classList.toggle('offline', !state.online);
  const when = state.lastSync ? new Date(state.lastSync).toLocaleTimeString() : 'never';
  el.title = !state.online ? `Offline — ${state.pending} change(s) waiting` :
    state.pending ? `${state.pending} change(s) waiting to sync` : `Synced (last: ${when})`;
}

async function reloadKeys(keys) {
  for (const key of keys) {
    const rec = await idb.get('records', key);
    if (rec) state.records.set(key, rec); else state.records.delete(key);
  }
  onRemoteChange(keys);
}

function onRemoteChange(keys) {
  renderSidebar();
  renderList();
  if (state.openId && keys.includes(keyOf('note', state.openId)) && !editor.busy()) editor.load(state.openId);
  if (isPopout && state.openId) {
    const n = getNote(state.openId);
    if (n?.deleted) window.close();
  }
}

// ---------------------------------------------------------------- auth
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#login-password').focus();
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const device = `Web — ${navigator.userAgentData?.platform || navigator.platform || 'browser'}`;
    const { token } = await api('/api/login', { password: $('#login-password').value, device });
    state.token = token;
    await meta.set('token', token);
    $('#login-password').value = '';
    showApp();
    renderAll();
    sync();
  } catch (err) {
    $('#login-error').textContent = err.status === 401 ? 'Wrong password' : (err.message || 'Could not reach the server');
  }
});

$('#logout').addEventListener('click', async () => {
  const pending = (await idb.all('outbox')).length;
  const msg = pending
    ? `${pending} change(s) haven't synced yet and will be lost. Sign out anyway?`
    : 'Sign out of this device? Notes stay on the server.';
  if (!confirm(msg)) return;
  try { await api('/api/logout'); } catch { /* ignore */ }
  await idb.clear(['records', 'outbox', 'meta']);
  state.records.clear();
  state.token = null;
  closeEditor();
  showLogin();
});

// ---------------------------------------------------------------- sidebar & list
function renderSidebar() {
  const nav = $('#folders');
  nav.textContent = '';
  const live = notes().filter((n) => !n.deleted);
  const count = (pred) => live.filter(pred).length;
  const items = [
    { id: 'all', name: 'All notes', n: live.length },
    { id: 'inbox', name: 'Unfiled', n: count((n) => !n.data.folder || !state.records.get(keyOf('folder', n.data.folder)) || state.records.get(keyOf('folder', n.data.folder)).deleted) },
    ...folders().map((f) => ({ id: f.id, name: f.data.name, n: count((n) => n.data.folder === f.id), folder: true })),
    { id: 'trash', name: 'Trash', n: notes().filter((n) => n.deleted && !n.data.purged).length },
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'folder' + (state.view === it.id ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = (it.folder ? '📁 ' : '') + it.name;
    const right = document.createElement('span');
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = it.n || '';
    right.append(c);
    if (it.folder) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = '⋯';
      more.title = 'Rename or delete';
      more.addEventListener('click', (e) => { e.stopPropagation(); editFolder(it.id); });
      right.append(more);
    }
    b.append(name, right);
    b.addEventListener('click', () => { state.view = it.id; if (drawerMode()) setDrawer(false); renderSidebar(); renderList(); });
    nav.append(b);
  }
  // folder picker in the editor
  const sel = $('#note-folder');
  const cur = sel.value;
  sel.textContent = '';
  sel.append(new Option('Unfiled', ''));
  folders().forEach((f) => sel.append(new Option(f.data.name, f.id)));
  sel.value = cur;
}

$('#add-folder').addEventListener('click', async () => {
  const name = prompt('Folder name');
  if (!name || !name.trim()) return;
  const id = uuid();
  await save('folder', id, { name: name.trim() });
  state.view = id;
  renderSidebar(); renderList();
});

async function editFolder(id) {
  const f = state.records.get(keyOf('folder', id));
  const name = prompt('Rename folder (clear the name to delete the folder):', f.data.name);
  if (name === null) return;
  if (name.trim()) { await save('folder', id, { ...f.data, name: name.trim() }); }
  else if (confirm(`Delete folder "${f.data.name}"? Its notes move to Unfiled.`)) {
    for (const n of notes().filter((n) => n.data.folder === id)) await save('note', n.id, { ...n.data, folder: null }, n.deleted);
    await save('folder', id, f.data, true);
    if (state.view === id) state.view = 'all';
  }
  renderSidebar(); renderList();
}

function viewTitle() {
  if (state.view === 'all') return 'All notes';
  if (state.view === 'inbox') return 'Unfiled';
  if (state.view === 'trash') return 'Trash';
  return state.records.get(keyOf('folder', state.view))?.data.name || '';
}

// Search: every word must appear (in any order). Wildcards: * = any letters, ? = one letter.
// "Quoted phrases" must appear as written.  e.g.  plumb*  wax gu?rd  "water heater"
function buildMatcher(query) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(query))) terms.push(m[1] ?? m[2]);
  if (!terms.length) return null;
  const regexes = terms.map((t) => {
    const pattern = t.split('').map((ch) => {
      if (ch === '*') return '\\S*';
      if (ch === '?') return '\\S';
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return new RegExp(pattern, 'i');
  });
  return (text) => regexes.every((r) => r.test(text));
}

function visibleNotes() {
  const folderIds = new Set(folders().map((f) => f.id));
  const match = buildMatcher(state.query.trim());
  return notes().filter((n) => {
    if (state.view === 'trash') { if (!n.deleted || n.data.purged) return false; }
    else {
      if (n.deleted) return false;
      if (state.view === 'inbox' && n.data.folder && folderIds.has(n.data.folder)) return false;
      if (state.view !== 'all' && state.view !== 'inbox' && n.data.folder !== state.view) return false;
    }
    if (match && !match(`${n.data.title || ''}\n${n.data.text || ''}`)) return false;
    return true;
  }).sort((a, b) => (b.data.pinned - a.data.pinned) || (b.updated_at - a.updated_at));
}

function noteDate(t) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

function renderList() {
  if (isPopout) return;
  $('#list-title').textContent = viewTitle();
  const grid = $('#notes');
  grid.textContent = '';
  const list = visibleNotes();
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#empty').textContent = state.query.trim() ? 'No notes match your search.' : 'No notes here yet.';
  const hasPinned = state.view !== 'trash' && list.some((n) => n.data.pinned);
  let section = null;
  for (const n of list) {
    if (hasPinned) {
      const s = n.data.pinned ? 'Pinned' : 'Notes';
      if (s !== section) {
        section = s;
        const h = document.createElement('h4'); h.className = 'section-title'; h.textContent = s; grid.append(h);
      }
    }
    const card = document.createElement('div');
    card.className = 'card' + (n.id === state.openId ? ' selected' : '');
    card.style.setProperty('--c', NOTE_COLORS[n.data.color] || NOTE_COLORS.yellow);
    if (n.data.pinned) { const p = document.createElement('span'); p.className = 'pin'; p.textContent = '📌'; card.append(p); }
    const strokes = n.data.ink?.strokes || [];
    const h = document.createElement('h3');
    h.textContent = n.data.title || (n.data.text ? n.data.text.split('\n')[0].slice(0, 60) : strokes.length ? 'Drawing' : 'Untitled');
    if (!n.data.title) h.classList.add('untitled');
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = noteDate(n.updated_at);
    const todos = (n.data.blocks || []).filter((b) => b.t === 'todo');
    if (todos.length) m.textContent += ` · ${todos.filter((b) => b.d).length}/${todos.length} done`;
    const canvasItems = n.data.ink?.items || [];
    const imgCount = canvasItems.filter((it) => it.k === 'img').length + (n.data.blocks || []).filter((b) => b.t === 'img').length;
    if (imgCount) m.textContent += ` · 🖼 ${imgCount}`;
    card.append(h, m);
    // Without a title the first line is the heading, so the preview starts after it.
    const plain = (n.data.text || '').replace(/^\[image\]$/gm, '🖼');
    const preview = n.data.title ? plain : plain.split('\n').slice(1).join('\n').trim();
    if (preview) { const p = document.createElement('p'); p.textContent = preview; card.append(p); }
    if (strokes.length || canvasItems.length) card.append(thumbnail(strokes, canvasItems));
    if (state.view === 'trash') {
      const row = document.createElement('div'); row.className = 'restore';
      const r = document.createElement('button'); r.textContent = 'Restore';
      r.addEventListener('click', (e) => { e.stopPropagation(); save('note', n.id, n.data, false).then(() => { renderSidebar(); renderList(); }); });
      const d = document.createElement('button'); d.textContent = 'Delete forever';
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this note permanently?')) save('note', n.id, { purged: true }, true).then(() => { renderSidebar(); renderList(); });
      });
      row.append(r, ' ', d);
      card.append(row);
    } else {
      card.addEventListener('click', () => openNote(n.id));
    }
    grid.append(card);
  }
}

function thumbnail(strokes, items = []) {
  const c = document.createElement('canvas');
  const cssW = 320;
  let maxY = 0;
  for (const s of strokes) for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]);
  for (const it of items) maxY = Math.max(maxY, it.k === 'shape' ? Math.max(it.y, it.y + it.h) + 10 : it.y + (it.h || (it.size || 28) * 1.3));
  const s = cssW / INK_W;
  const h = Math.min(maxY + 20, 600) * s;
  const dpr = window.devicePixelRatio || 1;
  c.width = cssW * dpr; c.height = Math.max(h, 10) * dpr;
  c.style.width = `${cssW}px`;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  // images first (underneath), then ink, then labels on top
  for (const it of items.filter((x) => x.k === 'img')) {
    ctx.fillStyle = 'rgba(0,0,0,.07)';
    ctx.fillRect(it.x, it.y, it.w, it.h);
    files.url(it.file).then((u) => {
      if (!u) return;
      const img = new Image();
      img.onload = () => { ctx.save(); ctx.drawImage(img, it.x, it.y, it.w, it.h); ctx.restore(); items.filter((x) => x.k === 'shape').forEach((sh) => CanvasItems.drawShape(ctx, sh)); strokes.forEach((st) => drawStroke(ctx, st)); drawLabels(); };
      img.src = u;
    });
  }
  items.filter((x) => x.k === 'shape').forEach((it) => CanvasItems.drawShape(ctx, it));
  strokes.forEach((st) => drawStroke(ctx, st));
  function drawLabels() {
    for (const it of items.filter((x) => x.k === 'text')) {
      ctx.fillStyle = it.st?.c || '#1f1f1f';
      ctx.font = `${it.st?.b ? '700 ' : ''}${it.size || 28}px system-ui, sans-serif`;
      (it.s || '').split('\n').forEach((line, i) => ctx.fillText(line, it.x + 4, it.y + (it.size || 28) * (1 + i * 1.2)));
    }
  }
  drawLabels();
  return c;
}

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
// Folder menu. Pinned = a column beside the notes (default on laptops); otherwise a slide-out drawer.
const phoneWidth = matchMedia('(max-width: 760px)');
const isPinned = () => document.body.classList.contains('menu-pinned');
const drawerMode = () => !isPinned() || phoneWidth.matches;
function setDrawer(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#scrim').classList.toggle('hidden', !open);
}
function applyPinned(pinned) {
  document.body.classList.toggle('menu-pinned', pinned);
  $('#pin-menu').classList.toggle('on', pinned);
  $('#pin-menu').textContent = pinned ? '📌 Menu kept open' : '📌 Keep open';
  if (pinned) document.body.classList.remove('sidebar-collapsed');
  setDrawer(false);
}
$('#menu-btn').addEventListener('click', () => {
  if (drawerMode()) { setDrawer(!$('#sidebar').classList.contains('open')); return; }
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
});
$('#pin-menu').addEventListener('click', () => {
  const pinned = !isPinned();
  localStorage.setItem('menuPinned', pinned ? '1' : '0');
  applyPinned(pinned);
});
$('#scrim').addEventListener('click', () => setDrawer(false));
phoneWidth.addEventListener('change', () => setDrawer(false));
{
  // Default: kept open on laptops/desktops (mouse or trackpad), a drawer on touch devices.
  const saved = localStorage.getItem('menuPinned');
  applyPinned(saved === null ? matchMedia('(pointer: fine)').matches : saved === '1');
  if (isPinned() && localStorage.getItem('sidebarCollapsed') === '1') document.body.classList.add('sidebar-collapsed');
}
$('#new-note').addEventListener('click', () => newNote());
$('#fab').addEventListener('click', () => newNote());

// ---------------------------------------------------------------- ink drawing
function drawStroke(ctx, st) {
  const p = st.p;
  if (p.length < 3) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = st.c;
  if (st.t === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = st.w * 4;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
    if (p.length === 3) ctx.lineTo(p[0] + 0.1, p[1]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const n = p.length / 3;
  if (n === 1) {
    ctx.fillStyle = st.c;
    ctx.beginPath(); ctx.arc(p[0], p[1], st.w * (0.35 + p[2]) / 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  // Variable-width smoothed line: quadratic segments through midpoints.
  let px = p[0], py = p[1];
  for (let i = 1; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], pr = p[i * 3 + 2];
    const nx = i + 1 < n ? (x + p[(i + 1) * 3]) / 2 : x;
    const ny = i + 1 < n ? (y + p[(i + 1) * 3 + 1]) / 2 : y;
    ctx.lineWidth = st.w * (0.35 + pr);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(x, y, nx, ny);
    ctx.stroke();
    px = nx; py = ny;
  }
  ctx.restore();
}

const ink = {
  canvas: $('#ink'),
  base: document.createElement('canvas'),  // committed strokes, cached
  strokes: [],
  height: DEFAULT_INK_H,
  current: null,
  erasing: false,
  tool: 'pen',
  color: INK_COLORS[0],
  width: 4,
  undo: [],
  penSeen: localStorage.getItem('penSeen') === '1',
  penDown: false,
  finger: null,
  onChange: null,
  frame: 0,

  scale() { return this.canvas.clientWidth / INK_W; },

  load(inkData) {
    this.strokes = (inkData?.strokes || []).slice();
    canvasItems.load(inkData?.items || []);
    // At least enough drawing space to fill the screen below the toolbar.
    const w = this.canvas.parentElement.clientWidth || INK_W;
    const fill = Math.round((window.innerHeight * 0.8) / (w / INK_W));
    this.height = Math.max(inkData?.h || DEFAULT_INK_H, fill);
    this.undo = [];
    this.resize();
  },

  data() { return { h: this.height, strokes: this.strokes, items: canvasItems.items() }; },

  resize() {
    const cssW = this.canvas.parentElement.clientWidth;
    if (!cssW) return;
    const s = cssW / INK_W;
    const dpr = window.devicePixelRatio || 1;
    const cssH = this.height * s;
    this.canvas.style.height = `${cssH}px`;
    for (const c of [this.canvas, this.base]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    this.renderBase();
    canvasItems.relayout();
  },

  ctxFor(c) {
    const ctx = c.getContext('2d');
    const s = (c.width / (window.devicePixelRatio || 1)) / INK_W * (window.devicePixelRatio || 1);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    return ctx;
  },

  renderBase() {
    const ctx = this.base.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    const lctx = this.ctxFor(this.base);
    this.strokes.forEach((st) => drawStroke(lctx, st));
    this.render();
  },

  render() {
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    if (this.current) drawStroke(this.ctxFor(this.canvas), this.current);
    if (this.eraserAt) this.drawEraser(this.ctxFor(this.canvas));
  },

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  },

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    const s = r.width / INK_W;
    const pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [Math.round(((e.clientX - r.left) / s) * 10) / 10, Math.round(((e.clientY - r.top) / s) * 10) / 10, Math.round(pr * 100) / 100];
  },

  pushUndo() { this.undo.push(this.strokes.slice()); if (this.undo.length > 50) this.undo.shift(); },

  // Eraser size follows the size picker: Fine / Medium / Bold.
  eraserRadius() { return { 2: 7, 4: 14, 8: 28 }[this.width] || 14; },

  // Erase only the ink under the eraser: points inside the circle are removed and strokes are split.
  eraseAt([x, y]) {
    const r = this.eraserRadius();
    let changed = false;
    const out = [];
    for (const st of this.strokes) {
      const pad = st.t === 'highlighter' ? st.w * 2 : st.w * 0.6;
      const bb = strokeBox(st);
      if (x < bb[0] - r - pad || x > bb[2] + r + pad || y < bb[1] - r - pad || y > bb[3] + r + pad) { out.push(st); continue; }
      const p = densify(st.p, Math.max(1.5, r / 3));
      const hit = (i) => Math.hypot(p[i] - x, p[i + 1] - y) < r + pad;
      let any = false;
      for (let i = 0; i < p.length; i += 3) if (hit(i)) { any = true; break; }
      if (!any) { out.push(st); continue; }
      changed = true;
      let seg = [];
      const flush = () => { if (seg.length >= 6) out.push({ ...st, p: seg }); seg = []; };
      for (let i = 0; i < p.length; i += 3) {
        if (hit(i)) flush(); else seg.push(p[i], p[i + 1], p[i + 2]);
      }
      flush();
    }
    if (changed) { this.strokes = out; this.renderBase(); }
  },

  // Show the eraser circle while erasing (and when hovering with the eraser).
  drawEraser(ctx) {
    if (!this.eraserAt) return;
    const [x, y] = this.eraserAt;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, this.eraserRadius(), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.stroke();
    ctx.restore();
  },

  growIfNeeded(y) {
    if (y > this.height - 150) { this.height += 500; this.resize(); }
  },

  down(e) {
    if (e.pointerType === 'pen' && !this.penSeen) { this.penSeen = true; localStorage.setItem('penSeen', '1'); }
    if (e.pointerType === 'touch' && (this.penSeen || this.penDown)) {
      // With a stylus around, fingers scroll and palms are ignored.
      if (this.penDown) return;
      const sc = $('#editor-scroll');
      this.finger = { id: e.pointerId, y: e.clientY, top: sc.scrollTop };
      return;
    }
    if (e.button !== 0 && e.button !== 5 && e.pointerType === 'mouse') return;
    if (this.tool === 'text') { e.preventDefault(); const [x, y] = this.point(e); canvasItems.addLabel(x, y); return; }
    if (this.tool === 'select') { canvasItems.deselect(); return; }
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    if (e.pointerType === 'pen') this.penDown = true;
    const pt = this.point(e);
    const penEraser = e.button === 5 || (e.buttons & 32);
    if (this.tool === 'eraser' || penEraser) {
      this.pushUndo();
      this.erasing = true;
      this.eraserAt = pt;
      this.eraseAt(pt);
      this.requestRender();
      return;
    }
    if (this.tool === 'shape') {
      this.shaping = true;
      canvasItems.beginShape(pt[0], pt[1], { shape: shapeOpts.shape, fill: shapeOpts.fill, c: this.color, sw: this.width });
      return;
    }
    this.current = { t: this.tool, c: this.color, w: this.width, p: pt.slice() };
    this.requestRender();
  },

  move(e) {
    if (this.finger && e.pointerId === this.finger.id) {
      $('#editor-scroll').scrollTop = this.finger.top - (e.clientY - this.finger.y);
      return;
    }
    if (this.shaping) { const pt = this.point(e); canvasItems.updateShape(pt[0], pt[1]); return; }
    if (!this.current && !this.erasing) {
      // hovering with the eraser (mouse or pen): show its size
      if (this.tool === 'eraser' && e.pointerType !== 'touch') { this.eraserAt = this.point(e); this.requestRender(); }
      return;
    }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = this.point(ev);
      if (this.erasing) { this.eraserAt = pt; this.eraseAt(pt); continue; }
      const p = this.current.p;
      const lx = p[p.length - 3], ly = p[p.length - 2];
      if (Math.hypot(pt[0] - lx, pt[1] - ly) < 0.8) continue;
      p.push(...pt);
    }
    this.requestRender();
  },

  up(e) {
    if (this.finger && e.pointerId === this.finger.id) { this.finger = null; return; }
    if (e.pointerType === 'pen') this.penDown = false;
    if (this.shaping) { this.shaping = false; canvasItems.endShape(); return; }
    if (this.erasing) {
      this.erasing = false;
      if (e.pointerType === 'touch') this.eraserAt = null;
      this.requestRender();
      this.onChange?.();
      return;
    }
    if (!this.current) return;
    this.pushUndo();
    this.strokes.push(this.current);
    const maxY = Math.max(...this.current.p.filter((_, i) => i % 3 === 1));
    this.current = null;
    this.renderBase();
    this.growIfNeeded(maxY);
    this.onChange?.();
  },

  undoLast() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.strokes = prev;
    this.renderBase();
    this.onChange?.();
  },
};

const canvasItems = CanvasItems.create($('#ink-items'), {
  scale: () => ink.scale(),
  onChange: () => {
    const low = canvasItems.lowestPoint();
    if (low > ink.height - 100) { ink.height = low + 300; ink.resize(); }
    ink.onChange?.();
  },
  fileURL: (id) => files.url(id),
  barHost: $('#item-bar'),
});

function setTool(name) { document.querySelector(`.ink-tools [data-tool="${name}"]`)?.click(); }

// Choosing images: camera, photo gallery, or any file on the device (Downloads, file shares, ...).
const IMAGE_EXTS = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif,.heic,.heif';
function pickImages(anchor, multiple, onFiles) {
  const menu = $('#pick-menu');
  const touch = matchMedia('(pointer: coarse)').matches;
  menu.querySelector('[data-src="camera"]').classList.toggle('hidden', !touch);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 200))}px`;
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - 170)}px`;
  menu.classList.remove('hidden');
  menu.onclick = (e) => {
    const src = e.target.closest('[data-src]')?.dataset.src;
    if (!src) return;
    menu.classList.add('hidden');
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple && src !== 'camera';
    // A list of file types (instead of image/*) makes Android open its full file browser.
    input.accept = src === 'files' ? IMAGE_EXTS : 'image/*';
    if (src === 'camera') input.capture = 'environment';
    input.onchange = () => { const list = [...input.files]; if (list.length) onFiles(list); };
    input.click();
  };
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#pick-menu, #add-image, #text-image')) $('#pick-menu').classList.add('hidden');
});
async function readImage(file) {
  try { return await prepareImage(file); }
  catch {
    const heic = /hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
    throw new Error(heic ? 'HEIC photos can\'t be opened in the browser. Save it as JPEG on the phone (or turn off "High efficiency pictures" in the camera settings) and try again.' : 'that file isn\'t an image this browser can open');
  }
}

// Add images to the drawing area: saved on this device right away, uploaded on the next sync.
$('#add-image').addEventListener('click', () => pickImages($('#add-image'), true, addCanvasImages));
async function addCanvasImages(list) {
  if (!list.length || !state.openId) return;
  // place it where the user is looking
  const sc = $('#editor-scroll');
  const canvasTop = ink.canvas.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  let y = Math.max(20, (20 - canvasTop) / ink.scale() + 20);
  for (const file of list) {
    try {
      const { blob, w, h } = await readImage(file);
      const id = uuid();
      await files.put(id, blob);
      const width = Math.min(700, w * (1 / ink.scale()) * 0.9, 920);
      const height = width * (h / w);
      canvasItems.addImage(id, width, height, 40, y);
      y += height + 20;
    } catch (err) {
      alert(`Couldn't add that image: ${err.message || err}`);
    }
  }
  setTool('select');
}

ink.canvas.addEventListener('pointerdown', (e) => ink.down(e));
ink.canvas.addEventListener('pointermove', (e) => ink.move(e));
ink.canvas.addEventListener('pointerup', (e) => ink.up(e));
ink.canvas.addEventListener('pointercancel', (e) => ink.up(e));
ink.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
ink.canvas.addEventListener('pointerleave', () => { if (!ink.erasing && ink.eraserAt) { ink.eraserAt = null; ink.requestRender(); } });

// helpers for the eraser
const strokeBoxes = new WeakMap();
function strokeBox(st) {
  let b = strokeBoxes.get(st);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < st.p.length; i += 3) {
      b[0] = Math.min(b[0], st.p[i]); b[1] = Math.min(b[1], st.p[i + 1]);
      b[2] = Math.max(b[2], st.p[i]); b[3] = Math.max(b[3], st.p[i + 1]);
    }
    strokeBoxes.set(st, b);
  }
  return b;
}
// add in-between points so long, fast strokes can be erased in the middle too
function densify(p, step) {
  const out = [p[0], p[1], p[2]];
  for (let i = 3; i < p.length; i += 3) {
    const x0 = p[i - 3], y0 = p[i - 2], x1 = p[i], y1 = p[i + 1];
    const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push(Math.round((x0 + (x1 - x0) * t) * 10) / 10, Math.round((y0 + (y1 - y0) * t) * 10) / 10, p[i + 2]);
    }
    out.push(x1, y1, p[i + 2]);
  }
  return out;
}

// ---- shape tool options ----
const shapeOpts = { shape: localStorage.getItem('shapeKind') || 'rect', fill: localStorage.getItem('shapeFill') || null };
document.querySelectorAll('#shape-bar [data-shape]').forEach((b) => {
  b.classList.toggle('on', b.dataset.shape === shapeOpts.shape);
  b.addEventListener('click', () => {
    shapeOpts.shape = b.dataset.shape;
    localStorage.setItem('shapeKind', shapeOpts.shape);
    document.querySelectorAll('#shape-bar [data-shape]').forEach((x) => x.classList.toggle('on', x === b));
  });
});
(function buildShapeFills() {
  const wrap = $('#shape-fills');
  for (const c of CanvasItems.FILL_COLORS) {
    const b = document.createElement('button');
    b.className = `dot${c ? '' : ' none'}${c === '#ffffff' ? ' white' : ''}${(shapeOpts.fill || null) === c ? ' on' : ''}`;
    b.title = c ? 'Fill color' : 'No fill (outline only)';
    if (c) b.style.background = c;
    b.addEventListener('click', () => {
      shapeOpts.fill = c;
      if (c) localStorage.setItem('shapeFill', c); else localStorage.removeItem('shapeFill');
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    wrap.append(b);
  }
})();
let inkWidth = 0;
new ResizeObserver((entries) => {
  const w = Math.round(entries[0].contentRect.width);
  if (w === inkWidth) return;
  inkWidth = w;
  if (state.openId) requestAnimationFrame(() => ink.resize());
}).observe($('#ink-wrap'));

document.querySelectorAll('.ink-tools [data-tool]').forEach((b) => b.addEventListener('click', () => {
  ink.tool = b.dataset.tool;
  document.querySelectorAll('.ink-tools [data-tool]').forEach((x) => x.classList.toggle('active', x === b));
  canvasItems.setMode(ink.tool === 'select' || ink.tool === 'text' ? ink.tool : 'pen');
  $('#shape-bar').classList.toggle('hidden', ink.tool !== 'shape');
  if (ink.tool !== 'eraser' && ink.eraserAt) { ink.eraserAt = null; ink.requestRender(); }
  localStorage.setItem('inkTool', ink.tool);
}));
(function buildInkColors() {
  const wrap = $('#ink-colors');
  INK_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'ink-swatch' + (i === 0 ? ' active' : '');
    b.style.background = c;
    b.title = 'Ink color';
    b.addEventListener('click', () => {
      ink.color = c;
      wrap.querySelectorAll('.ink-swatch').forEach((x) => x.classList.toggle('active', x === b));
    });
    wrap.append(b);
  });
})();
$('#ink-width').addEventListener('change', (e) => { ink.width = Number(e.target.value); });
$('#ink-undo').addEventListener('click', () => ink.undoLast());
$('#ink-more').addEventListener('click', () => { ink.height += 500; ink.resize(); ink.onChange?.(); });

// ---------------------------------------------------------------- editor
const body = BodyEditor.create($('#note-body'), {
  onChange: () => editor.queueSave(),
  onSelectionStyle: (st) => showFormatState(st),
  fileURL: (id) => files.url(id),
});

// Pictures in the text
$('#text-image').addEventListener('pointerdown', (e) => e.preventDefault());
$('#text-image').addEventListener('click', () => pickImages($('#text-image'), false, addTextImage));
async function addTextImage([file]) {
  if (!file || !state.openId) return;
  try {
    const { blob } = await readImage(file);
    const id = uuid();
    await files.put(id, blob);
    body.insertImage(id);
  } catch (err) { alert(`Couldn't add that picture: ${err.message || err}`); }
}

// ---- formatting bar ----
const TEXT_COLORS = [null, '#d32f2f', '#e67700', '#2e7d32', '#1e5bd8', '#8e24aa', '#6d4c41', '#757575', '#ffffff'];
const HIGHLIGHTS = [null, '#fff176', '#b9f6a8', '#a8dcff', '#ffc1d3', '#ffd8a8'];
let lastColor = '#d32f2f';
let lastHighlight = '#fff176';

function showFormatState(st) {
  document.querySelectorAll('.format-tools [data-fmt]').forEach((b) => b.classList.toggle('active', !!st[b.dataset.fmt]));
  $('#fmt-font').value = st.f || '';
  $('#fmt-color-bar').style.background = st.c || '#1f1f1f';
}
function keepFocus(el) { el.addEventListener('pointerdown', (e) => e.preventDefault()); }

document.querySelectorAll('.format-tools [data-fmt]').forEach((b) => {
  keepFocus(b);
  b.addEventListener('click', () => body.format(b.dataset.fmt, 1));
});
$('#fmt-font').addEventListener('change', (e) => body.format('f', e.target.value || null));

function openPalette(anchor, colors, onPick) {
  const pop = $('#fmt-pop');
  if (!pop.classList.contains('hidden') && pop.dataset.for === anchor.id) { pop.classList.add('hidden'); return; }
  pop.textContent = '';
  pop.dataset.for = anchor.id;
  for (const c of colors) {
    const b = document.createElement('button');
    if (c) { b.style.background = c; if (c === '#ffffff') { b.className = 'white'; b.title = 'White'; } }
    else { b.className = 'none'; b.title = anchor.id === 'fmt-hl' ? 'No highlight' : 'Default color'; }
    keepFocus(b);
    b.addEventListener('click', () => { pop.classList.add('hidden'); onPick(c); });
    pop.append(b);
  }
  const host = $('#editor-scroll').getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(0, Math.min(r.left - host.left, host.width - 250))}px`;
  pop.style.top = `${r.bottom - host.top + $('#editor-scroll').scrollTop + 4}px`;
  pop.classList.remove('hidden');
}
keepFocus($('#fmt-color'));
keepFocus($('#fmt-hl'));
$('#fmt-color').addEventListener('click', () => openPalette($('#fmt-color'), TEXT_COLORS, (c) => { if (c) lastColor = c; body.format('c', c); }));
$('#fmt-hl').addEventListener('click', () => openPalette($('#fmt-hl'), HIGHLIGHTS, (c) => {
  if (c) { lastHighlight = c; $('#fmt-hl-bar').style.background = c; }
  body.format('h', c);
}));
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#fmt-pop, #fmt-color, #fmt-hl')) $('#fmt-pop').classList.add('hidden');
});

const editor = {
  saveTimer: null,
  dirty: false,
  busy() {
    return this.dirty || ink.current || ink.erasing || canvasItems.busy() ||
      body.focused() || document.activeElement === $('#note-title');
  },
  load(id) {
    const n = getNote(id);
    if (!n) return;
    const d = n.data;
    $('#note-title').value = d.title || '';
    body.load(BodyEditor.blocksForNote(d));
    $('#note-folder').value = d.folder && state.records.get(keyOf('folder', d.folder)) ? d.folder : '';
    $('#note-pin').classList.toggle('on', !!d.pinned);
    $('#editor').style.setProperty('--c', NOTE_COLORS[d.color] || NOTE_COLORS.yellow);
    document.querySelectorAll('#note-colors .swatch').forEach((s) => s.classList.toggle('active', s.dataset.color === (d.color || 'yellow')));
    ink.load(d.ink);
    if (isPopout) document.title = d.title || 'Note';
  },
  collect() {
    const n = getNote(state.openId);
    const blocks = body.blocks();
    return {
      ...n.data,
      title: $('#note-title').value,
      blocks,
      text: BodyEditor.textFromBlocks(blocks),
      folder: $('#note-folder').value || null,
      ink: ink.data(),
    };
  },
  queueSave(delay = 700) {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), delay);
  },
  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || !state.openId) return;
    this.dirty = false;
    const id = state.openId;
    const data = this.collect();
    if (state.draft && state.draft.id === id) state.draft = null; // first edit makes it real
    await save('note', id, data, false);
    if (isPopout) document.title = data.title || 'Note';
    renderSidebar();
    renderList();
  },
};
ink.onChange = () => editor.queueSave(600);

// List buttons. pointerdown + preventDefault keeps the keyboard open on phones.
document.querySelectorAll('.text-tools [data-line]').forEach((b) => {
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', () => body.setType(b.dataset.line));
});
for (const [sel, fn] of [['#line-indent', () => body.indent()], ['#line-outdent', () => body.outdent()]]) {
  $(sel).addEventListener('pointerdown', (e) => e.preventDefault());
  $(sel).addEventListener('click', fn);
}
$('#clear-done').addEventListener('pointerdown', (e) => e.preventDefault());
$('#clear-done').addEventListener('click', () => body.clearDone());
$('#note-title').addEventListener('input', () => editor.queueSave());
$('#note-folder').addEventListener('change', () => editor.queueSave(0));
$('#note-pin').addEventListener('click', () => {
  const n = getNote(state.openId);
  n.data = { ...n.data, pinned: !n.data.pinned };
  $('#note-pin').classList.toggle('on', n.data.pinned);
  editor.queueSave(0);
});
(function buildNoteColors() {
  const wrap = $('#note-colors');
  Object.entries(NOTE_COLORS).forEach(([name, hex]) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = name;
    b.style.background = hex;
    b.title = name;
    b.addEventListener('click', () => {
      const n = getNote(state.openId);
      n.data = { ...n.data, color: name };
      $('#editor').style.setProperty('--c', hex);
      wrap.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
      editor.queueSave(0);
    });
    wrap.append(b);
  });
})();

$('#note-delete').addEventListener('click', async () => {
  const id = state.openId;
  if (!id) return;
  if (state.draft && state.draft.id === id) { closeEditor(); return; }
  await editor.flush();
  const n = getNote(id);
  await save('note', id, n.data, true);
  if (isPopout) { window.close(); return; }
  closeEditor();
  renderSidebar(); renderList();
});

$('#note-popout').addEventListener('click', async () => {
  const id = state.openId;
  await editor.flush();
  if (state.draft && state.draft.id === id) { await save('note', id, editor.collect()); state.draft = null; }
  window.open(`/?popout=1&note=${encodeURIComponent(id)}`, `note-${id}`, 'width=440,height=600');
  closeEditor();
});

$('#back').addEventListener('click', () => { if (history.state?.note) history.back(); else closeEditor(); });
window.addEventListener('popstate', () => { if (state.openId && !history.state?.note) closeEditor(true); });

function openNote(id, { pushHistory = true, focus } = {}) {
  if (state.openId && state.openId !== id) editor.flush();
  state.openId = id;
  $('#editor').classList.remove('hidden');
  editor.load(id);
  if (pushHistory && !isPopout && !history.state?.note) history.pushState({ note: id }, '');
  else if (pushHistory && !isPopout) history.replaceState({ note: id }, '');
  renderList();
  if (focus === 'text') body.focusEnd();
}

function closeEditor(fromPopstate = false) {
  editor.flush();
  if (state.draft && state.draft.id === state.openId) state.draft = null;
  state.openId = null;
  $('#editor').classList.add('hidden');
  if (!fromPopstate && history.state?.note) history.replaceState(null, '');
  renderList();
}

function newNote(mode = 'text') {
  const folder = !['all', 'inbox', 'trash'].includes(state.view) ? state.view : null;
  const id = uuid();
  state.draft = {
    key: keyOf('note', id), kind: 'note', id, updated_at: Date.now(), deleted: false,
    data: { title: '', text: '', folder, color: 'yellow', pinned: false, ink: { h: DEFAULT_INK_H, strokes: [] }, created: Date.now() },
  };
  openNote(id, { focus: mode === 'text' && !ink.penSeen ? 'text' : null });
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && state.openId && document.activeElement?.tagName !== 'INPUT' && !body.focused()) {
    e.preventDefault(); ink.undoLast();
  }
  if (e.key === 'Escape' && state.openId && !isPopout) closeEditor();
});

// ---------------------------------------------------------------- startup
function renderAll() { renderSidebar(); renderList(); renderSyncStatus(); }

async function init() {
  if (isPopout) document.body.classList.add('popout');
  await idb.open();
  for (const r of await idb.all('records')) state.records.set(r.key, r);
  state.token = await meta.get('token');
  state.pending = (await idb.all('outbox')).length;

  const savedTool = localStorage.getItem('inkTool');
  if (savedTool) document.querySelector(`.ink-tools [data-tool="${savedTool}"]`)?.click();

  if (!state.token) { showLogin(); return; }
  showApp();
  renderAll();

  if (isPopout && params.get('note')) openNote(params.get('note'), { pushHistory: false });
  else if (params.has('new')) { history.replaceState(null, '', '/'); newNote(params.get('new')); }

  sync();
  checkForUpdate();
  setInterval(() => { sync(); checkForUpdate(); }, SYNC_INTERVAL);
}

// Tell the user when the server is running a newer version than this window.
async function checkForUpdate() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== APP_VERSION) $('#update-banner').classList.remove('hidden');
  } catch { /* offline */ }
}
$('#update-reload').addEventListener('click', async () => {
  await editor.flush();
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update().catch(() => {});
  location.reload();
});

bc?.addEventListener('message', (e) => { if (e.data?.type === 'changed') reloadKeys(e.data.keys); });
window.addEventListener('online', () => { state.online = true; sync(); });
window.addEventListener('offline', () => { state.online = false; renderSyncStatus(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') editor.flush();
  else sync();
});
window.addEventListener('pagehide', () => editor.flush());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init();
