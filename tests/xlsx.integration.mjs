// The view-only Excel engine (GridCraft + overlays/gridcraft) in Chrome, driven through its bridge
// from a bare host page, so these checks hold whatever the product shell around it does.
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { assertTestLocale, launchArgs, testLocale } from './browser-locale.mjs';
import { resolve } from 'node:path';
import { brokenWorkbook, koreanWorkbook, otherWorkbook } from './xlsx-fixtures.mjs';

const root = resolve(import.meta.dirname, '..');
const origin = 'http://localhost:4179';
const harness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{width:1200px;height:800px;border:0}</style>
<iframe id="engine" title="Excel" allow="clipboard-read; clipboard-write" src="./engines/gridcraft/index.html?host=sketch"></iframe>
<script>
  const frame = document.getElementById('engine');
  window.messages = [];
  addEventListener('message', event => { if (event.source === frame.contentWindow) messages.push(event.data); });
  // The engine's snapshot answer, with its bytes as a plain array (an ArrayBuffer does not survive page.evaluate).
  window.snapshot = (requestId, epoch) => new Promise(done => {
    const listen = event => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'sketch-xlsx:snapshot' || event.data.requestId !== requestId) return;
      removeEventListener('message', listen);
      done({ ...event.data, bytes: event.data.bytes instanceof ArrayBuffer ? [...new Uint8Array(event.data.bytes)] : null });
    };
    addEventListener('message', listen);
    frame.contentWindow.postMessage({ type: 'sketch-xlsx:snapshot', protocol: 1, requestId, epoch }, location.origin);
  });
  window.send = (requestId, epoch, name, bytes, protocol = 1) => {
    const buffer = new Uint8Array(bytes).buffer;
    frame.contentWindow.postMessage({ type: 'sketch-xlsx:open', protocol, requestId, epoch, name, bytes: buffer }, location.origin, [buffer]);
  };
