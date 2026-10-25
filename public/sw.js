const CACHE_NAME = "finance-shell-v1";
const SHELL_URL = new URL("./", self.registration.scope).href;
const SHELL_PATH = new URL(self.registration.scope).pathname;
const SHELL_FILES = ["./manifest.webmanifest", "./icon.svg"];

function sameOriginAsset(path) {
  const url = new URL(path, self.registration.scope);
  return url.origin === self.location.origin && url.pathname.startsWith("/assets/") ? url.href : null;
}

async function cacheAsset(cache, assetUrl) {
  const response = await fetch(assetUrl, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not cache app shell asset: ${assetUrl}`);
  await cache.put(assetUrl, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(SHELL_URL, { cache: "reload" });
    if (!response.ok) throw new Error("Could not cache the app shell.");
    await cache.put(SHELL_URL, response.clone());

    const html = await response.text();
    const assetUrls = new Set();
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const assetUrl = sameOriginAsset(match[1]);
      if (assetUrl) assetUrls.add(assetUrl);
    }
    for (const file of SHELL_FILES) assetUrls.add(new URL(file, self.registration.scope).href);

    const cssUrls = [...assetUrls].filter((url) => url.endsWith(".css"));
    for (const assetUrl of assetUrls) {
      const assetResponse = await cacheAsset(cache, assetUrl);
      if (!cssUrls.includes(assetUrl)) continue;
      const css = await assetResponse.text();
      for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const nestedAsset = sameOriginAsset(match[1]);
        if (nestedAsset) await cacheAsset(cache, nestedAsset);
      }
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith("finance-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && (url.pathname === SHELL_PATH || url.pathname === `${SHELL_PATH}index.html`)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (
      await cache.match(SHELL_URL) ?? fetch(request)
    )));
    return;
  }

  if (!url.pathname.startsWith("/assets/")) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (
    await cache.match(request) ?? fetch(request)
  )));
});