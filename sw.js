const C = 'lite-notes-v1';
const A = ['./', 'index.html', 'styles.css?v=1', 'dist/main.js?v=1', 'manifest.json', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png'];
// new versions take over immediately and old caches are removed
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(A)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === location.origin; if (!same) return;
  // network-first (bypassing HTTP cache) so updates are never stale; cache keeps it working offline
  e.respondWith(fetch(new Request(e.request, { cache: 'no-cache' })).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: false }).then(r => r || caches.match('./'))));
});
