// Onomika service worker — makes the app shell load offline. Data (words, review
// state) is handled by the app itself via IndexedDB + a sync outbox; here we only
// cache the shell/static assets and never touch /api.
const CACHE = "onomika-v1";
const STATIC = /\/_next\/(static|image)\//;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, Telegram SDK, etc. pass through
  if (url.pathname.startsWith("/api/")) return; // never cache the API — offline is handled in-app

  // Navigations: network-first, fall back to the cached page (or the shell) offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(req)) || (await cache.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets (JS/CSS chunks, images, icons): stale-while-revalidate.
  const cacheable = STATIC.test(url.pathname) || url.pathname.startsWith("/icon") || url.pathname.startsWith("/favicon");
  if (cacheable) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const fetching = fetch(req)
          .then((res) => {
            cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || Response.error());
        return cached || fetching;
      })(),
    );
  }
});
