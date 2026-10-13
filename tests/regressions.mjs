// Browser regressions that need their own server or browser context.
// The static server mimics Cloudflare Pages: /x.html answers 308 → /x, and /x serves x.html.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, process.env.TEST_DIST || 'dist');
const port = 4178;
// LIVE_ORIGIN=https://… runs the scenarios that need no server control against a deployment.
const live = process.env.LIVE_ORIGIN?.replace(/\/$/, '');
const origin = live ?? `http://localhost:${port}`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.ico': 'image/x-icon', '.gz': 'application/gzip', '.dic': 'text/plain', '.aff': 'text/plain' };
let failShell = false, delayWorker = false;

async function file(path) {
  const full = join(dist, path);
  if (!full.startsWith(dist + sep)) return undefined;
  return stat(full).then(s => s.isFile() ? full : undefined, () => undefined);
}
// Pages applies public/_headers; long-lived caching matters to the engine preloading scenarios.
const headerRules = (await readFile(join(dist, '_headers'), 'utf8').catch(() => '')).split(/\n(?=\S)/).map(block => {
  const [pattern, ...lines] = block.trim().split('\n');
  const regex = new RegExp('^' + pattern.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return { regex, headers: Object.fromEntries(lines.map(line => line.trim().split(/:\s*/, 2))) };
});
const pagesHeaders = path => Object.assign({ 'Cache-Control': 'no-cache' }, ...headerRules.filter(rule => rule.regex.test(path)).map(rule => rule.headers));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    const path = decodeURIComponent(url.pathname);
    if (failShell && /^\/hwp(?:\.html)?$/.test(path)) { response.writeHead(500).end('unavailable'); return; }
    if (delayWorker && path === '/sw.js') await new Promise(resolve => setTimeout(resolve, 40000));
    if (path.endsWith('.html')) {
      const clean = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path.slice(0, -'.html'.length);
      response.writeHead(308, { location: clean + url.search }).end(); return;
    }
    const target = await file(path.endsWith('/') ? path + 'index.html' : path) ?? await file(path + '.html');
    if (!target) { response.writeHead(404).end('not found'); return; }
    response.writeHead(200, { ...pagesHeaders(path), 'content-type': types[extname(target)] ?? 'application/octet-stream' });
    response.end(await readFile(target));
  } catch (error) { response.writeHead(500).end(String(error)); }
});

let browser;
// `persistent` gives the scenario a disk cache like a normal profile; the default context keeps
// its HTTP cache in memory, which does not hold an 11.8MB WASM for reuse.
const scenario = async (name, run, { needsServer = false, contextOptions = {}, persistent = false } = {}) => {
  if (live && needsServer) { console.log('SKIP (live)', name); return; }
  const options = { viewport: { width: 1280, height: 900 }, ...contextOptions };
  const profile = persistent ? await mkdtemp(join(tmpdir(), 'sketch-docs-profile-')) : undefined;
  const context = profile ? await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, ...options }) : await browser.newContext(options);
  const errors = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(String(error)));
    page.on('dialog', dialog => dialog.accept());
    await run(page, context);
    assert.deepEqual(errors, [], name + ': page errors');
    console.log('PASS', name);
  } finally {
    await context.close();
    if (profile) await rm(profile, { recursive: true, force: true });
  }
};
const wordFrame = page => page.frameLocator('iframe[title="Word 문서 편집기"]');

