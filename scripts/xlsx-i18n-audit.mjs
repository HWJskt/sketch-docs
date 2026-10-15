// Measures what the Excel view still shows in English: builds GridCraft with scripts/xlsx-i18n-audit.patch
// (every label asked for without a translation is logged once), puts it into a copy of dist/, and opens
// the screens a view-only user reaches. Writes .cache/i18n-audit/report.json and screenshots in shots/.
// Needs a built dist/ (npm run build). Usage: node scripts/xlsx-i18n-audit.mjs
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { root, snapshot } from './build-engines.mjs';
import { buildGridcraft } from './gridcraft-build.mjs';
import { boldWorkbook, koreanWorkbook } from '../tests/xlsx-fixtures.mjs';

const base = join(root, '.cache/i18n-audit');
const port = 4180, origin = `http://localhost:${port}`;
const lock = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
await mkdir(base, { recursive: true });
await buildGridcraft({ root, lock, cache: join(base, 'build'), output: join(base, 'out'), snapshot, extraPatches: [join(root, 'scripts/xlsx-i18n-audit.patch')] });
const dist = join(base, 'dist');
await rm(dist, { recursive: true, force: true });
await cp(join(root, 'dist'), dist, { recursive: true });
await rm(join(dist, 'engines/gridcraft'), { recursive: true });
await cp(join(base, 'out/engines/gridcraft'), join(dist, 'engines/gridcraft'), { recursive: true });
const shots = join(base, 'shots');
await rm(shots, { recursive: true, force: true });
await mkdir(shots);

const harness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{width:1280px;height:860px;border:0}</style>
<iframe id="engine" src="./engines/gridcraft/index.html?host=sketch"></iframe>
<script>
  const frame = document.getElementById('engine');
  window.messages = [];
  addEventListener('message', event => { if (event.source === frame.contentWindow) messages.push(event.data); });
  window.send = (id, name, bytes) => { const b = new Uint8Array(bytes).buffer; frame.contentWindow.postMessage({ type: 'sketch-xlsx:open', protocol: 1, requestId: id, epoch: id, name, bytes: b }, location.origin, [b]); };
</script>`;

let server, browser;
const misses = new Set(), errors = [];
try {
  server = await preview({ root, build: { outDir: dist }, preview: { host: 'localhost', port, strictPort: true } });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('console', message => { const m = /^.*i18n-miss\t(.*)$/s.exec(message.text()); if (m) misses.add(m[1]); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(origin + '/audit.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: harness }));
  await page.goto(origin + '/audit.html');
  await page.waitForFunction(() => window.messages.some(m => m.type === 'sketch-xlsx:ready'));
  const open = async (id, name, bytes) => {
    await page.evaluate(([id, name, bytes]) => window.send(id, name, bytes), [id, name, [...bytes]]);
    await page.waitForFunction(id => window.messages.some(m => m.type === 'sketch-xlsx:opened' && m.requestId === id), id);
    await page.waitForTimeout(800);
  };
  const engine = page.locator('#engine');
  const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: join(shots, name + '.png') }); };
  const escape = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); };

  await open(1, '매출.xlsx', koreanWorkbook());
  await shot('00-home');
  // Ribbon tabs: walk the tab row and keep one screenshot per distinct ribbon (positions move once translated).
  const ribbon = { x: 0, y: 70, width: 1280, height: 130 };
  const seen = new Set();
  for (let x = 12; x < 760; x += 14) {
    await engine.click({ position: { x, y: 53 } });
    await page.waitForTimeout(250);
    const hash = createHash('sha256').update(await page.screenshot({ clip: ribbon })).digest('hex');
    if (!seen.has(hash)) { seen.add(hash); await shot(`10-tab-x${String(x).padStart(3, '0')}`); }
    await escape();
  }
  await engine.click({ position: { x: 104, y: 240 }, button: 'right' });
  await shot('20-cell-menu');
  await escape();
  await engine.click({ position: { x: 124, y: 762 }, button: 'right' });
  await shot('21-sheet-tab-menu');
  await escape();
  await engine.click({ position: { x: 104, y: 240 } });
  await page.keyboard.press('ControlOrMeta+f');
  await shot('30-find');
  await escape();
  await page.keyboard.press('ControlOrMeta+g');
  await shot('31-go-to');
  await escape();
  await engine.click({ position: { x: 104, y: 240 } });
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await shot('40-refusal');
  await escape();
  await open(2, '굵게.xlsx', boldWorkbook());
  await shot('50-bold');
  // The File tab (backstage) last: it covers the window.
  await engine.click({ position: { x: 40, y: 53 } });
  await shot('60-file');
  await escape();
} finally {
  await browser?.close();
  await server?.close();
}
const report = { measuredAt: new Date().toISOString(), misses: [...misses].sort(), pageErrors: errors };
await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`i18n audit: ${report.misses.length} labels without a Korean translation were asked for; screenshots in ${shots}`);
