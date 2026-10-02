// Onomika service worker — makes the app shell load offline. Data (words, review
// state) is handled by the app itself via IndexedDB + a sync outbox; here we only
// cache the shell/static assets and never touch /api.
const CACHE = "onomika-v2";
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

  // Navigations: the page is a static shell ("Loading…" until the app's own data
  // comes), so a page opened before answers from the cache at once and a fresh copy
  // is fetched behind it for the next open. Network-first waited a round trip on
  // every open (0.35–1.4 s, and 5 s when a TLS handshake hung — the audit,
  // 2026-10-02). A shell that outlived a deploy and asks for a chunk that's gone is
  // recovered in the page (components/PwaRegister.tsx). Never seen: the network,
  // then the home shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        });
        if (cached) {
          event.waitUntil(fresh.catch(() => {}));
          return cached;
        }
        try {
          return await fresh;
        } catch {
          return (await cache.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets (JS/CSS chunks, images, icons, the draw pad's stroke data):
  // stale-while-revalidate.
  const cacheable =
    STATIC.test(url.pathname) ||
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/favicon") ||
    url.pathname.startsWith("/handwriting/");
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