try {
  if (!live) await new Promise((ok, fail) => server.once('error', fail).listen(port, 'localhost', ok));
  browser = await chromium.launch({ channel: 'chrome', headless: true });

  await scenario('clean URLs: navigation, reload, history and offline Word', async (page, context) => {
    await page.goto(origin + '/');
    await page.getByRole('link', { name: /Word 문서/ }).click();
    await page.waitForURL(origin + '/word');
    await wordFrame(page).locator('.tiptap').first().waitFor();
    await page.reload();
    await wordFrame(page).locator('.tiptap').first().waitFor();
    const header = wordFrame(page).locator('.product-header');
    await header.getByRole('button', { name: '한글', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '새 문서입니다' }).waitFor();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.engine:not([hidden]) iframe')?.title === 'Word 문서 편집기');
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('.engine:not([hidden]) iframe')?.title === '한글 문서 편집기');
    await page.goto(origin + '/hwp');
    await page.getByRole('status').filter({ hasText: '새 문서입니다' }).waitFor();
    await page.locator('iframe[title="한글 문서 편집기"]').contentFrame().locator('.product-header').getByRole('button', { name: 'Word', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.engine:not([hidden]) iframe')?.title === 'Word 문서 편집기');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.engine:not([hidden]) iframe')?.title === '한글 문서 편집기', null, { timeout: 5000 });
    await page.goto(origin + '/word');
    await wordFrame(page).locator('.tiptap').first().waitFor();
    await context.setOffline(true);
    await page.reload();
    await wordFrame(page).locator('.tiptap').first().waitFor();
    await page.goto(origin + '/word.html');
    await wordFrame(page).locator('.tiptap').first().waitFor();
    await context.setOffline(false);
  });

  await scenario('service worker install failure still opens Word online', async page => {
    failShell = true;
    try {
      await page.goto(origin + '/word');
      await wordFrame(page).locator('.tiptap').first().waitFor({ timeout: 20000 });
    } finally { failShell = false; }
  }, { needsServer: true });

  await scenario('a service worker script that never arrives still opens Word online', async page => {
    delayWorker = true;
    try {
      await page.goto(origin + '/word');
      await wordFrame(page).locator('.tiptap').first().waitFor({ timeout: 20000 });
    } finally { delayWorker = false; }
  }, { needsServer: true });

  await scenario('About links the deployed commit on GitHub', async page => {
    const release = await (await page.request.get(origin + '/legal/release.json')).json();
    assert.match(release.source.url, /^https:\/\/github\.com\/HWJskt\/sketch-docs\/tree\/[0-9a-f]{40}$/);
    if (live) assert.equal(release.source.dirty, false, 'a deployment links a committed tree');
    await page.goto(origin + '/');
    await page.getByRole('button', { name: '프로그램 정보 · 라이선스 및 소스 코드' }).click();
    assert.equal(await page.getByRole('link', { name: '이 버전의 소스 코드 (GitHub)' }).getAttribute('href'), release.source.url);
    assert.equal((await page.request.get(origin + '/legal/notices.txt')).status(), 200);
  });

  await scenario('modern Word toolbar offers only Word formats', async page => {
    await page.goto(origin + '/word');
    await page.evaluate(() => localStorage.setItem('edentext-chrome', 'modern'));
    await page.reload();
    const word = wordFrame(page);
    await word.locator('.save-chevron').click();
    const items = (await word.locator('.theme-dropdown [role="menuitem"]').allTextContents()).join('\n');
    assert.match(items, /\(\.docx\)/);
    assert.match(items, /\(\.odt\)/);
    assert.doesNotMatch(items, /\.hwpx?\)/, 'no Hangul Save As in the modern toolbar');
  });

  // An upstream update that makes an editor download a new large file must fail here, so the
  // shell's download progress and preloading stay true. Service workers are blocked so every
  // request reaches the network log.
  await scenario('engine manifest lists what each editor downloads at startup', async (page, context) => {
    const { engines } = await (await page.request.get(origin + '/engines/manifest.json')).json();
    const ready = {
      word: () => wordFrame(page).locator('.tiptap').first().waitFor(),
      hwp: () => page.getByRole('status').filter({ hasText: '새 문서입니다' }).waitFor(),
    };
    for (const [name, open] of Object.entries(ready)) {
      const listed = new Set([...engines[name].required, ...engines[name].warm].map(file => file.path));
      const seen = new Map();
      const record = async response => {
        const url = new URL(response.url());
        if (url.origin !== origin || response.status() !== 200) return;
        const bytes = (await response.body().catch(() => Buffer.alloc(0))).length;
        seen.set(url.pathname.slice(1), bytes);
      };
      context.on('response', record);
      await page.goto(origin + '/' + name);
      await open();
      await page.waitForLoadState('networkidle');
      context.off('response', record);
      const unlisted = [...seen].filter(([path, bytes]) => bytes > 100_000 && !listed.has(path));
      assert.deepEqual(unlisted, [], `${name}: large startup downloads missing from the engine manifest`);
      const missing = engines[name].required.map(file => file.path).filter(path => !seen.has(path));
      assert.deepEqual(missing, [], `${name}: manifest requires files the editor never downloads`);
    }
  }, { contextOptions: { serviceWorkers: 'block' } });

  const hangulReady = page => page.getByRole('status').filter({ hasText: '새 문서입니다' }).waitFor();
  await scenario('a slow network shows engine download progress, then the editor opens from the downloaded files', async (page, context) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
    const transfers = [];
    const urls = new Map();
    cdp.on('Network.responseReceived', event => urls.set(event.requestId, event.response.url));
    cdp.on('Network.loadingFinished', event => { if (urls.get(event.requestId)?.endsWith('.wasm')) transfers.push(event.encodedDataLength); });
    await page.goto(origin + '/hwp');
    await page.getByRole('heading', { name: '한글 엔진 다운로드 중…' }).waitFor();
    await page.getByText(/^\d+\.\d \/ \d+\.\d MB$/).waitFor();
    await hangulReady(page);
    assert.equal(await page.getByRole('heading', { name: '한글 엔진 다운로드 중…' }).count(), 0);
    assert.equal(transfers.filter(bytes => bytes > 1_000_000).length, 1, `the WASM crossed the network once (transfers: ${transfers})`);
  }, { contextOptions: { serviceWorkers: 'block' }, persistent: true });

  await scenario('a stalled or failed engine download offers a retry that opens the editor', async page => {
    let mode = 'hang';
    const held = [];
    await page.route('**/rhwp/assets/*.wasm', route => {
      if (mode === 'hang') held.push(route);
      else if (mode === 'fail') return route.fulfill({ status: 500, body: 'unavailable' });
      else return route.continue();
    });
    await page.goto(origin + '/hwp');
    await page.getByText('연결이 느립니다').waitFor({ timeout: 25000 });
    mode = 'fail';
    await page.getByRole('button', { name: '다시 시도' }).click();
    await page.getByRole('alert').filter({ hasText: '엔진 파일을 받지 못했습니다 (500)' }).waitFor();
    mode = 'pass';
    await page.getByRole('button', { name: '다시 시도' }).click();
    await hangulReady(page);
    for (const route of held) await route.abort().catch(() => {});
  }, { contextOptions: { serviceWorkers: 'block' } });

  await scenario('the start page preloads engines in the background, last used first, so the editor opens without waiting', async (page, context) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const order = [], transfers = [];
    const urls = new Map();
    cdp.on('Network.requestWillBeSent', event => { const path = new URL(event.request.url).pathname; if (/^\/(?:engines\/word|rhwp)\/assets\//.test(path)) order.push(path); });
    cdp.on('Network.responseReceived', event => urls.set(event.requestId, event.response.url));
    cdp.on('Network.loadingFinished', event => { if (urls.get(event.requestId)?.endsWith('.wasm')) transfers.push(event.encodedDataLength); });
    await page.goto(origin + '/');
    await page.evaluate(() => localStorage.setItem('sketch-docs-last-engine', 'hwp'));
    await page.reload();
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.endsWith('.wasm') && entry.responseEnd > 0), null, { timeout: 60000 });
    assert.match(order[0] ?? '', /^\/rhwp\//, `the last used editor downloads first (order: ${order.slice(0, 3)})`);
    await page.getByRole('link', { name: /한글 문서/ }).click();
    await hangulReady(page);
    assert.equal(transfers.filter(bytes => bytes > 1_000_000).length, 1, `the WASM crossed the network once (transfers: ${transfers})`);
  }, { contextOptions: { serviceWorkers: 'block' }, persistent: true });

  await scenario('the start page does not preload on a Save-Data connection', async page => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }));
    const engineRequests = [];
    page.on('request', request => { if (/\/(?:engines\/word|rhwp)\/assets\//.test(request.url())) engineRequests.push(request.url()); });
    await page.goto(origin + '/');
    await page.waitForTimeout(3000);
    assert.deepEqual(engineRequests, []);
  }, { contextOptions: { serviceWorkers: 'block' } });

  await scenario('direct Word engine URL opens the product shell', async page => {
    await page.goto(origin + '/engines/word/index.html');
    await page.waitForURL(url => /^\/word(?:\.html)?$/.test(new URL(url).pathname));
    await wordFrame(page).locator('.tiptap').first().waitFor();
    await wordFrame(page).locator('.product-header').getByRole('button', { name: '한글', exact: true }).waitFor();
  });
} finally {
  await browser?.close();
  if (server.listening) {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
}
