
"use strict";

const CACHE_NAME = "reservation-manager-v1";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.webmanifest",
    "./xlsx.full.min.js",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

/* インストール時に必要ファイルを保存 */
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(APP_FILES);
        })
    );

    self.skipWaiting();
});

/* 古いキャッシュを削除 */
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );

    self.clients.claim();
});

/* キャッシュ優先で読み込む */
self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                if (
                    response &&
                    response.status === 200 &&
                    response.type === "basic"
                ) {
                    const copy = response.clone();

                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, copy);
                    });
                }

                return response;
            });
        }).catch(() => {
            if (event.request.mode === "navigate") {
                return caches.match("./index.html");
            }

            return new Response("オフラインです。", {
                status: 503,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8"
                }
            });
        })
    );
});
