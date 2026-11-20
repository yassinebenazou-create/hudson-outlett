/* ==========================================================================
   HUDSON SHIFT REMINDER — Service Worker
   Provides offline support and notification click handling.
   ========================================================================== */

const CACHE_NAME = 'hudson-shift-v1.1.0';
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
  if (requestUrl.pathname.startsWith('/api/')) return;

  // Network-first for app shell so Vercel deployments update installed PWAs automatically
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        })
      )
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'HUDSON SHIFT', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'HUDSON SHIFT';
  const options = {
    body: payload.body || '',
    icon: './assets/icon-192.png',
    badge: './assets/icon-192.png',
    tag: payload.tag || `hudson-push-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    data: {
      type: payload.type || 'start',
      shiftId: payload.shiftId || null,
      deviceId: payload.deviceId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetAction = event.action || 'open';
  const notifData = event.notification.data || {};

  const backendPromise =
    targetAction !== 'open' && notifData.deviceId && notifData.shiftId
      ? fetch('./api/push/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: notifData.deviceId,
            shiftId: notifData.shiftId,
            action: targetAction
          })
        }).catch(() => {})
      : Promise.resolve();

  const windowPromise = self.clients
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
    });

  event.waitUntil(Promise.all([backendPromise, windowPromise]));
});
