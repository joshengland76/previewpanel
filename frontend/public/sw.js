const CACHE = "pp-v2";

self.addEventListener("install", e => {
  // Don't pre-cache anything — let the browser handle HTML/JS normally.
  // The SW's only job is to keep API calls from being intercepted.
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  // Delete all old caches (including pp-v1 which was caching index.html)
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Never intercept API calls or non-GET requests
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("/api/")) return;
  // Never cache HTML — always fetch fresh so the hashed JS bundle is correct
  if (e.request.headers.get("accept")?.includes("text/html")) return;
  // For everything else (fonts, images, static assets): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