</script>`;

let server, browser;
try {
  server = await preview({ root, build: { outDir: resolve(root, process.env.TEST_DIST || 'dist') }, preview: { host: 'localhost', port: 4179, strictPort: true } });
  browser = await chromium.launch({ channel: 'chrome', headless: true, ...launchArgs });
  // Service workers are blocked: once the shell registers one, its fetches bypass page.route (tests/regressions.mjs covers it).
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: testLocale || 'ko-KR', acceptDownloads: true, serviceWorkers: 'block' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  await assertTestLocale(page);
  page.setDefaultTimeout(60000);
  const errors = [], external = new Set(), downloads = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('download', download => downloads.push(download.suggestedFilename()));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url()); });
  await page.route(origin + '/xlsx-harness.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: harness }));

  const messages = () => page.evaluate(() => window.messages);
  // The first engine message whose fields equal `fields`.
  const matches = (m, fields) => Object.entries(fields).every(([key, value]) => m[key] === value);
  const waitFor = async (fields, label) => {
    await page.waitForFunction(fields => window.messages.some(m => Object.entries(fields).every(([key, value]) => m[key] === value)), fields, { timeout: 60000 })
      .catch(async error => { throw new Error(`${label}: ${error.message}\n${JSON.stringify(await messages())}`); });
    return (await messages()).find(m => matches(m, fields));
  };
  const open = async (requestId, epoch, name, bytes) => {
    await page.evaluate(([r, e, n, b]) => window.send(r, e, n, b), [requestId, epoch, name, [...bytes]]);
    return waitFor({ type: 'sketch-xlsx:opened', requestId }, `answer to ${requestId}`);
  };
  const engine = page.locator('#engine');
  // A cell's text through the engine's own Copy (allowed in view-only). Right after refused keystrokes
  // the first Copy can leave the clipboard untouched (measured), so the cell is clicked again once.
  const copyOnce = async () => {
    await page.evaluate(() => navigator.clipboard.writeText('(empty)'));
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForFunction(async () => (await navigator.clipboard.readText()) !== '(empty)', null, { timeout: 5000 }).catch(() => {});
    return (await page.evaluate(() => navigator.clipboard.readText())).trim();
  };
  const cell = async address => {
    await select(address);
    const text = await copyOnce();
    if (text !== '(empty)') return text;
    await select(address === 'A1' ? 'B1' : 'A1');
    await select(address);
    return copyOnce();
  };
  // Clicks a cell (a selection, allowed in view-only) after leaving any in-cell editor. Positions are
  // GridCraft's default layout at this viewport: columns 51px from x=28, rows 16px from y=215.
  const select = async address => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const column = address.charCodeAt(0) - 65, row = Number(address.slice(1)) - 1;
    await engine.click({ position: { x: 54 + 51 * column, y: 223 + 16.3 * row } });
  };

  await page.goto(origin + '/xlsx-harness.html');
  const ready = await waitFor({ type: 'sketch-xlsx:ready' }, 'ready');
  assert.equal(ready.protocol, 1);

  // Another protocol version is ignored.
  await page.evaluate(([b]) => window.send(99, 99, 'wrong.xlsx', b, 2), [[...koreanWorkbook()]]);
  const opened = await open(1, 1, '매출.xlsx', koreanWorkbook());
  assert.deepEqual({ ok: opened.ok, name: opened.name, sheets: opened.sheets, warnings: opened.warnings, epoch: opened.epoch }, { ok: true, name: '매출.xlsx', sheets: ['매출', '메모'], warnings: [], epoch: 1 });
  assert.equal((await messages()).filter(m => m.requestId === 99).length, 0, 'a message in another protocol is not answered');

  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('B2'), '1200', 'B2 holds the opened value');
  assert.equal(await cell('B4'), '3600', 'the formula result shows');
  await page.screenshot({ path: resolve(root, 'artifacts/xlsx-view.png') });

  // Edits, paste, cut, delete and save are refused; the workbook and the disk stay as opened.
  await select('B2');
  await page.keyboard.type('999');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await select('B2');
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+x');
  await page.evaluate(() => navigator.clipboard.writeText('PASTED'));
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  assert.equal(await cell('B2'), '1200', 'B2 is unchanged after typing, Delete, Cut and Paste');
  await waitFor({ type: 'sketch-xlsx:blocked', action: 'edit' }, 'the refusals are reported');
  assert.deepEqual(downloads, [], 'nothing was saved or downloaded');

  // A snapshot is the shown workbook as a save writes it; it opens again with the same sheets and values.
  const snapshot = await page.evaluate(() => window.snapshot(50, 1));
  assert.deepEqual({ ok: snapshot.ok, epoch: snapshot.epoch, uid: typeof snapshot.docUid, zip: snapshot.bytes?.slice(0, 4) }, { ok: true, epoch: 1, uid: 'number', zip: [0x50, 0x4b, 0x03, 0x04] });
  const again = await open(51, 51, '왕복.xlsx', snapshot.bytes);
  assert.deepEqual([again.ok, again.sheets, again.warnings], [true, ['매출', '메모'], []]);
  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('B2'), '1200', 'the snapshot keeps B2');
  assert.equal(await cell('B4'), '3600', 'the snapshot keeps the formula result');

  // A file that cannot be opened leaves the shown workbook.
  const broken = await open(2, 2, 'broken.xlsx', brokenWorkbook());
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'error');
  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('B2'), '1200', 'the shown workbook stays after a failed open');

  // Two opens in a row: each is answered, and the later workbook is shown alone.
  await page.evaluate(([a, b]) => { window.send(3, 3, 'first.xlsx', a); window.send(4, 4, 'second.xlsx', b); }, [[...koreanWorkbook()], [...otherWorkbook()]]);
  const second = await waitFor({ type: 'sketch-xlsx:opened', requestId: 4 }, 'second open');
  const first = await waitFor({ type: 'sketch-xlsx:opened', requestId: 3 }, 'first open');
  assert.deepEqual([first.ok, first.sheets], [true, ['매출', '메모']], 'the earlier open is answered too');
  assert.deepEqual(second.sheets, ['두번째']);
  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('A2'), '42');

  assert.deepEqual([...external], [], 'no request leaves this origin');
  assert.deepEqual(errors, [], 'page errors');

  // The product: the Excel view in the shell opens a picked file, keeps it across editor switches, and says why edits fail.
  const product = await context.newPage();
  product.setDefaultTimeout(60000);
  product.on('pageerror', error => errors.push(String(error)));
  product.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url()); });
  await product.goto(origin + '/xlsx.html');
  await product.locator('.xlsx-viewer[data-ready="true"]').waitFor();
  const pick = async (name, bytes) => {
    await product.evaluate(async ([name, bytes]) => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
      const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
      window.showOpenFilePicker = async () => [handle];
    }, [name, [...bytes]]);
    await product.getByRole('button', { name: 'Excel 열기' }).click();
  };
  await pick('매출.xlsx', koreanWorkbook());
  await product.locator('.xlsx-viewer[data-sheets="2"]').waitFor();
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '매출.xlsx');
  assert.equal(await product.locator('.product-document-name').count(), 0, 'the header keeps its width: the name is in the toolbar');
  // The header floats over the toolbar's right end; nothing in the toolbar may sit under it.
  for (const width of [1280, 768, 375]) {
    await product.setViewportSize({ width, height: 900 });
    const header = await product.locator('.editor-shell > .product-header').boundingBox();
    for (const box of await product.locator('.xlsx-viewer .toolbar > *:not(input)').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { text: item.textContent, right: r.right, bottom: r.bottom }; }))) {
      assert.ok(box.right <= header.x || box.bottom <= header.y, `${width}px: "${box.text}" (right ${box.right}) is under the header from ${header.x}`);
    }
  }
  await product.setViewportSize({ width: 1280, height: 900 });
  const view = product.locator('iframe[title="Excel 보기"]');
  const productCell = async address => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await product.keyboard.press('Escape');
      const column = address.charCodeAt(0) - 65, row = Number(address.slice(1)) - 1;
      if (attempt) await view.click({ position: { x: 54, y: 223 } });
      await view.click({ position: { x: 54 + 51 * column, y: 223 + 16.3 * row } });
      await product.evaluate(() => navigator.clipboard.writeText('(empty)'));
      await product.keyboard.press('ControlOrMeta+c');
      await product.waitForFunction(async () => (await navigator.clipboard.readText()) !== '(empty)', null, { timeout: 5000 }).catch(() => {});
      const text = (await product.evaluate(() => navigator.clipboard.readText())).trim();
      if (text !== '(empty)') return text;
    }
    return '(empty)';
  };
  assert.equal(await productCell('B2'), '1200');
  await product.keyboard.type('5');
  await product.keyboard.press('Enter');
  await product.getByRole('status').filter({ hasText: '보기 전용입니다' }).waitFor();
  // The engine also shows its refusal message; close it and the in-cell editor.
  await product.keyboard.press('Escape');
  await product.keyboard.press('Escape');
  await product.getByRole('button', { name: 'PDF', exact: true }).click();
  await product.locator('.pdf-editor').waitFor();
  await product.getByRole('button', { name: 'Excel', exact: true }).click();
  await product.locator('.xlsx-viewer[data-sheets="2"]').waitFor();
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '매출.xlsx', 'the workbook stays across editor switches');
  assert.equal(await productCell('B2'), '1200');
  await product.screenshot({ path: resolve(root, 'artifacts/xlsx-product.png') });
  await pick('notes.txt', new TextEncoder().encode('plain'));
  await product.getByRole('alert').filter({ hasText: 'XLSX 파일만 열 수 있습니다.' }).waitFor();
  await pick('fake.xlsx', new TextEncoder().encode('not a zip'));
  await product.getByRole('alert').filter({ hasText: 'XLSX 형식이 아닙니다' }).waitFor();
  await pick('protected.xlsx', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
  await product.getByRole('alert').filter({ hasText: '암호가 걸린 통합 문서이거나' }).waitFor();
  await pick('broken.xlsx', brokenWorkbook());
  await product.getByRole('alert').filter({ hasText: '파일을 열지 못했습니다.' }).waitFor();
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '매출.xlsx', 'a refused or failed file keeps the shown workbook');
  assert.equal(await productCell('B2'), '1200');
  assert.deepEqual([...external], [], 'no request leaves this origin (product)');
  assert.deepEqual(errors, [], 'page errors (product)');
  await product.close();

  // Outside the product the engine does not start.
  const alone = await context.newPage();
  await alone.goto(origin + '/engines/gridcraft/index.html?host=sketch');
  await alone.waitForURL(url => new URL(url).pathname === '/xlsx.html');
  await alone.route(origin + '/framed-without-host.html', route => route.fulfill({ contentType: 'text/html', body: '<iframe src="./engines/gridcraft/index.html"></iframe>' }));
  await alone.goto(origin + '/framed-without-host.html');
  await alone.frameLocator('iframe').getByText('This page opens inside Sketch Docs.').waitFor();
  console.log('XLSX VIEW CHECKS PASSED');
} finally {
  await browser?.close();
  await server?.close();
}
