const CACHE_NAME = "seaperch-sim-v1";

const STATIC_ASSETS: readonly string[] = [
  "./",
  "./index.html",
  "./validation.html",
  "./manifest.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./polars/naca4412.json",
  "./polars/eppler387.json",
  "./polars/clarky.json",
  "./polars/flat_plate.json",
  "./vehicles/candidateA.json",
  "./validation/j_sweep_validation.json",
  "./validation/j_sweep_validation.svg"
];

const swContext = self as unknown as {
  addEventListener: (event: string, handler: (e: any) => void) => void;
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  location: { origin: string };
};

swContext.addEventListener("install", (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => swContext.skipWaiting())
  );
});

swContext.addEventListener("activate", (event: any) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => swContext.clients.claim())
  );
});

swContext.addEventListener("fetch", (event: any) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== swContext.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        if (event.request.headers.get("accept")?.includes("text/html")) {
          return caches.match("./index.html");
        }
      });
    })
  );
});

export {};
