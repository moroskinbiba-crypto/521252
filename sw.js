const CACHE_PREFIX = "tgrmlither-";
const CACHE = "tgrmlither-v6";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

function inScope(url) {
  return url.origin === self.location.origin && url.href.startsWith(self.registration.scope);
}

function appAssetPath(url) {
  return ASSETS.some(asset => new URL(asset, self.registration.scope).pathname === url.pathname);
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!inScope(url)) return;

  const navigation = request.mode === "navigate";
  if (!navigation && !appAssetPath(url)) return;

  if (navigation) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(new URL("./index.html", self.registration.scope).href);
      if (cached) return cached;
      return new Response("TGRMLither is offline and no cached app copy is available.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      try { await cache.put(request, response.clone()); } catch (error) { /* A cache failure must not block the app. */ }
    }
    return response;
  })());
});
