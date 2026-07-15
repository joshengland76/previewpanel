const CACHE = "pp-__SW_VERSION__";
const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i;

self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Real Web Push -- the server calls webpush.sendNotification() once a job
// finishes (see server.js's sendPushForJob), which wakes THIS service worker
// directly via the browser/OS push service, independent of whether any tab
// is open or focused. Replaces the old foreground-only `new Notification()`
// call in PreviewPanel.jsx, which only ever fired while that tab's own JS
// was still running -- and mobile browsers throttle/suspend a backgrounded
// tab's timers, so it could only ever notify once the user reopened the app.
self.addEventListener("push", e => {
  let data = { title: "PreviewPanel 🦉", body: "Your results are ready!" };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientsList => {
      for (const client of clientsList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("/api/")) return;

  const url = e.request.url;

  // Images: cache-first (they're versioned with ?v=N query params)
  if (IMAGE_EXTS.test(url)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // App shell (HTML, JS, CSS, fonts) — network-first, fall back to cache when offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
