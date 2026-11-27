// Notes server: auth, sync API and static web app. No external dependencies.
// Requires Node 22.13+ (built-in node:sqlite).
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '..', 'web');
const PASSWORD = process.env.NOTES_PASSWORD || '';
const MAX_BODY = 25 * 1024 * 1024; // ink-heavy syncs can be large
const PAGE_SIZE = 500;
const KINDS = new Set(['note', 'folder']);
const APP_VERSION = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); } catch { return 'dev'; }
})();
// Files that carry the version number (filled in when served).
const VERSIONED = new Set(['.html', '.js']);

if (!PASSWORD || PASSWORD.length < 8) {
  console.error('NOTES_PASSWORD must be set (at least 8 characters).');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });
const MAX_FILE = 20 * 1024 * 1024;
const FILE_ID = /^[A-Za-z0-9-]{8,64}$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const db = new DatabaseSync(path.join(DATA_DIR, 'notes.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS note_versions (
    vid INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    device TEXT,
    reason TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS note_versions_by_note ON note_versions (kind, id, saved_at);
  INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', '0');
`);
// Which device last wrote each record (for version history).
if (!db.prepare("SELECT 1 FROM pragma_table_info('records') WHERE name = 'device'").get()) {
  db.exec('ALTER TABLE records ADD COLUMN device TEXT');
}

const q = {
  getRev: db.prepare("SELECT CAST(v AS INTEGER) AS rev FROM meta WHERE k = 'rev'"),
  setRev: db.prepare("UPDATE meta SET v = ? WHERE k = 'rev'"),
  getRecord: db.prepare('SELECT data, updated_at, deleted, device FROM records WHERE kind = ? AND id = ?'),
  upsert: db.prepare(`
    INSERT INTO records (kind, id, data, updated_at, deleted, rev, device) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, id) DO UPDATE SET
      data = excluded.data, updated_at = excluded.updated_at,
      deleted = excluded.deleted, rev = excluded.rev, device = excluded.device`),
  lastVersionAt: db.prepare('SELECT MAX(saved_at) AS t FROM note_versions WHERE kind = ? AND id = ?'),
  addVersion: db.prepare(`INSERT INTO note_versions (kind, id, data, updated_at, deleted, device, reason, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  listVersions: db.prepare(`SELECT v.vid, v.updated_at, v.deleted, v.reason, v.saved_at, v.data, t.device AS device_name
    FROM note_versions v LEFT JOIN tokens t ON t.hash = v.device
    WHERE v.kind = ? AND v.id = ? ORDER BY v.updated_at DESC LIMIT 100`),
  getVersion: db.prepare('SELECT vid, kind, id, data, updated_at, deleted FROM note_versions WHERE vid = ?'),
  deviceName: db.prepare('SELECT device FROM tokens WHERE hash = ?'),
  allRecords: db.prepare('SELECT kind, id, data, updated_at, deleted FROM records'),
  changesSince: db.prepare(
    'SELECT kind, id, data, updated_at, deleted, rev FROM records WHERE rev > ? ORDER BY rev LIMIT ?'),
  addToken: db.prepare('INSERT INTO tokens (hash, device, created_at, last_used) VALUES (?, ?, ?, ?)'),
  findToken: db.prepare('SELECT hash, last_used FROM tokens WHERE hash = ?'),
  touchToken: db.prepare('UPDATE tokens SET last_used = ? WHERE hash = ?'),
  delToken: db.prepare('DELETE FROM tokens WHERE hash = ?'),
  listTokens: db.prepare('SELECT device, created_at, last_used FROM tokens ORDER BY last_used DESC'),
  getFile: db.prepare('SELECT id, type, size FROM files WHERE id = ?'),
  addFile: db.prepare('INSERT OR REPLACE INTO files (id, type, size, created_at) VALUES (?, ?, ?, ?)'),
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const passwordHash = Buffer.from(sha256(PASSWORD), 'hex');

// --- login rate limiting (per IP, in memory) ---
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { count: 0, since: now };
  if (now - a.since > 15 * 60 * 1000) { a.count = 0; a.since = now; }
  attempts.set(ip, a);
  return a.count >= 10;
}
function recordFailure(ip) { const a = attempts.get(ip); if (a) a.count++; }

// --- helpers ---
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : 'text/plain',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
}

