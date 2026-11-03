/* LetsConvertPDF service worker: makes the app installable and keeps the
   on-device tools working offline. It never touches /api/ requests or any
   file the user processes; those never go through the network anyway. */
const VERSION = 'lcpdf-r2-3';
const SHELL = ['/', '/js/engine.js', '/js/tools.jsx', '/js/r2.jsx', '/js/r3.jsx', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const CDN = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lcpdf-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // Pages: network first so updates arrive, cached copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((r) => r || caches.match('/'))));
    return;
  }

  // Versioned engines and CDN libraries never change: cache first.
  if ((sameOrigin && url.pathname.startsWith('/vendor/')) || CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
    return;
  }

  // Our own scripts and icons: network first so they always match the page,
  // cached copy when offline.
  if (sameOrigin) e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req)));
});
