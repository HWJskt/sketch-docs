// Runs public/sw.js in a VM with in-memory caches and a scripted network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const source = await readFile(resolve(import.meta.dirname, '../public/sw.js'), 'utf8');
const scope = 'https://docs.example/';

function worker({ network, failPut = false, existing = {} }) {
  const stores = new Map(Object.entries(existing).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const key = request => typeof request === 'string' ? request : request.url ?? request.href;
  const open = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async put(request, response) { if (failPut) throw new DOMException('quota', 'QuotaExceededError'); store.set(key(request), response); },
      async match(request) { return store.get(key(request)); },
      async addAll(urls) { for (const url of urls) store.set(url, await network(url)); },
    };
  };
  const caches = {
    open: async name => open(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async (request, options = {}) => stores.get(options.cacheName)?.get(key(request)),
  };
  const listeners = {};
  const self = {
    location: { href: scope + 'sw.js?v=build2', origin: new URL(scope).origin },
    addEventListener: (type, listener) => { listeners[type] = listener; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  vm.runInNewContext(source, { self, caches, fetch: request => network(key(request)), URL, Response, console: { warn() {} } });
  const dispatch = async (type, request) => {
    let pending;
    const event = { request, waitUntil: promise => { pending = promise; }, respondWith: promise => { pending = promise; } };
    listeners[type](event);
    return pending;
  };
  return { stores, dispatch, cacheName: 'sketch-docs-build2' };
}
const get = url => ({ url: scope + url, method: 'GET' });
// A same-origin network response as a worker sees it (Node's Response reports type "default").
class NetworkResponse extends Response {
  #meta;
  constructor(body, meta = {}) { super(body, { status: 200 }); this.#meta = meta; }
  get type() { return 'basic'; }
  get redirected() { return !!this.#meta.redirected; }
  get url() { return this.#meta.url ?? ''; }
}
const ok = (body, meta) => new NetworkResponse(body, meta);

test('a failed cache write still returns the network response', async () => {
  const sw = worker({ failPut: true, network: async () => ok('fresh') });
  const response = await sw.dispatch('fetch', get('engines/word/assets/app.js'));
  assert.equal(await response.text(), 'fresh');
});

test('offline requests fall back to the copy stored under the extensionless URL', async () => {
  let online = true;
  const sw = worker({ network: async url => { if (!online) throw new TypeError('offline'); return ok('page ' + new URL(url).pathname); } });
  await sw.dispatch('fetch', get('word'));
  await sw.dispatch('fetch', get('engines/word/'));
  online = false;
  assert.equal(await (await sw.dispatch('fetch', get('word.html'))).text(), 'page /word');
  assert.equal(await (await sw.dispatch('fetch', get('engines/word/index.html'))).text(), 'page /engines/word/');
  await assert.rejects(sw.dispatch('fetch', get('missing.html')), /offline/);
});

test('install stores redirected shell pages as plain responses under both URLs', async () => {
  const pages = { '': '/', 'word.html': '/word', 'hwp.html': '/hwp' };
  const sw = worker({ network: async url => {
    const path = url.slice(scope.length);
    if (path in pages) return ok('<script src="./assets/shell.js"></script>', { redirected: pages[path] !== '/' , url: scope.replace(/\/$/, '') + pages[path] });
    return ok('asset');
  } });
  await sw.dispatch('install');
  const store = sw.stores.get(sw.cacheName);
  for (const url of [scope + 'word.html', scope + 'word', scope + 'hwp.html', scope + 'hwp']) {
    assert.ok(store.has(url), url);
    assert.notEqual(store.get(url).redirected, true, url + ' must not be a redirected response');
  }
  assert.ok(store.has(scope + 'assets/shell.js'));
});

test('activation removes older Sketch Docs caches and leaves unrelated caches', async () => {
  const sw = worker({ network: async () => ok(''), existing: { 'sketch-docs-build1': {}, 'edentext-shell-v1': {}, 'edentext-v3': {}, 'sketch-docs-build2': {}, 'other-app': {} } });
  await sw.dispatch('activate');
  assert.deepEqual([...sw.stores.keys()].sort(), ['other-app', 'sketch-docs-build2']);
});
