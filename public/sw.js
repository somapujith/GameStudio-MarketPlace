// Jalebi Games service worker: Web Push notifications + a branded offline page.
//
// What it caches: /offline.html and its tiny script /offline.js (the page shown when a navigation fails because there is no network).
// What it never touches: /api/*, /ws/*, hashed assets, images, scripts, or any page that loads: every request goes
// straight to the network exactly as if no service worker were installed, so a deploy is never served stale.
// Only a failed top-level navigation (page load / reload / link click) is answered from the cache.
//
// Updates: `skipWaiting` + `clients.claim` make a new version of this file take over silently. Because it keeps no
// copy of the app shell or its chunks, the page-side recovery in src/main.jsx (`vite:preloadError` -> one reload)
// is all that is needed after a deploy; the two never fight each other.
//
// Bump CACHE_VERSION whenever offline.html or offline.js changes. Push payload (worker/push.js): { title, body, url, tag }.

const CACHE_VERSION = 'v1';
const CACHE = `gamehub-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
const OFFLINE_SCRIPT = '/offline.js';

// PNG: Android / iOS do not render SVG notification icons. The badge is a white silhouette (Android tints it).
const ICON = '/icons/jalebi-192.png';
const BADGE = '/icons/badge-96.png';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        // Stored as a clean (non-redirected) response: the static host may redirect /offline.html -> /offline, and a
        // redirected response cannot answer a navigation.
        const res = await fetch(new Request(OFFLINE_URL, { cache: 'reload' }));
        if (!res.ok) throw new Error('offline page unavailable');
        await cache.put(OFFLINE_URL, new Response(await res.blob(), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
        await cache.add(new Request(OFFLINE_SCRIPT, { cache: 'reload' }));
      } catch {
        /* caches unavailable or offline right now: push still works, the offline page is just not available yet */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache that is not the current version (older builds, other names).
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      } catch {
        /* caches unavailable */
      }
      await self.clients.claim();
    })(),
  );
});

// The offline page's own script is served from the cache (it is only ever requested by that page).
// Network first, always. Only when a page navigation itself fails (offline) do we show the offline page.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method === 'GET' && new URL(req.url).pathname === OFFLINE_SCRIPT) {
    event.respondWith(caches.match(OFFLINE_SCRIPT).then((hit) => hit || fetch(req)));
    return;
  }
  if (req.mode !== 'navigate' || req.method !== 'GET') return; // everything else: untouched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return (
        cached ||
        new Response('You are offline. Reconnect and reload Jalebi Games.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      );
    }),
  );
});

/** Only same-origin paths are ever opened ('/join/ABCD23'); anything else falls back to the hub. */
function safePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return '/';
  return url.slice(0, 200);
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'Jalebi Games';
  const options = {
    body: typeof data.body === 'string' ? data.body.slice(0, 300) : '',
    icon: ICON,
    badge: BADGE,
    data: { url: safePath(data.url) },
  };
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag.slice(0, 64); // a repeated invite replaces the previous notification
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      // Reuse an open app window (navigate it), else open a new one.
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open && 'navigate' in open) {
        try {
          const nav = await open.navigate(target);
          return (nav || open).focus();
        } catch {
          /* not controlled by this worker: fall through */
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
