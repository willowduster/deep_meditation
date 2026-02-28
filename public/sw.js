/* ── Deep Meditation — Service Worker ─────────────────────────────────── */
'use strict';

const CACHE = 'deep-meditation-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/audio.js',
  '/audio-export.js',
  '/meditation.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// ── Install: pre-cache shell ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────
// - API / auth routes → network only
// - Everything else  → cache first, fall back to network and update cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always hit network for API, auth, and non-GET requests
  if (e.request.method !== 'GET' ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/')) {
    return; // let browser handle normally
  }

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request)
        .then(res => {
          if (res && res.status === 200) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);

      return cached || fetchPromise;
    })
  );
});
