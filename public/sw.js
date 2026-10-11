const CACHE = 'edentext-shell-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const name of ['./', './word.html', './hwp.html']) {
      const url = new URL(name, self.location.href);
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error('Could not cache shell');
      await cache.put(url, response.clone());
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(match => new URL(match[1], url).href);
      await cache.addAll([...new Set(assets)]);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (/^edentext-v\d+$/.test(key) || (key.startsWith('edentext-shell-') && key !== CACHE)) await caches.delete(key);
    await self.clients.claim();
  })());
});
async function respond(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request, { ignoreVary: true });
    if (saved) return saved;
    throw error;
  }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(new URL('./rhwp/', self.location.href).pathname)) return;
  event.respondWith(respond(event.request));
});
