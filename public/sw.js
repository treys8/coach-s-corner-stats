// Statly live-scoring service worker (Phase 5).
//
// Scope: registered with scope = "/" so navigation requests anywhere in the
// app go through the cache fallback, but the registration only fires on the
// score route (see ServiceWorkerRegistrar). Caching strategy:
//   - HTML navigation (mode === 'navigate'): NetworkFirst, fall back to the
//     cached shell so a reload-while-offline still loads the page.
//   - Static (/_next/static/*, /_next/image, fonts, /icons, /placeholder.svg):
//     CacheFirst.
//   - /api/*: NetworkOnly. POST queueing is handled at the app layer (the
//     IndexedDB outbox) — iOS Safari has no Background Sync, so a
//     SW-side queue would buy nothing.
//
// Bump CACHE_VERSION to roll cached content (e.g. after a schema change).

const CACHE_VERSION = "statly-sw-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const HTML_CACHE = `${CACHE_VERSION}-html`;

self.addEventListener("install", (event) => {
  // Take over as soon as we're ready; users in the middle of a game don't
  // want a forced reload to pick up the SW.
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old versions of the cache to keep storage bounded.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POST/PUT/DELETE → app handles them
  const url = new URL(req.url);

  // Same-origin only; we don't proxy CDN traffic.
  if (url.origin !== self.location.origin) return;

  // Never cache /api/*. App-level outbox is authoritative for writes;
  // reads should always hit the network so the user sees fresh state.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirstHtml(req));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/icons/") ||
    /\.(woff2?|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirstHtml(req) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cache = await caches.open(HTML_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-ditch: return the most recent navigation we have cached for any
    // path. The app will re-route client-side once it boots.
    const keys = await cache.keys();
    if (keys.length > 0) {
      const fallback = await cache.match(keys[keys.length - 1]);
      if (fallback) return fallback;
    }
    return new Response("Offline — no cached page available.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    if (cached) return cached;
    return new Response("", { status: 504 });
  }
}
