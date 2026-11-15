// GameHub service worker: Web Push notifications only.
//
// There is deliberately NO fetch handler: every request goes straight to the network exactly as if no
// service worker were installed, so a deploy is never served stale (nothing is cached here, ever).
// Payload (worker/push.js): { title, body, url, tag }.

// PNG: Android / iOS do not render SVG notification icons. The badge is a white silhouette (Android tints it).
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Older builds may have left caches behind: this worker owns none, so drop them all.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* caches unavailable */
      }
      await self.clients.claim();
    })(),
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
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'GameHub';
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
