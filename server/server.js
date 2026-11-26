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

if (!PASSWORD || PASSWORD.length < 8) {
  console.error('NOTES_PASSWORD must be set (at least 8 characters).');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
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
  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', '0');
`);

const q = {
  getRev: db.prepare("SELECT CAST(v AS INTEGER) AS rev FROM meta WHERE k = 'rev'"),
  setRev: db.prepare("UPDATE meta SET v = ? WHERE k = 'rev'"),
  getRecord: db.prepare('SELECT updated_at FROM records WHERE kind = ? AND id = ?'),
  upsert: db.prepare(`
    INSERT INTO records (kind, id, data, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, id) DO UPDATE SET
      data = excluded.data, updated_at = excluded.updated_at,
      deleted = excluded.deleted, rev = excluded.rev`),
  changesSince: db.prepare(
    'SELECT kind, id, data, updated_at, deleted, rev FROM records WHERE rev > ? ORDER BY rev LIMIT ?'),
  addToken: db.prepare('INSERT INTO tokens (hash, device, created_at, last_used) VALUES (?, ?, ?, ?)'),
  findToken: db.prepare('SELECT hash, last_used FROM tokens WHERE hash = ?'),
  touchToken: db.prepare('UPDATE tokens SET last_used = ? WHERE hash = ?'),
  delToken: db.prepare('DELETE FROM tokens WHERE hash = ?'),
  listTokens: db.prepare('SELECT device, created_at, last_used FROM tokens ORDER BY last_used DESC'),
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

async function handleSync(req, res) {
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
      // Last write wins, by the client's edit time.
      if (existing && existing.updated_at >= c.updated_at) continue;
      rev++;
      q.upsert.run(c.kind, c.id, JSON.stringify(c.data), Math.trunc(c.updated_at), c.deleted ? 1 : 0, rev);
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

// --- static files ---
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // app routes fall back to the app shell
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file);
    const cache = ext === '.html' || path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(buf);
  });
}

// --- router ---
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/health') return send(res, 200, { ok: true });
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname.startsWith('/api/')) {
      const token = authenticate(req);
      if (!token) return send(res, 401, { error: 'Not signed in' });
      if (pathname === '/api/sync' && req.method === 'POST') return await handleSync(req, res);
      if (pathname === '/api/logout' && req.method === 'POST') { q.delToken.run(token); return send(res, 200, { ok: true }); }
      if (pathname === '/api/devices' && req.method === 'GET') return send(res, 200, { devices: q.listTokens.all() });
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

server.listen(PORT, () => console.log(`Notes server listening on :${PORT} (data: ${DATA_DIR})`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(); db.close(); process.exit(0); });
}
