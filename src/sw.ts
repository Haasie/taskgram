/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/auth\//] }));

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

clientsClaim();

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json() as {
      title?: string;
      body?: string;
      url?: string;
      tag?: string;
    };
    const title = payload.title || 'Taskgram';
    const options: NotificationOptions = {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url || '/#/today' },
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png'
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('[sw] Failed to parse push payload:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/#/today';
  const targetUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then((focused) => {
            if ('navigate' in focused) {
              return (focused as WindowClient).navigate(targetUrl);
            }
          });
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
