/// <reference lib="webworker" />
// Service worker: offline app shell + push notifications (works when Daybook is closed).
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/functions\//] }));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d: { title?: string; body?: string; url?: string; tag?: string } = {};
  try { d = event.data?.json() ?? {}; } catch { d = { title: 'Daybook', body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(d.title ?? 'Daybook', {
    body: d.body ?? '', tag: d.tag, data: { url: d.url ?? '/' }, icon: '/icon-192.png', badge: '/badge-72.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data?.url as string) ?? '/', self.location.origin);
  const target = url.origin === self.location.origin ? url.href : self.location.origin;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) { await (c as WindowClient).focus(); await (c as WindowClient).navigate(target); return; }
    }
    await self.clients.openWindow(target);
  })());
});
