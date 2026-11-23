const APP_VERSION = '1.0.1';
const CACHE_NAME = `motomesh-${APP_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./index.css",
  "./js/main.js",
  "./js/app.js",
  "./js/audio.js",
  "./js/beacon.js",
  "./js/broadcast.js",
  "./js/config.js",
  "./js/lifecycle.js",
  "./js/local-mesh.js",
  "./js/maintenance.js",
  "./js/peers.js",
  "./js/route.js",
  "./js/session.js",
  "./js/signaling.js",
  "./js/state.js",
  "./js/ui.js",
  "./js/utils.js",
  "./js/wakelock.js",
  "./pwa.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

async function safeCachePut(key, response) {
  try {
    if (!response || !(response.ok || response.type === "opaque")) return;

    const cache = await caches.open(CACHE_NAME);

    await cache.put(key, response);
  } catch (error) {
    console.warn("[MotoMesh SW] Cache write dilewati:", error);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // Extension, data, blob, and other non-web schemes are not Cache API requests.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          event.waitUntil(safeCachePut("./index.html", response.clone()));
          return response;
        })
        .catch(async () => (await caches.match("./index.html")) || Response.error()),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              event.waitUntil(safeCachePut(request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response && (response.ok || response.type === "opaque")) {
            event.waitUntil(safeCachePut(request, response.clone()));
          }
          return response;
        }),
    ),
  );
});
