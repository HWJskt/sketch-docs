// src/enginePreload.ts against a scripted network whose responses stream when the test says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreloader } from '../src/enginePreload.ts';

const base = 'https://docs.example/';
const manifest = {
  schemaVersion: 1,
  engines: {
    word: { required: [{ path: 'w.js', bytes: 4 }], warm: [{ path: 'font.ttf', bytes: 2 }], requiredBytes: 4 },
    hwp: { required: [{ path: 'h.js', bytes: 2 }, { path: 'h.wasm', bytes: 6 }], warm: [], requiredBytes: 8 },
  },
};

function network() {
  const calls = [], streams = new Map();
  const fetch = async (url, init = {}) => {
    const path = url.slice(base.length);
    calls.push({ path, priority: init.priority });
    if (path === 'engines/manifest.json') return Response.json(manifest);
    let controller;
    const body = new ReadableStream({ start(c) { controller = c; } });
    init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
    const stream = { send: bytes => controller.enqueue(new Uint8Array(bytes)), end: () => controller.close(), fail: () => controller.error(new TypeError('network')) };
    streams.set(path, [...(streams.get(path) ?? []), stream]);
    return new Response(body, { status: 200 });
  };
  const until = async check => { for (let i = 0; i < 200 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check(), 'condition not reached'); };
  const stream = async (path, n = 1) => { await until(() => (streams.get(path)?.length ?? 0) >= n); return streams.get(path)[n - 1]; };
  return { fetch, calls, stream, until, fetched: path => calls.filter(call => call.path === path).length };
}

test('prepare reports bytes as they arrive and finishes when every required file is complete', { timeout: 5000 }, async () => {
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  const seen = [];
  const ready = preloader.prepare('hwp', { onProgress: progress => seen.push(progress) });
  (await net.stream('h.js')).send(2); (await net.stream('h.js')).end();
  const wasm = await net.stream('h.wasm');
  wasm.send(3);
  await net.until(() => seen.some(p => p.loaded === 5));
  wasm.send(3); wasm.end();
  await ready;
  assert.deepEqual(seen.at(-1), { loaded: 8, total: 8 });
  assert.deepEqual(await preloader.progress('hwp'), { loaded: 8, total: 8 });
});

test('a file being preloaded in the background is shared, not downloaded twice', { timeout: 5000 }, async () => {
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  void preloader.background(['word', 'hwp']);
  const js = await net.stream('w.js');
  js.send(1);
  const ready = preloader.prepare('word');
  js.send(3); js.end();
  await ready;
  assert.equal(net.fetched('w.js'), 1);
  assert.equal(net.calls.find(call => call.path === 'w.js').priority, 'low');
});

test('choosing an editor stops downloads of other editors and the background queue', { timeout: 5000 }, async () => {
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  const background = preloader.background(['hwp', 'word']);
  const hwp = await net.stream('h.js');
  hwp.send(1);
  const ready = preloader.prepare('word');
  const word = await net.stream('w.js');
  word.send(4); word.end();
  await ready;
  await background;
  assert.equal(net.fetched('h.wasm'), 0, 'the background queue stopped');
  assert.deepEqual(await preloader.progress('hwp'), { loaded: 0, total: 8 }, 'the aborted file is forgotten');
  assert.equal(net.calls.find(call => call.path === 'w.js').priority, 'high');
  await net.until(() => net.fetched('font.ttf') === 1);
  assert.equal(net.calls.find(call => call.path === 'font.ttf').priority, 'low', 'warm files of the chosen editor still load');
});

test('a stalled download is reported once and restart() fetches it again', { timeout: 5000 }, async () => {
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  let stalls = 0;
  const first = preloader.prepare('word', { stallMs: 300, onStall: () => stalls++ });
  (await net.stream('w.js')).send(1);
  await net.until(() => stalls === 1);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(stalls, 1, 'reported once per stall');
  await preloader.restart('word');
  await assert.rejects(first, /aborted/);
  const second = preloader.prepare('word');
  const again = await net.stream('w.js', 2);
  again.send(4); again.end();
  await second;
  assert.equal(net.fetched('w.js'), 2);
});

test('a failed download rejects and the next prepare starts it again', { timeout: 5000 }, async () => {
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  const first = preloader.prepare('word');
  (await net.stream('w.js')).fail();
  await assert.rejects(first, /network/);
  const second = preloader.prepare('word');
  const again = await net.stream('w.js', 2);
  again.send(4); again.end();
  await second;
});

test('an HTTP error is reported without retrying forever', { timeout: 5000 }, async () => {
  const preloader = createPreloader({ base, fetch: async url => url.endsWith('manifest.json') ? Response.json(manifest) : new Response('gone', { status: 404 }) });
  await assert.rejects(preloader.prepare('word'), /엔진 파일을 받지 못했습니다 \(404\)/);
});

test('an unreadable file list is a ManifestError, so the editor can open without progress', { timeout: 5000 }, async () => {
  const { ManifestError } = await import('../src/enginePreload.ts');
  const offline = createPreloader({ base, fetch: async () => { throw new TypeError('offline'); } });
  await assert.rejects(offline.prepare('word'), error => error instanceof ManifestError);
  const missing = createPreloader({ base, fetch: async () => new Response('', { status: 404 }) });
  await assert.rejects(missing.prepare('word'), error => error instanceof ManifestError && /404/.test(error.message));
});

test('switching to another editor keeps downloading the files the first editor is waiting on', { timeout: 5000 }, async () => {
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  const hwp = preloader.prepare('hwp');
  const wasm = await net.stream('h.wasm');
  wasm.send(3);
  const word = preloader.prepare('word');
  const js = await net.stream('w.js');
  js.send(4); js.end();
  await word;
  (await net.stream('h.js')).send(2); (await net.stream('h.js')).end();
  wasm.send(3); wasm.end();
  await hwp;
  assert.equal(net.fetched('h.wasm'), 1);
});

test('a file list request that never answers gives up as a ManifestError', { timeout: 5000 }, async () => {
  const { ManifestError } = await import('../src/enginePreload.ts');
  const hanging = (url, init) => new Promise((resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
  const preloader = createPreloader({ base, fetch: hanging, manifestLimitMs: 200 });
  await assert.rejects(preloader.prepare('word'), error => error instanceof ManifestError);
});

test('an engine missing from the file list is a ManifestError (dev server, older lists); the others still preload', { timeout: 5000 }, async () => {
  const { ManifestError } = await import('../src/enginePreload.ts');
  const net = network();
  const preloader = createPreloader({ base, fetch: net.fetch });
  await assert.rejects(preloader.prepare('pdf'), error => error instanceof ManifestError && /pdf/.test(error.message));
  assert.deepEqual(await preloader.progress('pdf'), { loaded: 0, total: 0 });
  await preloader.restart('pdf');
  // A fresh page: choosing an editor (above) stops background preloading by design.
  const start = createPreloader({ base, fetch: net.fetch });
  const background = start.background(['pdf', 'hwp']);
  (await net.stream('h.js')).end();
  (await net.stream('h.wasm')).end();
  await background;
  assert.equal(net.fetched('h.wasm'), 1, 'the listed engine after the missing one is fetched');
});
