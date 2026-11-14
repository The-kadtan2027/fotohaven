const CACHE_NAME = "fotohaven-v3";
const FILE_CACHE = "fotohaven-photos-v3";

const STATIC_ASSETS = [
  "/",
  "/login",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// API responses safe to persist on the device. Never cache auth/admin/guest.
const CACHEABLE_API_PREFIXES = ["/api/share/", "/api/comments/"];

function isCacheableApi(pathname) {
  return CACHEABLE_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Install Event — Pre-cache core shell.
// Each URL is added independently: one 404 must not empty the whole cache.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => undefined))
      );
    })
  );
  self.skipWaiting();
});

// Activate Event — Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== FILE_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event — Hybrid Caching Strategy
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and browser extension requests
  if (event.request.method !== "GET" || !url.protocol.startsWith("http")) {
    return;
  }

  // Strategy 1: Cache-First for served photo files (/api/files/*) & images
  if (url.pathname.startsWith("/api/files/") || url.pathname.match(/\.(png|jpg|jpeg|webp|svg|gif|ico)$/i)) {
    event.respondWith(
      caches.open(FILE_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            cache.put(event.request, responseToCache).catch(() => {});
          }
          return networkResponse;
        } catch {
          return cachedResponse || new Response("Offline image unavailable", { status: 503 });
        }
      })
    );
    return;
  }

  // Strategy 2: Network-First for the small set of public API reads.
  // Guest/auth/admin responses are never written to Cache Storage.
  if (url.pathname.startsWith("/api/") && isCacheableApi(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const cacheControl = networkResponse.headers.get("Cache-Control") || "";
          const cacheableRequest = !event.request.headers.has("Authorization");
          if (
            cacheableRequest &&
            networkResponse.ok &&
            networkResponse.status === 200 &&
            !cacheControl.includes("no-store")
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || new Response(JSON.stringify({ error: "Offline" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            });
          });
        })
    );
    return;
  }

  // Other API requests go straight to the network (no caching).
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Strategy 3: Stale-While-Revalidate for pages and UI static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
