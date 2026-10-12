// Each build registers ./sw.js?v=<build>; older build caches are removed on activation.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'sketch-docs-' + VERSION;
const OWNED = /^(?:sketch-docs-|edentext-shell-|edentext-v\d+$)/;

// Hosts may redirect /word.html to /word. A redirected response cannot answer a navigation,
// so store a plain copy under both the requested and the final URL.
async function store(cache, url, response) {
  const plain = response.redirected ? new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers: response.headers }) : response.clone();
  await cache.put(url, plain.clone());
  if (response.redirected && response.url) await cache.put(response.url, plain);
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const name of ['./', './word.html', './hwp.html']) {
      const url = new URL(name, self.location.href);
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error('Could not cache shell');
      await store(cache, url, response);
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(match => new URL(match[1], response.url || url).href);
      await cache.addAll([...new Set(assets)]);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (OWNED.test(key) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
// Online, /x.html may have been stored only under its redirect target /x (or /d/ for /d/index.html).
function offlineCandidates(href) {
  const url = new URL(href);
  const result = [url.href];
  if (url.pathname.endsWith('.html')) {
    url.pathname = url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -'index.html'.length) : url.pathname.slice(0, -'.html'.length);
    result.push(url.href);
  }
  return result;
}
async function respond(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    for (const url of offlineCandidates(request.url)) {
      const saved = await caches.match(url, { ignoreVary: true, cacheName: CACHE }).catch(() => undefined);
      if (saved) return saved;
    }
    throw error;
  }
  // Storage is best effort: a full or unavailable cache never replaces a network answer.
  if (response.ok && response.type === 'basic') {
    try { await store(await caches.open(CACHE), request, response); }
    catch (error) { console.warn('[sw] cache write failed', error); }
  }
  return response;
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (['./rhwp/', './legal/'].some(path => url.pathname.startsWith(new URL(path, self.location.href).pathname))) return;
  event.respondWith(respond(event.request));
});
