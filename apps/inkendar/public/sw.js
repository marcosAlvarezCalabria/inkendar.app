/* global self, caches, fetch, Response */

const CACHE_NAME = "inkendar-static-shell-v1";
const PRECACHE_URLS = Object.freeze([
  "/offline.html",
  "/inkendar-mark.svg",
  "/manifest.webmanifest"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("inkendar-static-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(async () => (
      await caches.match("/offline.html", { cacheName: CACHE_NAME }) ?? Response.error()
    ))
  );
});
