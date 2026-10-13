// Browser regressions that need their own server or browser context.
// The static server mimics Cloudflare Pages: /x.html answers 308 → /x, and /x serves x.html.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
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
    response.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(await readFile(target));
  } catch (error) { response.writeHead(500).end(String(error)); }
});

let browser;
const scenario = async (name, run, { needsServer = false, contextOptions = {} } = {}) => {
  if (live && needsServer) { console.log('SKIP (live)', name); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  const errors = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(String(error)));
    page.on('dialog', dialog => dialog.accept());
    await run(page, context);
    assert.deepEqual(errors, [], name + ': page errors');
    console.log('PASS', name);
  } finally { await context.close(); }
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
