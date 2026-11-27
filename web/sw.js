// App-shell cache so the web app opens offline. API calls always go to the network.
const VERSION = 'notes-__APP_VERSION__';
const SHELL = ['/', '/index.html', '/body-editor.js?v=__APP_VERSION__', '/canvas-items.js?v=__APP_VERSION__', '/app.js?v=__APP_VERSION__', '/style.css?v=__APP_VERSION__', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/fonts/serif.woff2', '/fonts/serif-bold.woff2', '/fonts/mono.woff2', '/fonts/mono-bold.woff2', '/fonts/hand.woff2', '/fonts/round.woff2', '/fonts/round-bold.woff2',
  '/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (so updates show up), falling back to the cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname + url.search)) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// Tapping a reminder notification opens (or focuses) the app on that note.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data?.id;
  const url = id ? `/?open=${encodeURIComponent(id)}` : '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === location.origin && 'focus' in c) { c.postMessage({ type: 'open-note', id }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
