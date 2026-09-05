// デプロイのたびに末尾の数字を必ず上げること。
// (app.jsのAPP_VERSIONを上げても、ここを上げないと
//  Service Workerのキャッシュは更新されず古いページが表示され続ける)
const CACHE_NAME = "guitar-library-v6";
const APP_SHELL = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./detect.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Cache-first for app shell, network-first fallback to cache for everything else same-origin.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
