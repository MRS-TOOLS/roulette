const CACHE_NAME = "mrs-roulette-v1";
const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.webmanifest",
    "./pwa-icon.svg",
    "./icon-192.png",
    "./icon-512.png",
    "./apple-touch-icon.png"
];
const APP_PATHS = new Set(APP_FILES.map(path => new URL(path, self.registration.scope).pathname));
const ROOT_PATH = new URL("./", self.registration.scope).pathname;
const INDEX_PATH = new URL("./index.html", self.registration.scope).pathname;

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_FILES);
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith("mrs-roulette-") && key !== CACHE_NAME)
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    const isNavigation = request.mode === "navigate";
    if (!isNavigation && !APP_PATHS.has(url.pathname)) return;
    if (isNavigation && url.pathname !== ROOT_PATH && url.pathname !== INDEX_PATH) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (response.ok) {
                try {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(request, response.clone());
                } catch (error) {
                    console.warn("キャッシュを更新できませんでした", error);
                }
            }
            return response;
        } catch (error) {
            const cached = await caches.match(request);
            if (cached) return cached;
            if (isNavigation) {
                const shell = await caches.match(new URL("./index.html", self.registration.scope));
                if (shell) return shell;
            }
            throw error;
        }
    })());
});
