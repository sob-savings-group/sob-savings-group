/* SOB offline shell */
const C = "sob-shell-181eb8b6a4-mwp78dci";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(["./", "index.html", "config.js", "app.bundle.js", "styles.css", "manifest.webmanifest"].map((u) => new Request(u, { cache: "reload" }))).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => { const r = e.request; if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return; e.respondWith(fetch(r).then((res) => { const cp = res.clone(); if (res.ok) caches.open(C).then((c) => c.put(r, cp)); return res; }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match("index.html")))); });
