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
  el.textContent = `Something went wrong: ${msg}. Try closing and reopening the app.`;
}
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message || String(e.reason)));
const params = new URLSearchParams(location.search);
const isPopout = params.has('popout');

// ---------------------------------------------------------------- storage
const idb = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('notes-app', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('records', { keyPath: 'key' });
        db.createObjectStore('outbox', { keyPath: 'key' });
        db.createObjectStore('meta', { keyPath: 'k' });
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
    b.addEventListener('click', () => { state.view = it.id; setDrawer(false); renderSidebar(); renderList(); });
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

function visibleNotes() {
  const folderIds = new Set(folders().map((f) => f.id));
  const q = state.query.trim().toLowerCase();
  return notes().filter((n) => {
    if (state.view === 'trash') { if (!n.deleted || n.data.purged) return false; }
    else {
      if (n.deleted) return false;
      if (state.view === 'inbox' && n.data.folder && folderIds.has(n.data.folder)) return false;
      if (state.view !== 'all' && state.view !== 'inbox' && n.data.folder !== state.view) return false;
    }
    if (q && !`${n.data.title} ${n.data.text}`.toLowerCase().includes(q)) return false;
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
    card.append(h, m);
    // Without a title the first line is the heading, so the preview starts after it.
    const preview = n.data.title ? n.data.text : (n.data.text || '').split('\n').slice(1).join('\n').trim();
    if (preview) { const p = document.createElement('p'); p.textContent = preview; card.append(p); }
    if (strokes.length) card.append(thumbnail(strokes));
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

function thumbnail(strokes) {
  const c = document.createElement('canvas');
  const cssW = 320;
  let maxY = 0;
  for (const s of strokes) for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]);
  const s = cssW / INK_W;
  const h = Math.min(maxY + 20, 600) * s;
  const dpr = window.devicePixelRatio || 1;
  c.width = cssW * dpr; c.height = Math.max(h, 10) * dpr;
  c.style.width = `${cssW}px`;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  strokes.forEach((st) => drawStroke(ctx, st));
  return c;
}

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
// Folder menu: a slide-out drawer on narrower screens, a collapsible column on wide ones.
const drawerMode = matchMedia('(max-width: 1100px)');
function setDrawer(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#scrim').classList.toggle('hidden', !open);
}
$('#menu-btn').addEventListener('click', () => {
  if (drawerMode.matches) { setDrawer(!$('#sidebar').classList.contains('open')); return; }
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
});
$('#scrim').addEventListener('click', () => setDrawer(false));
drawerMode.addEventListener('change', () => setDrawer(false));
if (localStorage.getItem('sidebarCollapsed') === '1') document.body.classList.add('sidebar-collapsed');
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
    // At least enough drawing space to fill the screen below the toolbar.
    const w = this.canvas.parentElement.clientWidth || INK_W;
    const fill = Math.round((window.innerHeight * 0.8) / (w / INK_W));
    this.height = Math.max(inkData?.h || DEFAULT_INK_H, fill);
    this.undo = [];
    this.resize();
  },

  data() { return { h: this.height, strokes: this.strokes }; },

  resize() {
    const cssW = this.canvas.parentElement.clientWidth;
    if (!cssW) return;
    const s = cssW / INK_W;
    const dpr = window.devicePixelRatio || 1;
    const cssH = this.height * s;
    this.canvas.style.height = `${cssH}px`;
    for (const c of [this.canvas, this.base]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    this.renderBase();
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

  eraseAt([x, y]) {
    const r = 14;
    const before = this.strokes.length;
    this.strokes = this.strokes.filter((st) => {
      const pad = st.t === 'highlighter' ? st.w * 2 : st.w;
      for (let i = 0; i < st.p.length; i += 3) {
        if (Math.hypot(st.p[i] - x, st.p[i + 1] - y) < r + pad) return false;
      }
      return true;
    });
    if (this.strokes.length !== before) this.renderBase();
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
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    if (e.pointerType === 'pen') this.penDown = true;
    const pt = this.point(e);
    const penEraser = e.button === 5 || (e.buttons & 32);
    if (this.tool === 'eraser' || penEraser) {
      this.pushUndo();
      this.erasing = true;
      this.eraseAt(pt);
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
    if (!this.current && !this.erasing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = this.point(ev);
      if (this.erasing) { this.eraseAt(pt); continue; }
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
    if (this.erasing) {
      this.erasing = false;
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

ink.canvas.addEventListener('pointerdown', (e) => ink.down(e));
ink.canvas.addEventListener('pointermove', (e) => ink.move(e));
ink.canvas.addEventListener('pointerup', (e) => ink.up(e));
ink.canvas.addEventListener('pointercancel', (e) => ink.up(e));
ink.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
new ResizeObserver(() => { if (state.openId) ink.resize(); }).observe($('#ink-wrap'));

document.querySelectorAll('.ink-tools [data-tool]').forEach((b) => b.addEventListener('click', () => {
  ink.tool = b.dataset.tool;
  document.querySelectorAll('.ink-tools [data-tool]').forEach((x) => x.classList.toggle('active', x === b));
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
const editor = {
  saveTimer: null,
  dirty: false,
  busy() {
    return this.dirty || ink.current || ink.erasing ||
      document.activeElement === $('#note-text') || document.activeElement === $('#note-title');
  },
  load(id) {
    const n = getNote(id);
    if (!n) return;
    const d = n.data;
    $('#note-title').value = d.title || '';
    $('#note-text').value = d.text || '';
    $('#note-folder').value = d.folder && state.records.get(keyOf('folder', d.folder)) ? d.folder : '';
    $('#note-pin').classList.toggle('on', !!d.pinned);
    $('#editor').style.setProperty('--c', NOTE_COLORS[d.color] || NOTE_COLORS.yellow);
    document.querySelectorAll('#note-colors .swatch').forEach((s) => s.classList.toggle('active', s.dataset.color === (d.color || 'yellow')));
    autosize();
    ink.load(d.ink);
    if (isPopout) document.title = d.title || 'Note';
  },
  collect() {
    const n = getNote(state.openId);
    return {
      ...n.data,
      title: $('#note-title').value,
      text: $('#note-text').value,
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

function autosize() { const t = $('#note-text'); t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
$('#note-text').addEventListener('input', () => { autosize(); editor.queueSave(); });
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
  if (focus === 'text') $('#note-text').focus();
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && state.openId && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
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
  setInterval(sync, SYNC_INTERVAL);
}

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
