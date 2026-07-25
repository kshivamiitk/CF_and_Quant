const CACHE_NAME = "kumar-quant-tracker-v14";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
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
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith("/api/")) return;
  const networkFirst = ["/", "/index.html", "/app.js", "/styles.css", "/service-worker.js"].includes(requestUrl.pathname);
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
      icon: "/cf2000_tracker_icon_1024.png",
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
  const targetUrl = new URL(event.notification.data?.url || "/?view=planner", self.location.origin).href;
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
