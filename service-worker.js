/* ==========================================================================
   HUDSON SHIFT REMINDER — Service Worker
   Provides offline support and notification click handling.
   ========================================================================== */

const CACHE_NAME = 'hudson-shift-v1.0.4';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/schedule.js',
  './js/reminders.js',
  './js/settings.js',
  './js/app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/hudson-outlet-logo.png',
  './assets/hudson-cover.jpg',
  './assets/icon-48.png',
  './assets/icon-72.png',
  './assets/icon-96.png',
  './assets/icon-128.png',
  './assets/icon-144.png',
  './assets/icon-152.png',
  './assets/icon-192.png',
  './assets/icon-384.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type !== 'basic'
          ) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetAction = event.action || 'open';
  const notifData = event.notification.data || {};

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              action: targetAction,
              data: notifData
            });
            return;
          }
        }
        if (self.clients.openWindow) {
          const params = new URLSearchParams();
          if (targetAction !== 'open') params.set('notif_action', targetAction);
          if (notifData.shiftId) params.set('shift_id', notifData.shiftId);
          const query = params.toString();
          return self.clients.openWindow(query ? `./index.html?${query}` : './index.html');
        }
        return undefined;
      })
  );
});
