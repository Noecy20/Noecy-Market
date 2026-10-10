/* Noecy Market — service worker : notifications push */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corps: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'Noecy Market', {
    body: d.corps || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    vibrate: [120, 60, 120],
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Les adresses reçues (« /admin.html#… ») sont résolues dans le dossier du site (ex. GitHub Pages : /Noecy-Market/)
  const brut = (e.notification.data && e.notification.data.url) || '/';
  const url = new URL(brut.replace(/^\//, ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w));
      }
    }
    return self.clients.openWindow(url);
  }));
});
