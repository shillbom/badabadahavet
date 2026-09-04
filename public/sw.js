/*
 * KILL-SWITCH SERVICE WORKER — temporary, remove one release after cutover.
 *
 * Existing installs have a precaching Workbox service worker registered at
 * this URL (vite-plugin-pwa, now retired). If /sw.js simply 404'd, some
 * browsers would keep the old worker alive and keep serving the stale cached
 * shell forever. This replaces it with a worker that deletes every cache and
 * unregisters itself, so those devices fall back to the network on the next
 * navigation and pick up the Next-served app.
 *
 * Do not delete this file until the old installs have had a release cycle to
 * fetch it. When removing it, also drop the /sw.js no-cache header in
 * next.config.ts.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clientList = await self.clients.matchAll({ type: "window" });
      for (const client of clientList) client.navigate(client.url);
    })(),
  );
});
