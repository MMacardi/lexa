"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "@/components/InstallApp";

// Registers the service worker (once, after load) so the app shell works offline.
// No-op on the server and in browsers without service-worker support.
export function PwaRegister() {
  useEffect(() => {
    // Before the worker: Chrome only offers to install once one is registered,
    // so listening first can't miss its prompt.
    captureInstallPrompt();
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onChunkError);
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support just won't be available — not fatal */
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      window.removeEventListener("load", onLoad);
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onChunkError);
    };
  }, []);
  return null;
}

// The service worker answers a page from its cache first (public/sw.js). After a
// deploy that cached page can ask for a script chunk the new build no longer has:
// drop the cached pages (the chunks stay) and reload once, onto the fresh build.
const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/;
const RELOADED_AT = "onomika.chunkReloadAt";

function onChunkError(e: ErrorEvent | PromiseRejectionEvent) {
  const reason = "reason" in e ? e.reason : e.error;
  const text = `${reason?.name ?? ""} ${reason?.message ?? ""} ${"message" in e ? e.message : ""}`;
  // Offline, a missing chunk is the network's fault: the cached pages are all there is.
  if (!CHUNK_ERROR.test(text) || !navigator.onLine) return;
  try {
    // Once a minute at most: a chunk that is missing on the fresh build too must not loop.
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 60_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return;
  }
  void (async () => {
    try {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) if (!new URL(req.url).pathname.startsWith("/_next/")) await cache.delete(req);
      }
    } catch {
      /* no Cache API here — the reload still goes to the network for what's missing */
    }
    location.reload();
  })();
}