function authenticate(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const hash = sha256(m[1]);
  const row = q.findToken.get(hash);
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_used > 60 * 60 * 1000) q.touchToken.run(now, hash);
  return hash;
}

function validChange(c) {
  return c && KINDS.has(c.kind) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 64 &&
    Number.isFinite(c.updated_at) && c.data !== undefined;
}

// --- API handlers ---
async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
  const body = await readJson(req);
  const given = Buffer.from(sha256(String(body.password || '')), 'hex');
  if (!crypto.timingSafeEqual(given, passwordHash)) {
    recordFailure(ip);
    return send(res, 401, { error: 'Wrong password' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  q.addToken.run(sha256(token), String(body.device || 'unknown').slice(0, 100), now, now);
  send(res, 200, { token });
}

// --- version history ---
// Before a note is overwritten, keep the old copy when the change comes from a different device,
// when the note is deleted, or at most every 10 minutes while editing on one device.
// Edits that lose a sync conflict (an older edit arriving late) are kept too, so nothing is lost.
const VERSION_GAP = 10 * 60 * 1000;
function keepVersion(kind, id, rec, device, reason) {
  q.addVersion.run(kind, id, rec.data, rec.updated_at, rec.deleted ? 1 : 0, device || null, reason, Date.now());
}

async function handleSync(req, res, token) {
  const body = await readJson(req);
  const since = Number.isFinite(body.since) ? body.since : 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  let applied = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    let rev = q.getRev.get().rev;
    for (const c of changes) {
      if (!validChange(c)) continue;
      const existing = q.getRecord.get(c.kind, c.id);
      const json = JSON.stringify(c.data);
      // Last write wins, by the client's edit time.
      if (existing && existing.updated_at >= c.updated_at) {
        if (c.kind === 'note' && existing.updated_at > c.updated_at && json !== existing.data) {
          keepVersion(c.kind, c.id, { data: json, updated_at: Math.trunc(c.updated_at), deleted: c.deleted }, token, 'conflict');
        }
        continue;
      }
      if (existing && c.kind === 'note' && existing.data !== json) {
        const last = q.lastVersionAt.get(c.kind, c.id).t || 0;
        const otherDevice = existing.device && existing.device !== token;
        const deleting = c.deleted && !existing.deleted;
        if (c.restore || otherDevice || deleting || Date.now() - last > VERSION_GAP) {
          keepVersion(c.kind, c.id, existing, existing.device, c.restore ? 'before-restore' : deleting ? 'before-delete' : otherDevice ? 'other-device' : 'periodic');
        }
      }
      rev++;
      q.upsert.run(c.kind, c.id, json, Math.trunc(c.updated_at), c.deleted ? 1 : 0, rev, token);
      applied++;
    }
    q.setRev.run(String(rev));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const rows = q.changesSince.all(since, PAGE_SIZE + 1);
  const more = rows.length > PAGE_SIZE;
  if (more) rows.pop();
  const out = rows.map((r) => ({
    kind: r.kind, id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at, deleted: !!r.deleted, rev: r.rev,
  }));
  const rev = more ? out[out.length - 1].rev : q.getRev.get().rev;
  send(res, 200, { rev, more, applied, changes: out });
}

function previewOf(dataJson) {
  try {
    const d = JSON.parse(dataJson);
    return {
      title: d.title || '',
      text: String(d.text || '').slice(0, 160),
      ink: (d.ink?.strokes?.length || 0) + (d.ink?.items?.length || 0),
      purged: !!d.purged,
    };
  } catch { return { title: '', text: '', ink: 0 }; }
}

function handleVersions(req, res, url) {
  const id = url.searchParams.get('id') || '';
  const current = q.getRecord.get('note', id);
  const list = q.listVersions.all('note', id).map((v) => ({
    vid: v.vid, updated_at: v.updated_at, saved_at: v.saved_at, deleted: !!v.deleted, reason: v.reason,
    device: v.device_name || null, ...previewOf(v.data),
  }));
  send(res, 200, {
    current: current ? { updated_at: current.updated_at, device: current.device ? (q.deviceName.get(current.device)?.device || null) : null, ...previewOf(current.data) } : null,
    versions: list,
  });
}

function handleGetVersion(req, res, vid) {
  const v = q.getVersion.get(vid);
  if (!v) return send(res, 404, { error: 'Not found' });
  send(res, 200, { vid: v.vid, kind: v.kind, id: v.id, data: JSON.parse(v.data), updated_at: v.updated_at, deleted: !!v.deleted });
}

// --- export: everything in one file (optionally with images) ---
function handleExport(req, res, url) {
  const withImages = url.searchParams.get('images') === '1';
  const records = q.allRecords.all()
    .filter((r) => !(r.deleted && JSON.parse(r.data).purged))
    .map((r) => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at, deleted: !!r.deleted }));
  const out = { app: 'notes', format: 1, version: APP_VERSION, exported_at: Date.now(), records, files: [] };
  if (withImages) {
    for (const id of referencedFiles(records)) {
      const row = q.getFile.get(id);
      if (!row) continue;
      try { out.files.push({ id, type: row.type, data: fs.readFileSync(path.join(FILES_DIR, id)).toString('base64') }); } catch { /* missing */ }
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="notes-export-${stamp}.json"`,
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(out));
}

// image ids referenced by notes (drawing area and text)
function referencedFiles(records) {
  const ids = new Set();
  for (const r of records) {
    const d = typeof r.data === 'string' ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : r.data;
    for (const it of d?.ink?.items || []) if (it.k === 'img' && it.file) ids.add(it.file);
    for (const b of d?.blocks || []) if (b.t === 'img' && b.file) ids.add(b.file);
  }
  return ids;
}

// --- housekeeping: nightly snapshot, trash after 30 days, old versions, unused images ---
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const DAY = 24 * 60 * 60 * 1000;
function housekeeping() {
  const now = Date.now();
  try {
    // 1. Daily consistent copy of the database (safe for restic/Backrest to back up), keep 14.
    const today = new Date().toISOString().slice(0, 10);
    const snap = path.join(BACKUP_DIR, `notes-${today}.db`);
    if (!fs.existsSync(snap)) {
      db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
      const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^notes-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.unlinkSync(path.join(BACKUP_DIR, f));
    }

    // 2. Empty the trash: notes deleted more than 30 days ago are removed for good (on every device).
    const expired = db.prepare("SELECT kind, id, data FROM records WHERE kind = 'note' AND deleted = 1 AND updated_at < ?").all(now - 30 * DAY)
      .filter((r) => { try { return !JSON.parse(r.data).purged; } catch { return true; } });
    if (expired.length) {
      db.exec('BEGIN IMMEDIATE');
      let rev = q.getRev.get().rev;
      for (const r of expired) {
        rev++;
        q.upsert.run(r.kind, r.id, JSON.stringify({ purged: true }), now, 1, rev, null);
        db.prepare('DELETE FROM note_versions WHERE kind = ? AND id = ?').run(r.kind, r.id);
      }
      q.setRev.run(String(rev));
      db.exec('COMMIT');
    }

    // 3. Old versions: keep 90 days, and at most 50 per note.
    db.prepare('DELETE FROM note_versions WHERE saved_at < ?').run(now - 90 * DAY);
    db.exec(`DELETE FROM note_versions WHERE vid IN (
      SELECT vid FROM (SELECT vid, ROW_NUMBER() OVER (PARTITION BY kind, id ORDER BY saved_at DESC) AS n FROM note_versions) WHERE n > 50)`);

    // 4. Images no note (or saved version) uses any more, after a week's grace period.
    const used = referencedFiles([
      ...q.allRecords.all(),
      ...db.prepare('SELECT data FROM note_versions').all(),
    ]);
    const unused = db.prepare('SELECT id FROM files WHERE created_at < ?').all(now - 7 * DAY).filter((f) => !used.has(f.id));
    for (const f of unused) {
      try { fs.unlinkSync(path.join(FILES_DIR, f.id)); } catch { /* already gone */ }
      db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    }
    if (expired.length || unused.length) console.log(`Housekeeping: emptied ${expired.length} from trash, removed ${unused.length} unused image(s)`);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ }
    console.error('Housekeeping failed:', e);
  }
}
setTimeout(housekeeping, 60 * 1000);
setInterval(housekeeping, 6 * 60 * 60 * 1000);

// --- files (images) ---
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('File too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handlePutFile(req, res, id) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!IMAGE_TYPES.has(type)) return send(res, 415, { error: 'Only images are supported' });
  if (q.getFile.get(id)) { req.resume(); return send(res, 200, { ok: true, existed: true }); }
  const buf = await readBody(req, MAX_FILE);
  const tmp = path.join(FILES_DIR, `${id}.tmp`);
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, path.join(FILES_DIR, id));
  q.addFile.run(id, type, buf.length, Date.now());
  send(res, 200, { ok: true });
}

function handleGetFile(req, res, id) {
  const row = q.getFile.get(id);
  if (!row) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, {
    'Content-Type': row.type,
    'Content-Length': row.size,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(path.join(FILES_DIR, id)).pipe(res);
}

// --- static files ---
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // app routes fall back to the app shell
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    // Always revalidate (cheap 304s via ETag) so the page, code and styles never get out of step,
    // whatever browser or Cloudflare caching is in between.
    const ext = path.extname(file);
    const etag = `"${APP_VERSION}-${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    fs.readFile(file, (err2, buf) => {
      if (err2) return send(res, 404, 'Not found');
      if (VERSIONED.has(ext)) buf = Buffer.from(buf.toString('utf8').replaceAll('__APP_VERSION__', APP_VERSION));
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
}

// --- router ---
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/health') return send(res, 200, { ok: true, version: APP_VERSION });
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname.startsWith('/api/')) {
      const token = authenticate(req);
      if (!token) return send(res, 401, { error: 'Not signed in' });
      if (pathname === '/api/sync' && req.method === 'POST') return await handleSync(req, res, token);
      if (pathname === '/api/versions' && req.method === 'GET') return handleVersions(req, res, new URL(req.url, 'http://localhost'));
      const vm = /^\/api\/versions\/(\d+)$/.exec(pathname);
      if (vm && req.method === 'GET') return handleGetVersion(req, res, Number(vm[1]));
      if (pathname === '/api/export' && req.method === 'GET') return handleExport(req, res, new URL(req.url, 'http://localhost'));
      if (pathname === '/api/logout' && req.method === 'POST') { q.delToken.run(token); return send(res, 200, { ok: true }); }
      if (pathname === '/api/devices' && req.method === 'GET') return send(res, 200, { devices: q.listTokens.all() });
      const fm = /^\/api\/files\/([^/]+)$/.exec(pathname);
      if (fm) {
        const id = fm[1];
        if (!FILE_ID.test(id)) return send(res, 400, { error: 'Bad file id' });
        if (req.method === 'PUT') return await handlePutFile(req, res, id);
        if (req.method === 'GET') return handleGetFile(req, res, id);
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : e.message });
  }
});

if (process.env.HOUSEKEEPING_NOW === '1') setTimeout(housekeeping, 500);
server.listen(PORT, () => console.log(`Notes server ${APP_VERSION} listening on :${PORT} (data: ${DATA_DIR})`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(); db.close(); process.exit(0); });
}
