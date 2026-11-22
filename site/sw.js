// Offline-Speicher: Seite aus dem Speicher, Daten immer zuerst aus dem Netz.
const CACHE = 'spielplan-v1';
const STATIC = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'fonts/barlow-condensed-500.woff2', 'fonts/barlow-condensed-700.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.endsWith('/data.json')) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('data.json', copy)); }
      return res;
    }).catch(() => caches.match('data.json')));
    return;
  }

  // Seite selbst: Netz zuerst, damit neue Versionen sofort ankommen.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
