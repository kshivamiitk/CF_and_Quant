const CACHE_NAME = "wellframe-v29";
const MEDIA_CACHE = "wellframe-media-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/auth.js",
  "/consumer.js",
  "/exercise-media.js",
  "/data/exercise-media.json?v=25",
  "/data/media-credits.json?v=25",
  "/data/exercise-videos.json?v=29",
  "/media/exercises/CH01/thumb.webp",
  "/media/exercises/QU01/thumb.webp",
  "/media/exercises/BK31/thumb.webp",
  "/consumer.css",
  "/wellframe-icon.svg",
  "/wellframe-icon.png",
  "/gym-library.js",
  "/gym-progress.js",
  "/alert-icon.svg",
  "/cf2000_tracker_icon_1024.png",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => ![CACHE_NAME, MEDIA_CACHE].includes(key)).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith("/api/")) return;
  if (requestUrl.pathname.startsWith("/media/exercises/")) {
    if (!requestUrl.pathname.endsWith(".webp")) return;
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(MEDIA_CACHE);
        await cache.put(event.request, response.clone());
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - 32))) await cache.delete(old);
      }
      return response;
    })));
    return;
  }
  const networkFirst = ["/", "/index.html", "/app.js", "/styles.css", "/auth.js", "/consumer.js", "/consumer.css", "/service-worker.js"].includes(requestUrl.pathname);
  if (networkFirst) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(requestUrl.pathname)))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => (
      cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
    ))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "You have a scheduled task." };
  }
  const title = payload.title || "Kumar Quant";
  const work = [
    self.registration.showNotification(title, {
      body: payload.body || "It is time for your scheduled work.",
      icon: ["/?tab=care", "/?tab=train"].includes(payload.url) ? "/wellframe-icon.png" : "/cf2000_tracker_icon_1024.png",
      badge: "/alert-icon.svg",
      tag: payload.tag || "kumar-quant-reminder",
      renotify: true,
      data: { url: payload.url || "/?view=planner" }
    })
  ];
  if (Number.isFinite(Number(payload.appBadge)) && "setAppBadge" in self.navigator) {
    work.push(self.navigator.setAppBadge(Number(payload.appBadge)));
  }
  event.waitUntil(Promise.all(work));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || "/?view=planner", self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : self.location.origin + "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
