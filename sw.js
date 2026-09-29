// Le Tre Celle — lets the app open without internet and keeps it up to date.
// The page itself: newest from the internet when it answers quickly, otherwise the saved copy.
// Libraries, icons and the text reader: saved the first time, then read from the phone.
const VERSION = "20260929231205-36feaf25";
const SHELL = "ltc-shell-" + VERSION;
const LIBS = "ltc-libs-v1";
const SHELL_FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const LIB_HOSTS = ["www.gstatic.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ltc-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetworkWithin(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("slow")), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // the app page
  if (req.mode === "navigate" || (url.origin === location.origin && (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")))) {
    e.respondWith(
      fromNetworkWithin(req, 3500)
        .then((r) => {
          if (r && r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put("index.html", copy)); }
          return r;
        })
        .catch(() => caches.match("index.html", { ignoreSearch: true }).then((r) => r || caches.match("./")))
    );
    return;
  }

  const sameOrigin = url.origin === location.origin;
  const isLib = LIB_HOSTS.includes(url.hostname);
  if (!sameOrigin && !isLib) return; // database and sign-in go straight to the internet

  e.respondWith(
    caches.match(req, { ignoreSearch: sameOrigin && url.pathname.endsWith(".wasm") }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((r) => {
        if (r && (r.ok || r.type === "opaque")) {
          const copy = r.clone();
          caches.open(sameOrigin ? SHELL : LIBS).then((c) => c.put(req, copy));
        }
        return r;
      });
    })
  );
});
